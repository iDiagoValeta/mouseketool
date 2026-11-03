import { mergeResults } from '../domain/candidate.ts';
import type { Candidate, RankedCandidate } from '../domain/candidate.ts';
import type { RunLog } from './ports/run-log.ts';
import type { RepositorySource } from './ports/repository-source.ts';

const MAX_QUERIES = 15;
const RESULTS_PER_QUERY = 10;
const RESULT_LIMIT = 40;

export class TooManyQueriesError extends Error {
  override name = 'TooManyQueriesError';
}

export interface SearchResult {
  candidates: RankedCandidate[];
  errors: { query: string; message: string }[];
}

export async function searchCandidates(
  deps: { source: RepositorySource; log: RunLog },
  input: { queries: string[] },
): Promise<SearchResult> {
  const { queries } = input;
  if (queries.length === 0) {
    throw new TooManyQueriesError('At least 1 query is required');
  }
  if (queries.length > MAX_QUERIES) {
    throw new TooManyQueriesError(`At most ${MAX_QUERIES} queries per call, got ${queries.length}`);
  }

  // One failing query must not hide the results of the others.
  const settled = await Promise.allSettled(
    queries.map((query) => deps.source.search(query, RESULTS_PER_QUERY)),
  );

  const found: Candidate[][] = [];
  const errors: SearchResult['errors'] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      found.push(outcome.value);
    } else {
      const reason: unknown = outcome.reason;
      errors.push({
        query: queries[index] as string,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });

  const candidates = mergeResults(found, RESULT_LIMIT);
  await deps.log.record({ tool: 'search_repositories', repos: candidates.map((c) => c.name) });

  return { candidates, errors };
}
