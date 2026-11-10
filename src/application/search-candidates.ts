import { mergeResults, shortenDescription } from '../domain/candidate.ts';
import type { Candidate, RankedCandidate } from '../domain/candidate.ts';
import type { RunLog } from './ports/run-log.ts';
import type { RepositorySource } from './ports/repository-source.ts';

// More queries, not deeper ones: a project a query misses in its top 10 is rarely in its top 100, while another
// wording of the same need often finds it (#59). 60 candidates are about 6k tokens for the caller.
const MAX_QUERIES = 30;
const RESULTS_PER_QUERY = 10;
const RESULT_LIMIT = 60;

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
  let result: SearchResult;
  try {
    result = await search(deps.source, input.queries);
  } catch (error) {
    // A rejected call still counts as the tool being triggered.
    await deps.log.record({ tool: 'search_repositories', repos: [] });
    throw error;
  }

  await deps.log.record({
    tool: 'search_repositories',
    repos: result.candidates.map((c) => c.name),
  });
  return result;
}

async function search(source: RepositorySource, queries: string[]): Promise<SearchResult> {
  if (queries.length === 0) {
    throw new TooManyQueriesError('At least 1 query is required');
  }
  if (queries.length > MAX_QUERIES) {
    throw new TooManyQueriesError(`At most ${MAX_QUERIES} queries per call, got ${queries.length}`);
  }

  // All at once: the source keeps its own pace. Results are merged in query order whatever order they arrive
  // in, and one failing query must not hide the results of the others.
  const settled = await Promise.allSettled(queries.map((query) => source.search(query, RESULTS_PER_QUERY)));
  const found: Candidate[][] = [];
  const errors: SearchResult['errors'] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      found.push(outcome.value.map(shortenDescription));
    } else {
      const reason: unknown = outcome.reason;
      errors.push({ query: queries[i]!, message: reason instanceof Error ? reason.message : String(reason) });
    }
  });

  return { candidates: mergeResults(found, RESULT_LIMIT), errors };
}
