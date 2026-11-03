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

  // Sequential, because GitHub also limits concurrent search requests, and one failing query
  // must not hide the results of the others.
  const found: Candidate[][] = [];
  const errors: SearchResult['errors'] = [];
  for (const query of queries) {
    try {
      found.push(await source.search(query, RESULTS_PER_QUERY));
    } catch (reason) {
      errors.push({
        query,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return { candidates: mergeResults(found, RESULT_LIMIT), errors };
}
