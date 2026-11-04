import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../cases/schema.ts';
import { ghAuthToken, resolveToken } from '../../src/infrastructure/github/token.ts';
import { calibrate } from './calibrate.ts';
import { CachedJudge, ClaudeJudge } from './judge.ts';
import { HOSTS, MODELS, planRuns, type Host, type Run } from './plan-runs.ts';
import { ClaudeRunner } from './runners/claude-runner.ts';
import { OpencodeRunner } from './runners/opencode-runner.ts';
import type { Runner } from './runners/runner.ts';
import { describeScore, meetsThresholds, scoreRun, summarize, type PerHostSummary, type Score } from './score.ts';
import { createWorkspace, readRunLog, removeWorkspace } from './workspace.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runnerFor(host: Host): Runner {
  return host === 'opencode-deepseek-flash' ? new OpencodeRunner() : new ClaudeRunner(MODELS[host]);
}

// Usage errors use EX_USAGE so exit 2 only ever means a partial run.
const USAGE = 64;
const PARTIAL = 2;

const { values } = parseArgs({
  options: {
    pass: { type: 'string' },
    only: { type: 'string' },
    host: { type: 'string' },
    calibrate: { type: 'boolean' },
  },
});

const calibrating = values.calibrate === true;
const pass = Number(values.pass);
if (!calibrating && (!Number.isInteger(pass) || pass < 0)) {
  console.error('Usage: pnpm eval --pass <n> [--only <caseId>] [--host <host>]\n       pnpm eval --calibrate [--only <caseId>]');
  process.exit(USAGE);
}
if (values.host !== undefined && !(HOSTS as readonly string[]).includes(values.host)) {
  console.error(`Unknown host "${values.host}". Hosts: ${HOSTS.join(', ')}`);
  process.exit(USAGE);
}

// The runs use dist/server.mjs, so a stale build would test the wrong server.
try {
  execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
} catch (error) {
  const failure = error as { stdout?: string; stderr?: string; message: string };
  console.error(`pnpm build failed:\n${failure.stderr || failure.stdout || failure.message}`);
  process.exit(1);
}

// Resolved once here: hosts get no token in their environment, only the MCP server gets it, through its config.
const githubToken = await resolveToken(process.env, ghAuthToken);

const cases = loadCases(join(repoRoot, 'evals', 'cases'));
const reportDir = join(repoRoot, '.dev', 'eval-reports');
mkdirSync(reportDir, { recursive: true });
// Judgments are cached on disk, so a repeated calibration or pass does not pay for the same verdict twice.
const judge = new CachedJudge(new ClaudeJudge(repoRoot, githubToken), join(reportDir, 'judgments.json'));

if (calibrating) {
  // Checks the judge and the requirements before a real pass: no host runs.
  const positive = cases.positive.filter((c) => values.only === undefined || c.id === values.only);
  if (positive.length === 0) {
    console.error(`No positive case matches --only ${values.only ?? '*'}`);
    process.exit(USAGE);
  }
  const calibrated = await calibrate(positive, judge, console.log);
  console.log(calibrated ? 'CALIBRATED: every case has a known match that meets both versions' : 'NOT CALIBRATED: fix the cases above before a real pass');
  process.exit(calibrated ? 0 : 1);
}

const filtered = values.only !== undefined || values.host !== undefined;
const plan = planRuns(cases, pass).filter(
  (run) => (values.only === undefined || run.caseId === values.only) && (values.host === undefined || run.host === values.host),
);
if (plan.length === 0) {
  console.error(`No run matches --only ${values.only ?? '*'} --host ${values.host ?? '*'}`);
  process.exit(USAGE);
}

type Result = { run: Run; score: Score; finalText: string; logRepos: string[]; triggered: boolean; error?: string; seconds: number };
const results: Result[] = [];

const reportPath = join(reportDir, `${new Date().toISOString().slice(0, 10)}-pass${pass}${filtered ? '-partial' : ''}.json`);

// Rewritten after every run so a crash keeps what already finished.
function writeReport(complete: boolean): { summaries: PerHostSummary[]; passed: boolean } {
  const summaries = summarize(results);
  const passed = complete && !filtered && meetsThresholds(summaries);
  writeFileSync(reportPath, JSON.stringify({ pass, complete, filtered, passed, summaries, results }, null, 2));
  return { summaries, passed };
}

for (const [index, run] of plan.entries()) {
  const started = Date.now();
  const workspace = createWorkspace(run, repoRoot, githubToken);
  let finalText = '';
  let error: string | undefined;
  let log: ReturnType<typeof readRunLog>;
  try {
    try {
      ({ finalText } = await runnerFor(run.host).run(run.prompt, workspace.dir));
    } catch (caught) {
      error = (caught as Error).message;
    }
    log = readRunLog(workspace);
  } finally {
    removeWorkspace(workspace);
  }

  // A failed host run scores false on every measure and is flagged, so it is never read as a verdict.
  const outcome = { finalText, ...log, ...(error === undefined ? {} : { error }) };
  const score = await scoreRun(run, outcome, run.mustHaves, judge);
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ run, score, finalText, ...log, seconds, ...(error === undefined ? {} : { error }) });
  writeReport(false);

  const flags = [describeScore(score), error === undefined ? '' : `ERROR=${error.slice(0, 120)}`].filter(Boolean);
  console.log(`[${index + 1}/${plan.length}] ${run.host} ${run.kind} ${run.caseId} ${flags.join(' ')} ${seconds}s`);
  if (score.caseCovered) {
    const by = score.judgments?.find((j) => j.meets)?.repo;
    console.log(`CASE COVERED: ${run.caseId} by ${by}`);
  }
}

const { summaries, passed } = writeReport(true);
for (const s of summaries) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log(
    `${s.host}: hit defined ${pct(s.hitDefined)}, vague ${pct(s.hitVague)}, negatives ${pct(s.negatives)}, triggers ${pct(s.triggers)}`,
  );
}

if (filtered) {
  console.log(`PARTIAL: thresholds are not meaningful for a filtered run, so it is neither PASS nor FAIL. Report in ${reportPath}`);
  process.exit(PARTIAL);
}
console.log(`${passed ? 'PASS' : 'FAIL'}: report in ${reportPath}`);
process.exit(passed ? 0 : 1);
