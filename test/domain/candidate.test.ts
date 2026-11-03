import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../src/domain/candidate.ts';
import { mergeResults } from '../../src/domain/candidate.ts';

function candidate(name: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    name,
    url: `https://github.com/${name}`,
    description: null,
    stars: 0,
    pushedAt: '2026-01-01T00:00:00Z',
    license: null,
    topics: [],
    archived: false,
    language: null,
    ...overrides,
  };
}

describe('mergeResults', () => {
  it('lists a repo found by two queries once, with matchedQueries 2', () => {
    const shared = candidate('foo/bar', { stars: 10 });
    const merged = mergeResults([[shared], [candidate('foo/bar', { stars: 10 })]], 10);

    expect(merged).toEqual([{ ...shared, matchedQueries: 2 }]);
  });

  it('counts a repo once per query even when that query returns it twice', () => {
    const merged = mergeResults([[candidate('foo/bar'), candidate('foo/bar')]], 10);

    expect(merged.map((repo) => repo.matchedQueries)).toEqual([1]);
  });

  it('keeps the first-seen fields for a duplicate repo', () => {
    const first = candidate('foo/bar', { stars: 10, description: 'first' });
    const second = candidate('foo/bar', { stars: 999, description: 'second' });
    const [merged] = mergeResults([[first], [second]], 10);

    expect(merged?.stars).toBe(10);
    expect(merged?.description).toBe('first');
  });

  it('ranks by matchedQueries first, then by stars', () => {
    const merged = mergeResults(
      [
        [candidate('alpha/one', { stars: 5 }), candidate('beta/two', { stars: 900 })],
        [candidate('alpha/one', { stars: 5 }), candidate('gamma/three', { stars: 1000 })],
      ],
      10,
    );

    expect(merged.map((repo) => repo.name)).toEqual(['alpha/one', 'gamma/three', 'beta/two']);
  });

  it('caps the output at limit', () => {
    const merged = mergeResults([[candidate('a/a'), candidate('b/b'), candidate('c/c')]], 2);

    expect(merged.map((repo) => repo.name)).toEqual(['a/a', 'b/b']);
  });

  it('merges names that differ only in case and emits the lower-case name', () => {
    const merged = mergeResults([[candidate('Foo/Bar')], [candidate('foo/bar')]], 10);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('foo/bar');
    expect(merged[0]?.matchedQueries).toBe(2);
  });
});
