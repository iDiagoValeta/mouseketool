import { describe, expect, it } from 'vitest';
import { parseRepoName } from '../../src/domain/repo-name.ts';
import type { PartialCase, PositiveCase } from '../../evals/cases/schema.ts';
import { calibrate, calibratePartial } from '../../evals/harness/calibrate.ts';
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
  it('does not print an empty missing list', async () => {
    const judge: Judge = { judge: async (repo) => ({ repo, meets: false, missing: [] }) };
    const lines: string[] = [];
    await calibrate([makeCase('c1', 'a/a')], judge, (l) => lines.push(l));
    expect(lines[0]).toBe('c1 defined a/a does not meet');
  });

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

const makePartial = (id: string, ...repos: string[]): PartialCase => ({
  id,
  text: 'I want to build x',
  mustHaves: ['whole a', 'whole b'],
  foundationMustHaves: ['foundation a'],
  knownFoundations: repos.map((r) => parseRepoName(r)),
});

describe('calibratePartial', () => {
  it('judges every known foundation against the foundation requirements only, one line each', async () => {
    const { judge, calls } = fake(() => true);
    const lines: string[] = [];
    const ok = await calibratePartial([makePartial('p1', 'a/a', 'b/b')], judge, (line) => lines.push(line));

    expect(ok).toBe(true);
    expect(calls).toEqual(['a/a foundation a', 'b/b foundation a']);
    expect(lines).toEqual(['p1 foundation a/a meets', 'p1 foundation b/b meets']);
  });

  it('passes when at least one known foundation meets', async () => {
    const { judge } = fake((repo) => repo === 'b/b');
    expect(await calibratePartial([makePartial('p1', 'a/a', 'b/b')], judge, () => {})).toBe(true);
  });

  it('fails when no known foundation meets, naming the case', async () => {
    const { judge } = fake(() => false);
    const lines: string[] = [];
    expect(await calibratePartial([makePartial('p1', 'a/a', 'b/b')], judge, (l) => lines.push(l))).toBe(false);
    expect(lines).toContain('p1 foundation a/a missing: foundation a');
    expect(lines).toContain('NOT CALIBRATED: p1 has no known foundation that meets its foundation requirements');
  });

  it('counts a judge error as not meeting and prints it', async () => {
    const { judge } = fake(() => true, ['a/a']);
    const lines: string[] = [];
    expect(await calibratePartial([makePartial('p1', 'a/a')], judge, (l) => lines.push(l))).toBe(false);
    expect(lines).toContain('p1 foundation a/a JUDGE ERROR: no verdict');
  });

  it('fails if any case fails, even when others pass', async () => {
    const { judge } = fake((repo) => repo === 'a/a');
    expect(await calibratePartial([makePartial('p1', 'a/a'), makePartial('p2', 'z/z')], judge, () => {})).toBe(false);
  });
});
