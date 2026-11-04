import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRunLog } from '../../evals/harness/workspace.ts';
import { parseRepoName, type RepoName } from '../../src/domain/repo-name.ts';
import type { Judge, Judgment } from '../../evals/harness/judge.ts';
import { HOSTS, type Run } from '../../evals/harness/plan-runs.ts';
import { buildReport, describeScore, finalLine, meetsThresholds, scoreRun, summarize, type PerHostSummary, type Score } from '../../evals/harness/score.ts';

function run(kind: Run['kind'], host: Run['host'] = 'claude-sonnet'): Run {
  return { caseId: 'c', kind, prompt: 'p', host };
}

const mustHaves = ['does a', 'does b'];
const names = (...repos: string[]) => repos.map((r) => parseRepoName(r));

/** A judge that meets the requirements for the listed repos, fails the `broken` ones and rejects the rest. */
function fakeJudge(meeting: string[], broken: string[] = [], asked: string[] = mustHaves): { judge: Judge; calls: RepoName[] } {
  const calls: RepoName[] = [];
  const judge: Judge = {
    async judge(repo, items) {
      calls.push(repo);
      expect(items).toEqual(asked);
      if (broken.includes(repo)) throw new Error(`no verdict for ${repo}`);
      const meets = meeting.includes(repo);
      return { repo, meets, missing: meets ? [] : ['does b'] };
    },
  };
  return { judge, calls };
}

const found = (repo: string): Judgment => ({ repo: parseRepoName(repo), meets: true, missing: [] });
const notFound = (repo: string): Judgment => ({ repo: parseRepoName(repo), meets: false, missing: ['does b'] });

