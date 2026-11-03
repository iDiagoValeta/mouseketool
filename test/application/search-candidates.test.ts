import { describe, expect, it } from 'vitest';
import { searchCandidates, TooManyQueriesError } from '../../src/application/search-candidates.ts';
import type { Candidate } from '../../src/domain/candidate.ts';
import type { RepositorySource } from '../../src/application/ports/repository-source.ts';
import { InMemorySource } from '../doubles/in-memory-source.ts';
import { MemoryRunLog } from '../doubles/memory-run-log.ts';

function candidate(name: string, stars = 0): Candidate {
  return {
    name,
    url: `https://github.com/${name}`,
    description: null,
    stars,
    pushedAt: '2026-01-01T00:00:00Z',
    license: null,
    topics: [],
    archived: false,
    language: null,
  };
}

describe('searchCandidates', () => {
  it('merges a repo found by several queries into one ranked entry', async () => {
    const source = new InMemorySource({
      searches: {
        'local rag': [candidate('foo/bar', 5), candidate('baz/qux', 50)],
        'pdf rag': [candidate('foo/bar', 5)],
      },
    });
    const log = new MemoryRunLog();

    const result = await searchCandidates({ source, log }, { queries: ['local rag', 'pdf rag'] });

    expect(result.errors).toEqual([]);
    expect(result.candidates.map((c) => [c.name, c.matchedQueries])).toEqual([
      ['foo/bar', 2],
      ['baz/qux', 1],
    ]);
  });

  it('asks the source for 10 results per query', async () => {
    const source = new InMemorySource();

    await searchCandidates({ source, log: new MemoryRunLog() }, { queries: ['a', 'b'] });

    expect(source.searchCalls).toEqual([
      { query: 'a', perQuery: 10 },
      { query: 'b', perQuery: 10 },
    ]);
  });

  it('reports a failing query and still returns the others', async () => {
    const source = new InMemorySource({
      searches: { good: [candidate('foo/bar')] },
      failingQueries: { bad: 'rate limited' },
    });

    const result = await searchCandidates(
      { source, log: new MemoryRunLog() },
      { queries: ['bad', 'good'] },
    );

    expect(result.errors).toEqual([{ query: 'bad', message: 'rate limited' }]);
    expect(result.candidates.map((c) => c.name)).toEqual(['foo/bar']);
  });

  it('sends the queries one at a time, in order', async () => {
    const events: string[] = [];
    const inner = new InMemorySource({ failingQueries: { b: 'boom' } });
    const source = Object.create(inner) as RepositorySource;
    source.search = async (query, perQuery) => {
      events.push(`start ${query}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`end ${query}`);
      return inner.search(query, perQuery);
    };

    const result = await searchCandidates(
      { source, log: new MemoryRunLog() },
      { queries: ['a', 'b', 'c'] },
    );

    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(result.errors).toEqual([{ query: 'b', message: 'boom' }]);
  });

  it('caps the merged list at 40 candidates', async () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate(`o/r${i}`));
    const searches = Object.fromEntries(
      Array.from({ length: 5 }, (_, q) => [
        `q${q}`,
        many.map((c) => ({ ...c, name: `${c.name}-${q}` })),
      ]),
    );
    const result = await searchCandidates(
      { source: new InMemorySource({ searches }), log: new MemoryRunLog() },
      { queries: Object.keys(searches) },
    );

    expect(result.candidates).toHaveLength(40);
  });

  it('rejects more than 15 queries without calling the source, logging one empty entry', async () => {
    const source = new InMemorySource();
    const log = new MemoryRunLog();
    const queries = Array.from({ length: 16 }, (_, i) => `q${i}`);

    const call = searchCandidates({ source, log }, { queries });

    await expect(call).rejects.toThrow(TooManyQueriesError);
    await expect(call).rejects.toThrow('At most 15 queries per call, got 16');
    expect(source.searchCalls).toEqual([]);
    expect(log.entries).toEqual([{ tool: 'search_repositories', repos: [] }]);
  });

  it('accepts exactly 15 queries', async () => {
    const queries = Array.from({ length: 15 }, (_, i) => `q${i}`);

    await expect(
      searchCandidates({ source: new InMemorySource(), log: new MemoryRunLog() }, { queries }),
    ).resolves.toEqual({ candidates: [], errors: [] });
  });

  it('rejects an empty query list', async () => {
    const call = searchCandidates(
      { source: new InMemorySource(), log: new MemoryRunLog() },
      { queries: [] },
    );

    await expect(call).rejects.toThrow(TooManyQueriesError);
    await expect(call).rejects.toThrow('At least 1 query is required');
  });

  it('logs one empty entry for an empty query list', async () => {
    const log = new MemoryRunLog();

    await searchCandidates({ source: new InMemorySource(), log }, { queries: [] }).catch(() => {});

    expect(log.entries).toEqual([{ tool: 'search_repositories', repos: [] }]);
  });

  it('logs every returned repo in one entry', async () => {
    const source = new InMemorySource({
      searches: { a: [candidate('foo/bar', 2), candidate('baz/qux', 1)] },
    });
    const log = new MemoryRunLog();

    await searchCandidates({ source, log }, { queries: ['a'] });

    expect(log.entries).toEqual([{ tool: 'search_repositories', repos: ['foo/bar', 'baz/qux'] }]);
  });

  it('logs one entry with no repos when nothing is found', async () => {
    const log = new MemoryRunLog();

    await searchCandidates({ source: new InMemorySource(), log }, { queries: ['nothing'] });

    expect(log.entries).toEqual([{ tool: 'search_repositories', repos: [] }]);
  });

  it('logs one entry with no repos when every query fails', async () => {
    const source = new InMemorySource({ failingQueries: { a: 'boom' } });
    const log = new MemoryRunLog();

    const result = await searchCandidates({ source, log }, { queries: ['a'] });

    expect(result.errors).toHaveLength(1);
    expect(log.entries).toEqual([{ tool: 'search_repositories', repos: [] }]);
  });
});
