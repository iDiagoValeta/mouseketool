import { describe, expect, it } from 'vitest';
import type { Run } from '../../evals/harness/plan-runs.ts';
import { meetsThresholds, scoreRun, summarize, type PerHostSummary } from '../../evals/harness/score.ts';
import { HOSTS } from '../../evals/harness/plan-runs.ts';

function run(kind: Run['kind'], host: Run['host'] = 'claude-haiku'): Run {
  return { caseId: 'c', kind, prompt: 'p', host };
}

const expected = ['foo/bar'];

describe('scoreRun, positive', () => {
  it('scores retrieval when any expected repo is in the log', () => {
    const outcome = { finalText: 'Verdict: build', logRepos: ['x/y', 'foo/bar'], triggered: true };
    expect(scoreRun(run('positive-defined'), outcome, expected).retrieval).toBe(true);
  });

  it('fails retrieval when no expected repo is in the log', () => {
    const outcome = { finalText: 'Verdict: adapt foo/bar', logRepos: ['x/y'], triggered: true };
    expect(scoreRun(run('positive-vague'), outcome, expected)).toEqual({ retrieval: false, verdict: true });
  });

  it.each(['reuse', 'adapt', 'base'])('passes the verdict on %s of an expected repo', (decision) => {
    const outcome = { finalText: `Verdict: ${decision} baz/qux, foo/bar`, logRepos: ['foo/bar'], triggered: true };
    expect(scoreRun(run('positive-defined'), outcome, expected)).toEqual({ retrieval: true, verdict: true });
  });

  it('fails the verdict on build, on another repo, on no verdict or when not triggered', () => {
    const base = { logRepos: ['foo/bar'], triggered: true };
    const score = (finalText: string, triggered = true) =>
      scoreRun(run('positive-defined'), { ...base, finalText, triggered }, expected).verdict;
    expect(score('Verdict: build')).toBe(false);
    expect(score('Verdict: adapt baz/qux')).toBe(false);
    expect(score('no verdict here')).toBe(false);
    expect(score('Verdict: adapt foo/bar', false)).toBe(false);
  });

  it('needs the expected repos', () => {
    const outcome = { finalText: 'Verdict: build', logRepos: [], triggered: true };
    expect(() => scoreRun(run('positive-defined'), outcome)).toThrow();
  });
});

describe('scoreRun, negative', () => {
  const score = (finalText: string) =>
    scoreRun(run('negative'), { finalText, logRepos: [], triggered: true });

  it('passes on build and on base, which borrows a piece', () => {
    expect(score('Verdict: build')).toEqual({ verdict: true });
    expect(score('Verdict: base a/b')).toEqual({ verdict: true });
  });

  it('fails on reuse and adapt', () => {
    expect(score('Verdict: reuse a/b').verdict).toBe(false);
    expect(score('Verdict: adapt a/b').verdict).toBe(false);
  });

  it('is a miss when there is no verdict line, since that is not a build it recommendation', () => {
    expect(score('Sounds great, let us design it.').verdict).toBe(false);
  });
});

describe('scoreRun, trigger', () => {
  it('passes only when the server was never called', () => {
    const score = (triggered: boolean) =>
      scoreRun(run('trigger'), { finalText: 'done', logRepos: [], triggered });
    expect(score(false)).toEqual({ verdict: true });
    expect(score(true)).toEqual({ verdict: false });
  });
});

describe('scoreRun, host run that errored', () => {
  const error = 'claude run failed: error_max_turns';
  const perfect = { finalText: 'Verdict: adapt foo/bar', logRepos: ['foo/bar'], triggered: true };

  it('scores false on retrieval and verdict for a positive run, whatever the leftovers say', () => {
    expect(scoreRun(run('positive-defined'), { ...perfect, error }, expected)).toEqual({
      retrieval: false,
      verdict: false,
    });
    expect(scoreRun(run('positive-vague'), { ...perfect, error }, expected)).toEqual({
      retrieval: false,
      verdict: false,
    });
  });

  it('scores a negative false even if its text says build', () => {
    const outcome = { finalText: 'Verdict: build', logRepos: [], triggered: true, error };
    expect(scoreRun(run('negative'), outcome)).toEqual({ verdict: false });
  });

  it('scores a trigger false even though the empty log looks like "not triggered"', () => {
    const outcome = { finalText: '', logRepos: [], triggered: false, error };
    expect(scoreRun(run('trigger'), outcome)).toEqual({ verdict: false });
  });
});

describe('summarize', () => {
  const result = (kind: Run['kind'], host: Run['host'], score: { retrieval?: boolean; verdict: boolean }) => ({
    run: run(kind, host),
    score,
  });

  it('reports ratios per host over its own share', () => {
    const summaries = summarize([
      result('positive-defined', 'claude-haiku', { retrieval: true, verdict: true }),
      result('positive-defined', 'claude-haiku', { retrieval: false, verdict: false }),
      result('positive-vague', 'claude-haiku', { retrieval: true, verdict: false }),
      result('negative', 'claude-sonnet', { verdict: true }),
      result('trigger', 'claude-sonnet', { verdict: false }),
    ]);
    expect(summaries).toEqual([
      { host: 'claude-haiku', retrievalDefined: 0.5, retrievalVague: 1, negatives: 1, triggers: 1 },
      { host: 'claude-sonnet', retrievalDefined: 1, retrievalVague: 1, negatives: 1, triggers: 0 },
    ]);
  });

  it('leaves out hosts without runs', () => {
    expect(summarize([])).toEqual([]);
  });
});

describe('meetsThresholds', () => {
  const good: PerHostSummary = {
    host: 'claude-haiku',
    retrievalDefined: 0.8,
    retrievalVague: 0.6,
    negatives: 5 / 6,
    triggers: 1,
  };
  const all = (override: Partial<PerHostSummary>) =>
    HOSTS.map((host) => ({ ...good, host, ...override }));

  it('passes exactly at every boundary', () => {
    expect(meetsThresholds(all({}))).toBe(true);
  });

  it.each([
    ['retrievalDefined', 0.79],
    ['retrievalVague', 0.59],
    ['negatives', 0.83],
    ['triggers', 0.99],
  ] as const)('fails just under the %s boundary', (field, value) => {
    expect(meetsThresholds(all({ [field]: value }))).toBe(false);
  });

  it('fails when a single host misses', () => {
    const summaries = all({});
    summaries[2] = { ...summaries[2]!, triggers: 0.5 };
    expect(meetsThresholds(summaries)).toBe(false);
  });

  it('fails with no summaries', () => {
    expect(meetsThresholds([])).toBe(false);
  });
});
