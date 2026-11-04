import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRunLog } from '../../evals/harness/workspace.ts';
import { parseRepoName, type RepoName } from '../../src/domain/repo-name.ts';
import type { Judge, Judgment } from '../../evals/harness/judge.ts';
import { HOSTS, type Run } from '../../evals/harness/plan-runs.ts';
import { describeScore, meetsThresholds, scoreRun, summarize, type PerHostSummary, type Score } from '../../evals/harness/score.ts';

function run(kind: Run['kind'], host: Run['host'] = 'claude-sonnet'): Run {
  return { caseId: 'c', kind, prompt: 'p', host };
}

const mustHaves = ['does a', 'does b'];
const names = (...repos: string[]) => repos.map((r) => parseRepoName(r));

/** A judge that meets the requirements for the listed repos, fails the `broken` ones and rejects the rest. */
function fakeJudge(meeting: string[], broken: string[] = []): { judge: Judge; calls: RepoName[] } {
  const calls: RepoName[] = [];
  const judge: Judge = {
    async judge(repo, items) {
      calls.push(repo);
      expect(items).toEqual(mustHaves);
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
  const outcome = (finalText: string, searchedRepos: string[], triggered = true) => ({
    finalText,
    searchedRepos: names(...searchedRepos),
    triggered,
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
});

describe('scoreRun, negative', () => {
  const outcome = (finalText: string, searchedRepos: string[] = []) => ({ finalText, searchedRepos: names(...searchedRepos), triggered: true });

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
});

describe('scoreRun, trigger', () => {
  it('passes only when the server was never called', async () => {
    const { judge, calls } = fakeJudge([]);
    const score = (triggered: boolean) =>
      scoreRun(run('trigger'), { finalText: 'done', searchedRepos: [], triggered }, undefined, judge);
    expect(await score(false)).toEqual({ verdict: true });
    expect(await score(true)).toEqual({ verdict: false });
    expect(calls).toEqual([]);
  });
});

describe('scoreRun, host run that errored', () => {
  const error = 'claude run failed: error_max_turns';
  const perfect = { finalText: 'Verdict: adapt foo/bar', searchedRepos: names('foo/bar'), triggered: true };

  it('scores false on retrieval and hit for a positive run, without calling the judge', async () => {
    const { judge, calls } = fakeJudge(['foo/bar']);
    for (const kind of ['positive-defined', 'positive-vague'] as const) {
      expect(await scoreRun(run(kind), { ...perfect, error }, mustHaves, judge)).toEqual({ retrieval: false, verdict: false });
    }
    expect(calls).toEqual([]);
  });

  it('scores a negative false even if its text says build', async () => {
    const { judge } = fakeJudge([]);
    const outcome = { finalText: 'Verdict: build', searchedRepos: [], triggered: true, error };
    expect(await scoreRun(run('negative'), outcome, mustHaves, judge)).toEqual({ verdict: false });
  });

  it('scores a trigger false even though the empty log looks like "not triggered"', async () => {
    const { judge } = fakeJudge([]);
    const outcome = { finalText: '', searchedRepos: [], triggered: false, error };
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
      { host: 'claude-sonnet', hitDefined: 0.5, hitVague: 1, negatives: 1, triggers: 1 },
      { host: 'opencode-deepseek-flash', hitDefined: 1, hitVague: 1, negatives: 1, triggers: 0 },
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
