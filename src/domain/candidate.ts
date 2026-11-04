import type { RepoName } from './repo-name.ts';

export interface Candidate {
  name: RepoName;
  url: string;
  description: string | null;
  stars: number;
  pushedAt: string;
  license: string | null;
  topics: string[];
  archived: boolean;
  language: string | null;
}

export interface RankedCandidate extends Candidate {
  matchedQueries: number;
}

const DESCRIPTION_LIMIT = 350;

/**
 * GitHub's form caps a description at 350 characters, but the API returns whatever was stored:
 * one spam repo with a 250,000-character description floods the agent's context on every search it matches.
 */
export function shortenDescription<T extends Candidate>(candidate: T): T {
  const { description } = candidate;
  if (description === null || description.length <= DESCRIPTION_LIMIT) return candidate;
  return { ...candidate, description: `${description.slice(0, DESCRIPTION_LIMIT)} [truncated]` };
}

/**
 * Merges the results of several queries into one ranked list.
 * A repo found by several queries counts once, with its first-seen fields;
 * names are compared case-insensitively. Ranking is by matchedQueries, then stars.
 */
export function mergeResults(perQuery: Candidate[][], limit: number): RankedCandidate[] {
  const merged = new Map<RepoName, RankedCandidate>();

  for (const results of perQuery) {
    // A query that returns the same repo twice still counts as one match.
    const seenInQuery = new Set<RepoName>();

    for (const candidate of results) {
      const name = candidate.name.toLowerCase();
      const existing = merged.get(name);

      if (existing === undefined) {
        merged.set(name, { ...candidate, name, matchedQueries: 1 });
      } else if (!seenInQuery.has(name)) {
        existing.matchedQueries += 1;
      }

      seenInQuery.add(name);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.matchedQueries - a.matchedQueries || b.stars - a.stars)
    .slice(0, limit);
}
