import { describe, expect, it } from 'vitest';
import { loadCases } from '../../evals/cases/schema.ts';
import { HOSTS, MODELS, planRuns } from '../../evals/harness/plan-runs.ts';

const cases = loadCases('evals/cases');

function hostCounts(pass: number): number[] {
  const runs = planRuns(cases, pass);
  return HOSTS.map((host) => runs.filter((run) => run.host === host).length);
}

describe('planRuns', () => {
  it('plans 40 positive, 6 negative and 6 trigger runs', () => {
    const runs = planRuns(cases, 0);
    expect(runs).toHaveLength(52);
    expect(runs.filter((run) => run.kind === 'positive-vague')).toHaveLength(20);
    expect(runs.filter((run) => run.kind === 'positive-defined')).toHaveLength(20);
    expect(runs.filter((run) => run.kind === 'negative')).toHaveLength(6);
    expect(runs.filter((run) => run.kind === 'trigger')).toHaveLength(6);
  });

  it('gives every host 17 or 18 runs in every pass', () => {
    for (const pass of [0, 1, 2, 3, 7]) {
      for (const count of hostCounts(pass)) {
        expect([17, 18]).toContain(count);
      }
    }
  });

  it('assigns run i to HOSTS[(i + pass) % 3], so pass 1 shifts every run by one host', () => {
    const pass0 = planRuns(cases, 0);
    const pass1 = planRuns(cases, 1);
    pass0.forEach((run, i) => {
      expect(run.host).toBe(HOSTS[i % 3]);
      expect(pass1[i]!.host).toBe(HOSTS[(i + 1) % 3]);
      expect(pass1[i]!.caseId).toBe(run.caseId);
      expect(pass1[i]!.kind).toBe(run.kind);
    });
  });

  it('puts each case text in the prompt of its kind', () => {
    const runs = planRuns(cases, 0);
    const first = cases.positive[0]!;
    expect(runs.find((r) => r.caseId === first.id && r.kind === 'positive-vague')!.prompt).toBe(first.vague);
    expect(runs.find((r) => r.caseId === first.id && r.kind === 'positive-defined')!.prompt).toBe(first.defined);
    const negative = cases.negative[0]!;
    expect(runs.find((r) => r.caseId === negative.id)!.prompt).toBe(negative.defined);
    const trigger = cases.trigger[0]!;
    expect(runs.find((r) => r.caseId === trigger.id)!.prompt).toBe(trigger.prompt);
  });

  it('names the models of the three hosts', () => {
    expect(MODELS).toEqual({
      'claude-haiku': 'claude-haiku-5-5',
      'claude-sonnet': 'claude-sonnet-5-5',
      'opencode-deepseek-flash': 'deepseek/deepseek-flash',
    });
  });
});
