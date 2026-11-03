import type { NegativeCase, PositiveCase, TriggerCase } from '../cases/schema.ts';

export const HOSTS = ['claude-haiku', 'claude-sonnet', 'opencode-deepseek-flash'] as const;
export type Host = (typeof HOSTS)[number];

export const MODELS: Record<Host, string> = {
  'claude-haiku': 'claude-haiku-5-5',
  'claude-sonnet': 'claude-sonnet-5-5',
  'opencode-deepseek-flash': 'deepseek/deepseek-flash',
};

export type RunKind = 'positive-vague' | 'positive-defined' | 'negative' | 'trigger';

export type Run = { caseId: string; kind: RunKind; prompt: string; host: Host };

/**
 * One run per prompt in a fixed order; run `i` goes to `HOSTS[(i + pass) % 3]`.
 * Shifting by the pass number makes every case meet every host over three passes
 * while each host keeps an even share of every kind within one pass.
 */
export function planRuns(
  cases: { positive: PositiveCase[]; negative: NegativeCase[]; trigger: TriggerCase[] },
  pass: number,
): Run[] {
  const prompts: Omit<Run, 'host'>[] = [
    ...cases.positive.flatMap((c) => [
      { caseId: c.id, kind: 'positive-vague' as const, prompt: c.vague },
      { caseId: c.id, kind: 'positive-defined' as const, prompt: c.defined },
    ]),
    ...cases.negative.map((c) => ({ caseId: c.id, kind: 'negative' as const, prompt: c.defined })),
    ...cases.trigger.map((c) => ({ caseId: c.id, kind: 'trigger' as const, prompt: c.prompt })),
  ];
  return prompts.map((run, i) => ({ ...run, host: HOSTS[(i + pass) % HOSTS.length]! }));
}
