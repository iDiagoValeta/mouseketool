import { describe, expect, it } from 'vitest';
import { parseRepoName } from '../../src/domain/repo-name.ts';
import { readFileSync } from 'node:fs';
import { loadCases, renderDefined } from '../../evals/cases/schema.ts';

const cases = loadCases('evals/cases');
// Snapshot of the defined prompts as they were before the requirements became structured data.
const oldDefined = JSON.parse(readFileSync('test/evals/fixtures/defined-prompts.json', 'utf8')) as Record<string, string>;

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

describe('renderDefined', () => {
  it('renders the Must have and Nice to have blocks', () => {
    expect(renderDefined({ mustHaves: ['a', 'b'], niceToHaves: ['c'] })).toBe('Must have:\n- a\n- b\nNice to have:\n- c');
  });

  it('omits the Nice to have block when there is none', () => {
    expect(renderDefined({ mustHaves: ['a'], niceToHaves: [] })).toBe('Must have:\n- a');
  });

  it('renders every case exactly as the host got it before the conversion', () => {
    const all = [...cases.positive, ...cases.negative];
    expect(all).toHaveLength(Object.keys(oldDefined).length);
    for (const c of all) {
      expect(renderDefined(c.defined), c.id).toBe(oldDefined[c.id]);
    }
  });
});

describe('trigger cases', () => {
  it('uses the spec example of a one-off script, which must not trigger the skill', () => {
    expect(cases.trigger.find((c) => c.id === 'trg-rename-by-date')?.prompt).toBe(
      'Write a script that renames all the photos in this folder to the date they were taken, like 2024-05-12_001.jpg.',
    );
  });
});

describe('positive cases', () => {
  it.each(cases.positive.map((c) => [c.id, c] as const))('%s is well formed', (_id, c) => {
    expect(c.knownMatches.length).toBeGreaterThan(0);
    for (const repo of c.knownMatches) {
      expect(parseRepoName(repo)).toBe(repo);
    }
    expect(new Set(c.knownMatches).size).toBe(c.knownMatches.length);
  });

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s vague text is one sentence without the repo name',
    (_id, c) => {
      expect(c.vague.text.trim().split(/[.!?]\s+\S/)).toHaveLength(1);
      const text = c.vague.text.toLowerCase();
      for (const repo of c.knownMatches) {
        const namePart = repo.split('/')[1]!;
        expect(text).not.toContain(namePart);
      }
    },
  );

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s vague text has no long word from the repo owner or name',
    (_id, c) => {
      const text = c.vague.text.toLowerCase();
      for (const repo of c.knownMatches) {
        const words = repo.split(/[-_/]/).filter((word) => word.length >= 5);
        for (const word of words) {
          expect(text).not.toContain(word);
        }
      }
    },
  );

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s vague text states the intent to build or get a new tool',
    (_id, c) => {
      expect(c.vague.text).toMatch(/\b(build|make|write|create|start)\b/i);
      // The verb must be about a tool, not a one-off job such as "make a video".
      expect(c.vague.text).toMatch(/\b(build|make|write|create|start)\b(?!\s+(a|the|my)\s+(video|playlist|list)\b)/i);
    },
  );

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s vague text is in the first person',
    (_id, c) => {
      expect(c.vague.text).toMatch(/\bI\b|\bI'/);
    },
  );

  it.each(cases.positive.map((c) => [c.id, c] as const))('%s vague has 2 or 3 requirements', (_id, c) => {
    expect(c.vague.mustHaves.length).toBeGreaterThanOrEqual(2);
    expect(c.vague.mustHaves.length).toBeLessThanOrEqual(3);
  });

  it.each(cases.positive.map((c) => [c.id, c] as const))(
    '%s defined text has 4 to 8 requirements in both lists',
    (_id, c) => {
      const { mustHaves, niceToHaves } = c.defined;
      expect(mustHaves.length).toBeGreaterThanOrEqual(2);
      expect(niceToHaves.length).toBeGreaterThanOrEqual(1);
      expect(mustHaves.length + niceToHaves.length).toBeGreaterThanOrEqual(4);
      expect(mustHaves.length + niceToHaves.length).toBeLessThanOrEqual(8);
    },
  );
});

describe('negative cases', () => {
  it.each(cases.negative.map((c) => [c.id, c] as const))(
    '%s defined text has both lists',
    (_id, c) => {
      expect(c.defined.mustHaves.length).toBeGreaterThanOrEqual(2);
      expect(c.defined.niceToHaves.length).toBeGreaterThanOrEqual(1);
    },
  );
});
