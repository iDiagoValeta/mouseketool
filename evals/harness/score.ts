import type { RepoName } from '../../src/domain/repo-name.ts';
import { HOSTS, type Host, type Run } from './plan-runs.ts';
import { parseVerdict } from './verdict.ts';

export type Outcome = { finalText: string; logRepos: RepoName[]; triggered: boolean };
export type Score = { retrieval?: boolean; verdict: boolean };

/**
 * Retrieval is read from the server's run log, so it holds for any host and also
 * catches a model that answers from memory. The verdict is read from the answer.
 */
export function scoreRun(run: Run, outcome: Outcome, expected?: RepoName[]): Score {
  const verdict = parseVerdict(outcome.finalText);

  if (run.kind === 'trigger') {
    return { verdict: !outcome.triggered };
  }

  if (run.kind === 'negative') {
    // Only reuse and adapt recommend a candidate; "build it, borrow a piece" passes. No verdict line is a miss.
    return { verdict: verdict !== null && (verdict.decision === 'build' || verdict.decision === 'base') };
  }

  if (!expected || expected.length === 0) {
    throw new Error(`Positive run "${run.caseId}" needs the expected repositories`);
  }
  const hit = (repos: RepoName[]) => expected.some((repo) => repos.includes(repo));
  return {
    retrieval: hit(outcome.logRepos),
    verdict:
      outcome.triggered && verdict !== null && verdict.decision !== 'build' && hit(verdict.repos),
  };
}

export type PerHostSummary = {
  host: Host;
  retrievalDefined: number;
  retrievalVague: number;
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
        retrievalDefined: ratio(passes('positive-defined', (s) => s.retrieval)),
        retrievalVague: ratio(passes('positive-vague', (s) => s.retrieval)),
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
        s.retrievalDefined >= 0.8 && s.retrievalVague >= 0.6 && s.negatives >= 5 / 6 && s.triggers === 1,
    )
  );
}