describe('scoreRun, positive', () => {
  const outcome = (finalText: string, searchedRepos: string[], triggered = true, fileReads = 1) => ({
    finalText,
    searchedRepos: names(...searchedRepos),
    triggered,
    fileReads,
  });

  it('is a hit when a recommended repo from the search meets the requirements', async () => {
    const { judge } = fakeJudge(['foo/bar']);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt foo/bar', ['foo/bar']), mustHaves, judge);
    expect(score).toEqual({ retrieval: true, verdict: true, judgments: [found('foo/bar')] });
  });

  it('accepts a repo nobody listed beforehand: only the requirements decide', async () => {
    const { judge } = fakeJudge(['other/tool']);
    const score = await scoreRun(run('positive-vague'), outcome('Verdict: reuse other/tool', ['other/tool', 'x/y']), mustHaves, judge);
    expect(score.verdict).toBe(true);
  });

  it.each(['reuse', 'adapt', 'base'])('judges the repos of a %s verdict', async (decision) => {
    const { judge, calls } = fakeJudge(['foo/bar']);
    const score = await scoreRun(run('positive-defined'), outcome(`Verdict: ${decision} foo/bar`, ['foo/bar']), mustHaves, judge);
    expect(score.verdict).toBe(true);
    expect(calls).toEqual(['foo/bar']);
  });

  it('ignores recommended repos that the search never returned, as they came from memory', async () => {
    const { judge, calls } = fakeJudge(['foo/bar']);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt foo/bar', ['x/y']), mustHaves, judge);
    expect(score).toEqual({ retrieval: false, verdict: false, judgments: [] });
    expect(calls).toEqual([]);
  });

  it('does not judge a repo the host only inspected, even though the server logged it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mouseketool-score-test-'));
    try {
      const runLog = join(dir, 'run.jsonl');
      writeFileSync(
        runLog,
        '{"tool":"search_repositories","repos":["a/b"]}\n{"tool":"inspect_repository","repos":["x/y"]}\n',
      );
      const { judge, calls } = fakeJudge(['x/y']);
      const score = await scoreRun(
        run('positive-defined'),
        { finalText: 'Verdict: reuse x/y', ...readRunLog({ dir, runLog }) },
        mustHaves,
        judge,
      );
      expect(score).toEqual({ retrieval: false, verdict: false, judgments: [] });
      expect(calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a miss when the recommended repo does not meet the requirements, but retrieval holds', async () => {
    const { judge } = fakeJudge([]);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt foo/bar', ['foo/bar']), mustHaves, judge);
    expect(score).toEqual({ retrieval: true, verdict: false, judgments: [notFound('foo/bar')] });
  });

  it('judges at most the first 3 recommended repos and stops at the first that meets', async () => {
    const all = ['a/a', 'b/b', 'c/c', 'd/d'];
    const first = fakeJudge(['d/d']);
    const miss = await scoreRun(run('positive-defined'), outcome(`Verdict: adapt ${all.join(', ')}`, all), mustHaves, first.judge);
    expect(first.calls).toEqual(['a/a', 'b/b', 'c/c']);
    expect(miss.verdict).toBe(false);

    const second = fakeJudge(['b/b', 'c/c']);
    const hit = await scoreRun(run('positive-defined'), outcome(`Verdict: adapt ${all.join(', ')}`, all), mustHaves, second.judge);
    expect(second.calls).toEqual(['a/a', 'b/b']);
    expect(hit.judgments).toEqual([notFound('a/a'), found('b/b')]);
    expect(hit.verdict).toBe(true);
  });

  it('records a judge error, counts that repo as not meeting and moves on to the next', async () => {
    const { judge } = fakeJudge(['b/b'], ['a/a']);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt a/a, b/b', ['a/a', 'b/b']), mustHaves, judge);
    expect(score.verdict).toBe(true);
    expect(score.judgments).toEqual([found('b/b')]);
    expect(score.judgeError).toContain('a/a');
    expect(score.judgeError).toContain('no verdict for a/a');
  });

  it('is a miss when the only judge call failed', async () => {
    const { judge } = fakeJudge([], ['foo/bar']);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt foo/bar', ['foo/bar']), mustHaves, judge);
    expect(score).toMatchObject({ retrieval: true, verdict: false, judgments: [] });
    expect(score.judgeError).toContain('foo/bar');
  });

  it('does not judge, and misses, on build, on no verdict or when the server was never called', async () => {
    const { judge, calls } = fakeJudge(['foo/bar']);
    const verdict = async (o: ReturnType<typeof outcome>) => (await scoreRun(run('positive-defined'), o, mustHaves, judge)).verdict;
    expect(await verdict(outcome('Verdict: build', ['foo/bar']))).toBe(false);
    expect(await verdict(outcome('no verdict here', ['foo/bar']))).toBe(false);
    expect(await verdict(outcome('Verdict: adapt foo/bar', ['foo/bar'], false))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('needs the requirements', async () => {
    const { judge } = fakeJudge([]);
    await expect(scoreRun(run('positive-defined'), outcome('Verdict: build', []), undefined, judge)).rejects.toThrow();
  });

  it('scores false with noCodeRead when it would be a hit but the host read no code', async () => {
    const { judge, calls } = fakeJudge(['foo/bar']);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt foo/bar', ['foo/bar'], true, 0), mustHaves, judge);
    expect(score).toEqual({ retrieval: true, verdict: false, noCodeRead: true, judgments: [found('foo/bar')] });
    expect(calls).toEqual(['foo/bar']);
  });

  it('does not flag noCodeRead on a miss that was a miss anyway', async () => {
    const { judge } = fakeJudge([]);
    const score = await scoreRun(run('positive-defined'), outcome('Verdict: adapt foo/bar', ['foo/bar'], true, 0), mustHaves, judge);
    expect(score.verdict).toBe(false);
    expect(score.noCodeRead).toBeUndefined();
    expect((await scoreRun(run('positive-defined'), outcome('Verdict: build', ['foo/bar'], true, 0), mustHaves, judge)).noCodeRead).toBeUndefined();
  });

  it('is a hit with a single file read', async () => {
    const { judge } = fakeJudge(['foo/bar']);
    const score = await scoreRun(run('positive-vague'), outcome('Verdict: adapt foo/bar', ['foo/bar'], true, 1), mustHaves, judge);
    expect(score.verdict).toBe(true);
    expect(score.noCodeRead).toBeUndefined();
  });
});

describe('scoreRun, negative', () => {
  const outcome = (finalText: string, searchedRepos: string[] = [], fileReads = 1) => ({
    finalText,
    searchedRepos: names(...searchedRepos),
    triggered: true,
    fileReads,
  });

  it('passes on build and on base without judging, since nothing is recommended as a cover', async () => {
    const { judge, calls } = fakeJudge(['a/b']);
    expect(await scoreRun(run('negative'), outcome('Verdict: build'), mustHaves, judge)).toEqual({ verdict: true });
    expect(await scoreRun(run('negative'), outcome('Verdict: base a/b', ['a/b']), mustHaves, judge)).toEqual({ verdict: true });
    expect(calls).toEqual([]);
  });

  it('is a miss on reuse or adapt of a repo that does not meet the requirements', async () => {
    const { judge } = fakeJudge([]);
    const score = await scoreRun(run('negative'), outcome('Verdict: adapt a/b', ['a/b']), mustHaves, judge);
    expect(score).toEqual({ verdict: false, judgments: [notFound('a/b')] });
  });

  it('is a miss on reuse of a repo the search never returned, without judging it', async () => {
    const { judge, calls } = fakeJudge(['a/b']);
    const score = await scoreRun(run('negative'), outcome('Verdict: reuse a/b', ['x/y']), mustHaves, judge);
    expect(score).toEqual({ verdict: false, judgments: [] });
    expect(calls).toEqual([]);
  });

  it('flags the case as covered when a recommended repo meets every requirement', async () => {
    const { judge } = fakeJudge(['a/b']);
    const score = await scoreRun(run('negative'), outcome('Verdict: reuse a/b', ['a/b']), mustHaves, judge);
    expect(score).toEqual({ verdict: true, caseCovered: true, judgments: [found('a/b')] });
  });

  it('only judges repos the search returned, up to 3', async () => {
    const { judge, calls } = fakeJudge([]);
    await scoreRun(run('negative'), outcome('Verdict: adapt m/m, a/a, b/b, c/c, d/d', ['a/a', 'b/b', 'c/c', 'd/d']), mustHaves, judge);
    expect(calls).toEqual(['a/a', 'b/b', 'c/c']);
  });

  it('treats a judge error as not covered, so a miss, and records it', async () => {
    const { judge } = fakeJudge([], ['a/b']);
    const score = await scoreRun(run('negative'), outcome('Verdict: adapt a/b', ['a/b']), mustHaves, judge);
    expect(score.verdict).toBe(false);
    expect(score.caseCovered).toBeUndefined();
    expect(score.judgeError).toContain('a/b');
  });

  it('is a miss when there is no verdict line, since that is not a build it recommendation', async () => {
    const { judge } = fakeJudge([]);
    expect((await scoreRun(run('negative'), outcome('Sounds great, let us design it.'), mustHaves, judge)).verdict).toBe(false);
  });

  it('scores false with noCodeRead on a build or base that read no code', async () => {
    const { judge } = fakeJudge([]);
    expect(await scoreRun(run('negative'), outcome('Verdict: build', [], 0), mustHaves, judge)).toEqual({ verdict: false, noCodeRead: true });
    expect(await scoreRun(run('negative'), outcome('Verdict: base a/b', ['a/b'], 0), mustHaves, judge)).toEqual({ verdict: false, noCodeRead: true });
  });

  it('keeps the covered flag, but scores false with noCodeRead, when a covering recommendation read no code', async () => {
    const { judge } = fakeJudge(['a/b']);
    const score = await scoreRun(run('negative'), outcome('Verdict: reuse a/b', ['a/b'], 0), mustHaves, judge);
    expect(score).toEqual({ verdict: false, noCodeRead: true, caseCovered: true, judgments: [found('a/b')] });
  });

  it('does not flag noCodeRead on a miss that was a miss anyway', async () => {
    const { judge } = fakeJudge([]);
    const score = await scoreRun(run('negative'), outcome('Verdict: adapt a/b', ['a/b'], 0), mustHaves, judge);
    expect(score).toEqual({ verdict: false, judgments: [notFound('a/b')] });
  });
});

describe('scoreRun, partial', () => {
  const foundation = ['foundation a'];
  const partialRun = (): Run => ({ caseId: 'p', kind: 'partial', prompt: 'p', mustHaves, foundationMustHaves: foundation, host: 'claude-sonnet' });
  const outcome = (finalText: string, searchedRepos: string[] = [], fileReads = 1, triggered = true) => ({
    finalText,
    searchedRepos: names(...searchedRepos),
    triggered,
    fileReads,
  });
  /** Meets `foundation` for the repos in `onFoundation` and the full `mustHaves` for those in `onWhole`. */
  function judgeByList(onFoundation: string[], onWhole: string[]): { judge: Judge; asked: { repo: RepoName; items: string[] }[] } {
    const asked: { repo: RepoName; items: string[] }[] = [];
    const judge: Judge = {
      async judge(repo, items) {
        asked.push({ repo, items });
        const meets = (items === foundation || items.join() === foundation.join() ? onFoundation : onWhole).includes(repo);
        return { repo, meets, missing: meets ? [] : [items[0]!] };
      },
    };
    return { judge, asked };
  }

  it('is a hit on base when a recommended repo from the search meets the foundation requirements', async () => {
    const { judge, asked } = judgeByList(['a/a'], []);
    const score = await scoreRun(partialRun(), outcome('Verdict: base a/a', ['a/a']), mustHaves, judge);
    expect(score).toEqual({ verdict: true, judgments: [{ repo: 'a/a', meets: true, missing: [] }] });
    expect(asked).toEqual([{ repo: 'a/a', items: foundation }]);
  });

  it('judges at most 3 base repos against the foundation and stops at the first that meets', async () => {
    const all = ['a/a', 'b/b', 'c/c', 'd/d'];
    const first = judgeByList(['d/d'], []);
    const miss = await scoreRun(partialRun(), outcome(`Verdict: base ${all.join(', ')}`, all), mustHaves, first.judge);
    expect(first.asked.map((a) => a.repo)).toEqual(['a/a', 'b/b', 'c/c']);
    expect(miss.verdict).toBe(false);

    const second = judgeByList(['b/b', 'c/c'], []);
    const hit = await scoreRun(partialRun(), outcome(`Verdict: base ${all.join(', ')}`, all), mustHaves, second.judge);
    expect(second.asked.map((a) => a.repo)).toEqual(['a/a', 'b/b']);
    expect(hit.verdict).toBe(true);
  });

  it('ignores a base repo the search never returned, so it comes from memory', async () => {
    const { judge, asked } = judgeByList(['a/a'], []);
    const score = await scoreRun(partialRun(), outcome('Verdict: base a/a', ['x/y']), mustHaves, judge);
    expect(score).toEqual({ verdict: false, judgments: [] });
    expect(asked).toEqual([]);
  });

  it('is a miss on base when no recommended repo meets the foundation requirements', async () => {
    const { judge } = judgeByList([], []);
    const score = await scoreRun(partialRun(), outcome('Verdict: base a/a', ['a/a']), mustHaves, judge);
    expect(score).toEqual({ verdict: false, judgments: [{ repo: 'a/a', meets: false, missing: ['foundation a'] }] });
  });

  it('scores false with noCodeRead when the base is right but the host read no code', async () => {
    const { judge } = judgeByList(['a/a'], []);
    const score = await scoreRun(partialRun(), outcome('Verdict: base a/a', ['a/a'], 0), mustHaves, judge);
    expect(score).toEqual({ verdict: false, noCodeRead: true, judgments: [{ repo: 'a/a', meets: true, missing: [] }] });
  });

  it('is a miss on build, because a mature foundation exists, without judging', async () => {
    const { judge, asked } = judgeByList(['a/a'], ['a/a']);
    expect(await scoreRun(partialRun(), outcome('Verdict: build', ['a/a']), mustHaves, judge)).toEqual({ verdict: false });
    expect(asked).toEqual([]);
  });

  it('is a miss, without judging, on no verdict line, no trigger or a failed host run', async () => {
    const { judge, asked } = judgeByList(['a/a'], ['a/a']);
    const score = async (o: ReturnType<typeof outcome> & { error?: string }) => (await scoreRun(partialRun(), o, mustHaves, judge)).verdict;
    expect(await score(outcome('no verdict here', ['a/a']))).toBe(false);
    expect(await score(outcome('Verdict: base a/a', ['a/a'], 1, false))).toBe(false);
    expect(await score({ ...outcome('Verdict: base a/a', ['a/a']), error: 'claude run failed' })).toBe(false);
    expect(asked).toEqual([]);
  });

  it.each(['reuse', 'adapt'])('judges the repos of a %s verdict against the whole idea and flags a case a project covers', async (decision) => {
    const { judge, asked } = judgeByList([], ['a/a']);
    const score = await scoreRun(partialRun(), outcome(`Verdict: ${decision} a/a`, ['a/a']), mustHaves, judge);
    expect(score).toEqual({ verdict: true, caseCovered: true, judgments: [{ repo: 'a/a', meets: true, missing: [] }] });
    expect(asked).toEqual([{ repo: 'a/a', items: mustHaves }]);
  });

  it('is a miss on reuse or adapt of a repo that does not cover the whole idea', async () => {
    const { judge } = judgeByList(['a/a'], []);
    const score = await scoreRun(partialRun(), outcome('Verdict: reuse a/a', ['a/a']), mustHaves, judge);
    expect(score).toEqual({ verdict: false, judgments: [{ repo: 'a/a', meets: false, missing: ['does a'] }] });
    expect(score.caseCovered).toBeUndefined();
  });

  it('counts a judge error as not meeting, on base and on reuse, and records it', async () => {
    const throwing: Judge = { judge: async (repo) => { throw new Error(`no verdict for ${repo}`); } };
    const base = await scoreRun(partialRun(), outcome('Verdict: base a/a', ['a/a']), mustHaves, throwing);
    expect(base).toMatchObject({ verdict: false, judgments: [] });
    expect(base.judgeError).toContain('a/a');
    const reuse = await scoreRun(partialRun(), outcome('Verdict: reuse a/a', ['a/a']), mustHaves, throwing);
    expect(reuse.verdict).toBe(false);
    expect(reuse.caseCovered).toBeUndefined();
    expect(reuse.judgeError).toContain('a/a');
  });

  it('needs the foundation requirements', async () => {
    const { judge } = judgeByList([], []);
    const { foundationMustHaves: _omit, ...without } = partialRun();
    await expect(scoreRun(without, outcome('Verdict: base a/a', ['a/a']), mustHaves, judge)).rejects.toThrow();
  });
});

describe('scoreRun, trigger', () => {
  it('passes only when the server was never called', async () => {
    const { judge, calls } = fakeJudge([]);
    const score = (triggered: boolean) =>
      scoreRun(run('trigger'), { finalText: 'done', searchedRepos: [], triggered, fileReads: 0 }, undefined, judge);
    expect(await score(false)).toEqual({ verdict: true });
    expect(await score(true)).toEqual({ verdict: false });
    expect(calls).toEqual([]);
  });
});

describe('scoreRun, host run that errored', () => {
  const error = 'claude run failed: error_max_turns';
  const perfect = { finalText: 'Verdict: adapt foo/bar', searchedRepos: names('foo/bar'), triggered: true, fileReads: 1 };

  it('scores false on retrieval and hit for a positive run, without calling the judge', async () => {
    const { judge, calls } = fakeJudge(['foo/bar']);
    for (const kind of ['positive-defined', 'positive-vague'] as const) {
      expect(await scoreRun(run(kind), { ...perfect, error }, mustHaves, judge)).toEqual({ retrieval: false, verdict: false });
    }
    expect(calls).toEqual([]);
  });

  it('scores a negative false even if its text says build', async () => {
    const { judge } = fakeJudge([]);
    const outcome = { finalText: 'Verdict: build', searchedRepos: [], triggered: true, fileReads: 1, error };
    expect(await scoreRun(run('negative'), outcome, mustHaves, judge)).toEqual({ verdict: false });
  });

  it('scores a trigger false even though the empty log looks like "not triggered"', async () => {
    const { judge } = fakeJudge([]);
    const outcome = { finalText: '', searchedRepos: [], triggered: false, fileReads: 0, error };
    expect(await scoreRun(run('trigger'), outcome, undefined, judge)).toEqual({ verdict: false });
  });
});

describe('describeScore', () => {
  it('prints the hit and retrieval of a run without a judge', () => {
    expect(describeScore({ retrieval: false, verdict: false })).toBe('retrieval=miss hit=miss');
    expect(describeScore({ verdict: true })).toBe('hit=ok');
  });

  it('prints every judged repo with whether it meets or what it misses', () => {
    const score: Score = { retrieval: true, verdict: true, judgments: [notFound('a/a'), found('b/b')] };
    expect(describeScore(score)).toBe('retrieval=ok hit=ok judged=[a/a: missing (does b), b/b: meets]');
  });

  it('prints noCodeRead when the run would have passed but read no code', () => {
    expect(describeScore({ verdict: false, noCodeRead: true })).toBe('hit=miss noCodeRead');
    expect(describeScore({ verdict: false })).toBe('hit=miss');
  });

  it('prints a judge error', () => {
    expect(describeScore({ verdict: false, judgments: [], judgeError: 'a/a: no verdict' })).toBe(
      'hit=miss judged=[] judgeError=a/a: no verdict',
    );
  });
});

describe('summarize', () => {
  const result = (kind: Run['kind'], host: Run['host'], score: Score) => ({ run: run(kind, host), score });

  it('reports ratios per host over its own share, with the hit read from the verdict', () => {
    const summaries = summarize([
      result('positive-defined', 'claude-sonnet', { retrieval: true, verdict: true }),
      result('positive-defined', 'claude-sonnet', { retrieval: true, verdict: false }),
      result('positive-vague', 'claude-sonnet', { retrieval: false, verdict: true }),
      result('negative', 'opencode-deepseek-flash', { verdict: true }),
      result('trigger', 'opencode-deepseek-flash', { verdict: false }),
    ]);
    expect(summaries).toEqual([
      { host: 'claude-sonnet', hitDefined: 0.5, hitVague: 1, negatives: 1, triggers: 1, partials: 1 },
      { host: 'opencode-deepseek-flash', hitDefined: 1, hitVague: 1, negatives: 1, triggers: 0, partials: 1 },
    ]);
  });

  it('reports the share of partial runs that scored a verdict, per host', () => {
    const summaries = summarize([
      result('partial', 'claude-sonnet', { verdict: true }),
      result('partial', 'claude-sonnet', { verdict: false }),
      result('partial', 'claude-sonnet', { verdict: false, noCodeRead: true }),
      result('partial', 'claude-sonnet', { verdict: true }),
      result('partial', 'opencode-deepseek-flash', { verdict: false }),
    ]);
    expect(summaries.map((s) => [s.host, s.partials])).toEqual([
      ['claude-sonnet', 0.5],
      ['opencode-deepseek-flash', 0],
    ]);
  });

  it('leaves out hosts without runs', () => {
    expect(summarize([])).toEqual([]);
  });
});

describe('meetsThresholds', () => {
  const good: PerHostSummary = {
    host: 'claude-sonnet',
    hitDefined: 0.8,
    hitVague: 0.6,
    negatives: 5 / 6,
    triggers: 1,
    partials: 0.5,
  };
  const all = (override: Partial<PerHostSummary>) => HOSTS.map((host) => ({ ...good, host, ...override }));

  it('passes exactly at every boundary', () => {
    expect(meetsThresholds(all({}))).toBe(true);
  });

  it.each([
    ['hitDefined', 0.79],
    ['hitVague', 0.59],
    ['negatives', 0.83],
    ['triggers', 0.99],
    ['partials', 0.49],
  ] as const)('fails just under the %s boundary', (field, value) => {
    expect(meetsThresholds(all({ [field]: value }))).toBe(false);
  });

  it('fails when a single host misses', () => {
    const summaries = all({});
    summaries[1] = { ...summaries[1]!, triggers: 0.5 };
    expect(meetsThresholds(summaries)).toBe(false);
  });

  it('fails with no summaries', () => {
    expect(meetsThresholds([])).toBe(false);
  });
});

describe('buildReport', () => {
  const passing = (kind: Run['kind'], host: Run['host'], caseId: string, score: Score = { verdict: true }) => ({
    run: { ...run(kind, host), caseId },
    score,
  });
  // One passing run of every kind on every host clears each threshold.
  const clean = HOSTS.flatMap((host) => [
    passing('positive-defined', host, 'p1'),
    passing('positive-vague', host, 'p1'),
    passing('negative', host, 'n1'),
    passing('trigger', host, 't1'),
    passing('partial', host, 'q1'),
  ]);
  const done = { complete: true, filtered: false };

  it('passes a complete, unfiltered run that meets the thresholds and covers no negative', () => {
    expect(buildReport(clean, done)).toMatchObject({ passed: true, needsCaseReview: [] });
  });

  it('fails, naming the cases once each, when a negative was covered by a real project', () => {
    const covered: Score = { verdict: true, caseCovered: true, judgments: [found('a/b')] };
    const results = [...clean, passing('negative', 'claude-sonnet', 'n2', covered), passing('negative', 'opencode-deepseek-flash', 'n2', covered)];
    const report = buildReport(results, done);
    // The thresholds hold, so the covered negative alone fails the report.
    expect(meetsThresholds(report.summaries)).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.needsCaseReview).toEqual(['n2']);
  });

  it('fails, naming the case, when a partial case is covered by a real project', () => {
    const covered: Score = { verdict: true, caseCovered: true, judgments: [found('a/b')] };
    const report = buildReport([...clean, passing('partial', 'claude-sonnet', 'q2', covered)], done);
    expect(meetsThresholds(report.summaries)).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.needsCaseReview).toEqual(['q2']);
  });

  it('is never a pass when incomplete or filtered, review or not', () => {
    expect(buildReport(clean, { complete: false, filtered: false }).passed).toBe(false);
    expect(buildReport(clean, { complete: true, filtered: true }).passed).toBe(false);
  });
});

describe('finalLine', () => {
  it('says PASS or FAIL when no case needs review', () => {
    expect(finalLine({ passed: true, needsCaseReview: [] })).toBe('PASS');
    expect(finalLine({ passed: false, needsCaseReview: [] })).toBe('FAIL');
  });

  it('names the cases that need review', () => {
    expect(finalLine({ passed: false, needsCaseReview: ['neg-a', 'neg-b'] })).toBe('FAIL: case review needed: neg-a, neg-b');
  });
});
