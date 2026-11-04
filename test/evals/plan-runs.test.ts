import { describe, expect, it } from 'vitest';
import { loadCases, renderDefined } from '../../evals/cases/schema.ts';
import { HOSTS, MODELS, planRuns } from '../../evals/harness/plan-runs.ts';

const cases = loadCases('evals/cases');

function hostCounts(pass: number): number[] {
  const runs = planRuns(cases, pass);
  return HOSTS.map((host) => runs.filter((run) => run.host === host).length);
}

describe('planRuns', () => {
  it('plans 40 positive, 6 negative, 6 trigger and 6 partial runs', () => {
    const runs = planRuns(cases, 0);
    expect(runs).toHaveLength(58);
    expect(runs.filter((run) => run.kind === 'partial')).toHaveLength(6);
    expect(runs.filter((run) => run.kind === 'positive-vague')).toHaveLength(20);
    expect(runs.filter((run) => run.kind === 'positive-defined')).toHaveLength(20);
    expect(runs.filter((run) => run.kind === 'negative')).toHaveLength(6);
    expect(runs.filter((run) => run.kind === 'trigger')).toHaveLength(6);
  });

  it('plans 36 Sonnet and 22 DeepSeek runs in pass 0, each host with at least one partial run', () => {
    expect(HOSTS).toEqual(['claude-sonnet', 'opencode-deepseek-flash']);
    expect(hostCounts(0)).toEqual([36, 22]);
    const partials = planRuns(cases, 0).filter((run) => run.kind === 'partial');
    expect(partials.filter((run) => run.host === 'claude-sonnet')).toHaveLength(4);
    expect(partials.filter((run) => run.host === 'opencode-deepseek-flash')).toHaveLength(2);
  });

  it('appends the partial runs after the trigger runs, so the earlier runs keep their index', () => {
    const runs = planRuns(cases, 0);
    expect(runs.slice(0, 52).every((run) => run.kind !== 'partial')).toBe(true);
    expect(runs.slice(52).map((run) => run.caseId)).toEqual(cases.partial.map((c) => c.id));
    const without = planRuns({ ...cases, partial: [] }, 0);
    expect(runs.slice(0, 52)).toEqual(without);
  });

  it('gives every host at least one run of every kind in every pass', () => {
    for (const pass of [0, 1, 2, 3, 4, 7]) {
      const runs = planRuns(cases, pass);
      for (const host of HOSTS) {
        for (const kind of ['positive-vague', 'positive-defined', 'negative', 'trigger', 'partial']) {
          expect(runs.filter((r) => r.host === host && r.kind === kind).length, `${host} ${kind} pass ${pass}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('sends run i to Sonnet when (i + pass) % 5 < 3 and to DeepSeek otherwise, so each pass shifts every run', () => {
    const expectedHost = (i: number, pass: number) => ((i + pass) % 5 < 3 ? 'claude-sonnet' : 'opencode-deepseek-flash');
    for (const pass of [0, 1, 2, 3, 4]) {
      planRuns(cases, pass).forEach((run, i) => expect(run.host).toBe(expectedHost(i, pass)));
    }
    const pass0 = planRuns(cases, 0);
    const pass1 = planRuns(cases, 1);
    pass0.forEach((run, i) => {
      expect(pass1[i]!.caseId).toBe(run.caseId);
      expect(pass1[i]!.kind).toBe(run.kind);
    });
  });

  it('puts each case text in the prompt of its kind', () => {
    const runs = planRuns(cases, 0);
    const first = cases.positive[0]!;
    expect(runs.find((r) => r.caseId === first.id && r.kind === 'positive-vague')!.prompt).toBe(first.vague.text);
    expect(runs.find((r) => r.caseId === first.id && r.kind === 'positive-defined')!.prompt).toBe(renderDefined(first.defined));
    const negative = cases.negative[0]!;
    expect(runs.find((r) => r.caseId === negative.id)!.prompt).toBe(renderDefined(negative.defined));
    const trigger = cases.trigger[0]!;
    expect(runs.find((r) => r.caseId === trigger.id)!.prompt).toBe(trigger.prompt);
    const partial = cases.partial[0]!;
    expect(runs.find((r) => r.caseId === partial.id)!.prompt).toBe(partial.text);
  });

  it('carries the requirements to score each prompt against', () => {
    const runs = planRuns(cases, 0);
    const first = cases.positive[0]!;
    expect(runs.find((r) => r.caseId === first.id && r.kind === 'positive-vague')!.mustHaves).toEqual(first.vague.mustHaves);
    expect(runs.find((r) => r.caseId === first.id && r.kind === 'positive-defined')!.mustHaves).toEqual(first.defined.mustHaves);
    const negative = cases.negative[0]!;
    expect(runs.find((r) => r.caseId === negative.id)!.mustHaves).toEqual(negative.defined.mustHaves);
    expect(runs.find((r) => r.kind === 'trigger')!.mustHaves).toBeUndefined();
    const partial = cases.partial[0]!;
    const partialRun = runs.find((r) => r.caseId === partial.id)!;
    expect(partialRun.mustHaves).toEqual(partial.mustHaves);
    expect(partialRun.foundationMustHaves).toEqual(partial.foundationMustHaves);
    expect(runs.filter((r) => r.kind !== 'partial').every((r) => r.foundationMustHaves === undefined)).toBe(true);
  });

  it('names the models of the two hosts', () => {
    expect(MODELS).toEqual({
      'claude-sonnet': 'claude-sonnet-5-5',
      'opencode-deepseek-flash': 'deepseek/deepseek-flash',
    });
  });
});
