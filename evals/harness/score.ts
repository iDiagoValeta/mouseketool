import type { RepoName } from '../../src/domain/repo-name.ts';
import type { Judge, Judgment } from './judge.ts';
import { HOSTS, type Host, type Run } from './plan-runs.ts';
import { parseVerdict } from './verdict.ts';

/** `error` is set when the host run failed; nothing it left behind (an empty log included) counts as a pass. */
export type Outcome = { finalText: string; searchedRepos: RepoName[]; triggered: boolean; error?: string };

/**
 * `verdict` is the pass/fail of the run (the hit for a positive one). `retrieval` is diagnostic only.
 * `judgments` is present when the judge was asked; `caseCovered` marks a negative case that a real project meets.
 */
export type Score = {
  retrieval?: boolean;
  verdict: boolean;
  judgments?: Judgment[];
  judgeError?: string;
  caseCovered?: boolean;
};

/** Repos the judge is asked about per run: the answer's first picks, not a whole list of alternatives. */
const MAX_JUDGED = 3;

/** Judges `repos` in order until one meets every requirement. A failed judge call counts as not meeting. */
async function judgeUntilMeets(
  repos: RepoName[],
  mustHaves: string[],
  judge: Judge,
): Promise<{ judgments: Judgment[]; judgeError?: string }> {
  const judgments: Judgment[] = [];
  const errors: string[] = [];
  for (const repo of repos.slice(0, MAX_JUDGED)) {
    try {
      const judgment = await judge.judge(repo, mustHaves);
      judgments.push(judgment);
      if (judgment.meets) break;
    } catch (error) {
      errors.push(`${repo}: ${(error as Error).message}`);
    }
  }
  return { judgments, ...(errors.length === 0 ? {} : { judgeError: errors.join('; ') }) };
}

/**
 * The server's run log says which repos the search returned, so it holds for any host and catches a model
 * that answers from memory: only recommended repos that the search returned are judged, not ones the model
 * merely inspected. The verdict line is read from the answer; whether a recommended repo is good is decided
 * by the judge, against the requirements.
 */
export async function scoreRun(
  run: Run,
  outcome: Outcome,
  mustHaves: string[] | undefined,
  judge: Judge,
): Promise<Score> {
  if (outcome.error !== undefined) {
    return run.kind.startsWith('positive') ? { retrieval: false, verdict: false } : { verdict: false };
  }

  if (run.kind === 'trigger') {
    return { verdict: !outcome.triggered };
  }

  if (mustHaves === undefined || mustHaves.length === 0) {
    throw new Error(`Run "${run.caseId}" (${run.kind}) needs its requirements`);
  }
  const verdict = parseVerdict(outcome.finalText);
  const recommended = (verdict?.repos ?? []).filter((repo) => outcome.searchedRepos.includes(repo));

  if (run.kind === 'negative') {
    // "Build it, borrow a piece" passes. Reuse and adapt recommend a project for a need nothing should cover,
    // so they miss, unless a recommended project does meet every requirement: then the case itself is wrong
    // and it passes flagged, so the author replaces it. No verdict line is a miss.
    if (verdict === null) return { verdict: false };
    if (verdict.decision === 'build' || verdict.decision === 'base') return { verdict: true };
    const { judgments, judgeError } = await judgeUntilMeets(recommended, mustHaves, judge);
    const covered = judgments.some((j) => j.meets);
    return {
      verdict: covered,
      ...(covered ? { caseCovered: true } : {}),
      judgments,
      ...(judgeError === undefined ? {} : { judgeError }),
    };
  }

  const retrieval = recommended.length > 0;
  if (!outcome.triggered || verdict === null || verdict.decision === 'build') {
    return { retrieval, verdict: false };
  }
  const { judgments, judgeError } = await judgeUntilMeets(recommended, mustHaves, judge);
  return {
    retrieval,
    verdict: judgments.some((j) => j.meets),
    judgments,
    ...(judgeError === undefined ? {} : { judgeError }),
  };
}

/** One line of flags for the CLI: what the run scored and what the judge said about each repo it looked at. */
export function describeScore(score: Score): string {
  return [
    score.retrieval === undefined ? '' : `retrieval=${score.retrieval ? 'ok' : 'miss'}`,
    `hit=${score.verdict ? 'ok' : 'miss'}`,
    score.judgments === undefined
      ? ''
      : `judged=[${score.judgments.map((j) => `${j.repo}: ${j.meets ? 'meets' : `missing (${j.missing.join('; ')})`}`).join(', ')}]`,
    score.judgeError === undefined ? '' : `judgeError=${score.judgeError}`,
  ]
    .filter(Boolean)
    .join(' ');
}

export type PerHostSummary = {
  host: Host;
  hitDefined: number;
  hitVague: number;
  negatives: number;
  triggers: number;
};

/** Share of passes; an empty share is 1 because nothing in it can fail. */
function ratio(passes: boolean[]): number {
  return passes.length === 0 ? 1 : passes.filter(Boolean).length / passes.length;
}

/** One summary per host that has results, in `HOSTS` order. */
export function summarize(results: { run: Run; score: Score }[]): PerHostSummary[] {
  return HOSTS.flatMap((host) => {
    const own = results.filter((r) => r.run.host === host);
    if (own.length === 0) return [];
    const passes = (kind: Run['kind'], pick: (s: Score) => boolean | undefined) =>
      own.filter((r) => r.run.kind === kind).map((r) => pick(r.score) === true);
    return [
      {
        host,
        hitDefined: ratio(passes('positive-defined', (s) => s.verdict)),
        hitVague: ratio(passes('positive-vague', (s) => s.verdict)),
        negatives: ratio(passes('negative', (s) => s.verdict)),
        triggers: ratio(passes('trigger', (s) => s.verdict)),
      },
    ];
  });
}

/** Every host must meet every threshold on its own share. */
export function meetsThresholds(summaries: PerHostSummary[]): boolean {
  return (
    summaries.length > 0 &&
    summaries.every(
      (s) =>
        s.hitDefined >= 0.8 && s.hitVague >= 0.6 && s.negatives >= 5 / 6 && s.triggers === 1,
    )
  );
}

export type Report = { summaries: PerHostSummary[]; passed: boolean; needsCaseReview: string[] };

/**
 * A covered negative is a case a real project meets, so the case is wrong and gets replaced: whatever the
 * thresholds say was measured on a broken set, so it is not a pass.
 */
export function buildReport(
  results: { run: Run; score: Score }[],
  state: { complete: boolean; filtered: boolean },
): Report {
  const summaries = summarize(results);
  const needsCaseReview = [...new Set(results.filter((r) => r.score.caseCovered === true).map((r) => r.run.caseId))];
  const passed = state.complete && !state.filtered && needsCaseReview.length === 0 && meetsThresholds(summaries);
  return { summaries, passed, needsCaseReview };
}

/** The verdict word the CLI ends with. */
export function finalLine(report: Pick<Report, 'passed' | 'needsCaseReview'>): string {
  if (report.needsCaseReview.length > 0) return `FAIL: case review needed: ${report.needsCaseReview.join(', ')}`;
  return report.passed ? 'PASS' : 'FAIL';
}
