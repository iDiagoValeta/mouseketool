import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../cases/schema.ts';
import { HOSTS, MODELS, planRuns, type Host, type Run } from './plan-runs.ts';
import { ClaudeRunner } from './runners/claude-runner.ts';
import { OpencodeRunner } from './runners/opencode-runner.ts';
import type { Runner } from './runners/runner.ts';
import { meetsThresholds, scoreRun, summarize, type Score } from './score.ts';
import { createWorkspace, readRunLog, removeWorkspace } from './workspace.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runnerFor(host: Host): Runner {
  return host === 'opencode-deepseek-flash' ? new OpencodeRunner() : new ClaudeRunner(MODELS[host]);
}

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
  process.exit(2);
}
if (values.host !== undefined && !(HOSTS as readonly string[]).includes(values.host)) {
  console.error(`Unknown host "${values.host}". Hosts: ${HOSTS.join(', ')}`);
  process.exit(2);
}

// The runs use dist/server.mjs, so a stale build would test the wrong server.
execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'ignore' });

const cases = loadCases(join(repoRoot, 'evals', 'cases'));
const expectedByCase = new Map(cases.positive.map((c) => [c.id, c.expected]));
const filtered = values.only !== undefined || values.host !== undefined;
const plan = planRuns(cases, pass).filter(
  (run) => (values.only === undefined || run.caseId === values.only) && (values.host === undefined || run.host === values.host),
);
if (plan.length === 0) {
  console.error(`No run matches --only ${values.only ?? '*'} --host ${values.host ?? '*'}`);
  process.exit(2);
}

type Result = { run: Run; score: Score; finalText: string; logRepos: string[]; triggered: boolean; error?: string; seconds: number };
const results: Result[] = [];

for (const [index, run] of plan.entries()) {
  const started = Date.now();
  const workspace = createWorkspace(run, repoRoot);
  let finalText = '';
  let error: string | undefined;
  try {
    ({ finalText } = await runnerFor(run.host).run(run.prompt, workspace.dir));
  } catch (caught) {
    // A host failure scores as a miss, but is flagged so it is not read as a verdict.
    error = (caught as Error).message;
  }
  const { triggered, logRepos } = readRunLog(workspace);
  removeWorkspace(workspace);

  const score = scoreRun(run, { finalText, logRepos, triggered }, expectedByCase.get(run.caseId));
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ run, score, finalText, logRepos, triggered, seconds, ...(error === undefined ? {} : { error }) });

  const flags = [
    score.retrieval === undefined ? '' : `retrieval=${score.retrieval ? 'ok' : 'miss'}`,
    `verdict=${score.verdict ? 'ok' : 'miss'}`,
    error === undefined ? '' : `ERROR=${error.slice(0, 120)}`,
  ].filter(Boolean);
  console.log(`[${index + 1}/${plan.length}] ${run.host} ${run.kind} ${run.caseId} ${flags.join(' ')} ${seconds}s`);
}

const summaries = summarize(results);
for (const s of summaries) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log(
    `${s.host}: retrieval defined ${pct(s.retrievalDefined)}, vague ${pct(s.retrievalVague)}, negatives ${pct(s.negatives)}, triggers ${pct(s.triggers)}`,
  );
}

const passed = meetsThresholds(summaries);
const reportDir = join(repoRoot, '.dev', 'eval-reports');
mkdirSync(reportDir, { recursive: true });
const reportPath = join(reportDir, `${new Date().toISOString().slice(0, 10)}-pass${pass}${filtered ? '-partial' : ''}.json`);
writeFileSync(reportPath, JSON.stringify({ pass, passed, summaries, results }, null, 2));
console.log(`${passed ? 'PASS' : 'FAIL'}: report in ${reportPath}`);
process.exit(passed ? 0 : 1);
