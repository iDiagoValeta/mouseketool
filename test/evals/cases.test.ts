import { describe, expect, it } from 'vitest';
import { parseRepoName } from '../../src/domain/repo-name.ts';
import { loadCases } from '../../evals/cases/schema.ts';

const cases = loadCases('evals/cases');

/** Bullet lines under a "Must have:" or "Nice to have:" heading. */
function requirements(defined: string, heading: 'Must have:' | 'Nice to have:'): string[] {
  const lines = defined.split('\n').map((line) => line.trim());
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('- ')) break;
    items.push(line);
  }
  return items;
}

describe('loadCases', () => {
  it('returns 20 positive, 6 negative and 6 trigger cases', () => {
    expect(cases.positive).toHaveLength(20);
    expect(cases.negative).toHaveLength(6);
    expect(cases.trigger).toHaveLength(6);
  });

  it('uses unique ids across all sets', () => {
    const ids = [...cases.positive, ...cases.negative, ...cases.trigger].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects a directory without the case files', () => {
    expect(() => loadCases('evals/missing')).toThrow();
  });
});

describe('positive cases', () => {
  it.each(cases.positive.map((c) => [c.id, c] as const))('%s is well formed', (_id, c) => {
    expect(c.expected.length).toBeGreaterThan(0);
    for (const repo of c.expected) {
      expect(parseRepoName(repo)).toBe(repo);
    }
    expect(new Set(c.expected).size).toBe(c.expected.length);
  });

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s vague text is one sentence without the repo name',
    (_id, c) => {
      expect(c.vague.trim().split(/[.!?]\s+\S/)).toHaveLength(1);
      const text = c.vague.toLowerCase();
      for (const repo of c.expected) {
        const namePart = repo.split('/')[1]!;
        expect(text).not.toContain(namePart);
      }
    },
  );

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s defined text has 4 to 8 requirements in both lists',
    (_id, c) => {
      const must = requirements(c.defined, 'Must have:');
      const nice = requirements(c.defined, 'Nice to have:');
      expect(must.length).toBeGreaterThanOrEqual(2);
      expect(nice.length).toBeGreaterThanOrEqual(1);
      expect(must.length + nice.length).toBeGreaterThanOrEqual(4);
      expect(must.length + nice.length).toBeLessThanOrEqual(8);
    },
  );
});

describe('negative cases', () => {
  it.each(cases.negative.map((c) => [c.id, c] as const))(
    '%s defined text has both lists',
    (_id, c) => {
      expect(requirements(c.defined, 'Must have:').length).toBeGreaterThanOrEqual(2);
      expect(requirements(c.defined, 'Nice to have:').length).toBeGreaterThanOrEqual(1);
    },
  );
});
