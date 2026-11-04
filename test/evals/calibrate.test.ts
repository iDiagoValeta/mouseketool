import { describe, expect, it } from 'vitest';
import { parseRepoName } from '../../src/domain/repo-name.ts';
import type { PositiveCase } from '../../evals/cases/schema.ts';
import { calibrate } from '../../evals/harness/calibrate.ts';
import type { Judge } from '../../evals/harness/judge.ts';

const makeCase = (id: string, ...repos: string[]): PositiveCase => ({
  id,
  vague: { text: 'I want to build x', mustHaves: ['vague a'] },
  defined: { mustHaves: ['defined a', 'defined b'], niceToHaves: [] },
  knownMatches: repos.map((r) => parseRepoName(r)),
});

/** Meets a requirement list when `meets(repo, list[0])` says so; throws for repos in `broken`. */
function fake(meets: (repo: string, first: string) => boolean, broken: string[] = []): { judge: Judge; calls: string[] } {
  const calls: string[] = [];
  const judge: Judge = {
    async judge(repo, items) {
      calls.push(`${repo} ${items[0]}`);
      if (broken.includes(repo)) throw new Error('no verdict');
      const ok = meets(repo, items[0]!);
      return { repo, meets: ok, missing: ok ? [] : [items[0]!] };
    },
  };
  return { judge, calls };
}

describe('calibrate', () => {
  it('judges every known match against the defined and the vague requirements, one line each', async () => {
    const { judge, calls } = fake(() => true);
    const lines: string[] = [];
    const ok = await calibrate([makeCase('c1', 'a/a', 'b/b')], judge, (line) => lines.push(line));

    expect(ok).toBe(true);
    expect(calls).toEqual(['a/a defined a', 'a/a vague a', 'b/b defined a', 'b/b vague a']);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('c1 defined a/a meets');
    expect(lines[1]).toBe('c1 vague a/a meets');
  });

  it('passes when at least one known match meets both versions', async () => {
    const { judge } = fake((repo) => repo === 'b/b');
    expect(await calibrate([makeCase('c1', 'a/a', 'b/b')], judge, () => {})).toBe(true);
  });

  it('fails when no known match meets both, even if each version is met by a different repo', async () => {
    const { judge } = fake((repo, first) => (repo === 'a/a' ? first === 'defined a' : first === 'vague a'));
    const lines: string[] = [];
    expect(await calibrate([makeCase('c1', 'a/a', 'b/b')], judge, (l) => lines.push(l))).toBe(false);
    expect(lines.some((l) => l.startsWith('NOT CALIBRATED: c1'))).toBe(true);
  });

  it('prints what is missing and counts a judge error as not meeting', async () => {
    const { judge } = fake(() => false, ['b/b']);
    const lines: string[] = [];
    const ok = await calibrate([makeCase('c1', 'a/a', 'b/b')], judge, (l) => lines.push(l));
    expect(ok).toBe(false);
    expect(lines).toContain('c1 defined a/a missing: defined a');
    expect(lines).toContain('c1 vague b/b JUDGE ERROR: no verdict');
  });

  it('fails if any case fails, even when others pass', async () => {
    const { judge } = fake((repo) => repo === 'a/a');
    expect(await calibrate([makeCase('c1', 'a/a'), makeCase('c2', 'z/z')], judge, () => {})).toBe(false);
  });
});
