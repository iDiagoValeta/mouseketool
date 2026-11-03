import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../cases/schema.ts';
import { ghAuthToken, resolveToken } from '../../src/infrastructure/github/token.ts';
import { HOSTS, MODELS, planRuns, type Host, type Run } from './plan-runs.ts';
import { ClaudeRunner } from './runners/claude-runner.ts';
import { OpencodeRunner } from './runners/opencode-runner.ts';
import type { Runner } from './runners/runner.ts';
import { meetsThresholds, scoreRun, summarize, type PerHostSummary, type Score } from './score.ts';
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
  },
});

const pass = Number(values.pass);
if (!Number.isInteger(pass) || pass < 0) {
  console.error('Usage: pnpm eval --pass <n> [--only <caseId>] [--host <host>]');
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
const expectedByCase = new Map(cases.positive.map((c) => [c.id, c.expected]));
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

const reportDir = join(repoRoot, '.dev', 'eval-reports');
mkdirSync(reportDir, { recursive: true });
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
  const score = scoreRun(run, outcome, expectedByCase.get(run.caseId));
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ run, score, finalText, ...log, seconds, ...(error === undefined ? {} : { error }) });
  writeReport(false);

  const flags = [
    score.retrieval === undefined ? '' : `retrieval=${score.retrieval ? 'ok' : 'miss'}`,
    `verdict=${score.verdict ? 'ok' : 'miss'}`,
    error === undefined ? '' : `ERROR=${error.slice(0, 120)}`,
  ].filter(Boolean);
  console.log(`[${index + 1}/${plan.length}] ${run.host} ${run.kind} ${run.caseId} ${flags.join(' ')} ${seconds}s`);
}

const { summaries, passed } = writeReport(true);
for (const s of summaries) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log(
    `${s.host}: retrieval defined ${pct(s.retrievalDefined)}, vague ${pct(s.retrievalVague)}, negatives ${pct(s.negatives)}, triggers ${pct(s.triggers)}`,
  );
}

if (filtered) {
  console.log(`PARTIAL: thresholds are not meaningful for a filtered run, so it is neither PASS nor FAIL. Report in ${reportPath}`);
  process.exit(PARTIAL);
}
console.log(`${passed ? 'PASS' : 'FAIL'}: report in ${reportPath}`);
process.exit(passed ? 0 : 1);
