import { renderDefined, type NegativeCase, type PositiveCase, type TriggerCase } from '../cases/schema.ts';

export const HOSTS = ['claude-sonnet', 'opencode-deepseek-flash'] as const;
export type Host = (typeof HOSTS)[number];

export const MODELS: Record<Host, string> = {
  'claude-sonnet': 'claude-sonnet-5-5',
  'opencode-deepseek-flash': 'deepseek/deepseek-flash',
};

export type RunKind = 'positive-vague' | 'positive-defined' | 'negative' | 'trigger';

/** `mustHaves` are the requirements the run is scored against; a trigger run has none. */
export type Run = { caseId: string; kind: RunKind; prompt: string; mustHaves?: string[]; host: Host };

/**
 * One run per prompt in a fixed order; run `i` goes to Sonnet when `(i + pass) % 5 < 3`, else to DeepSeek.
 * Sonnet takes 3 of every 5 runs, so it carries 32 of the 52; shifting by the pass number moves
 * every case across both hosts over five passes while each host keeps every kind within one pass.
 */
export function planRuns(
  cases: { positive: PositiveCase[]; negative: NegativeCase[]; trigger: TriggerCase[] },
  pass: number,
): Run[] {
  const prompts: Omit<Run, 'host'>[] = [
    ...cases.positive.flatMap((c) => [
      { caseId: c.id, kind: 'positive-vague' as const, prompt: c.vague.text, mustHaves: c.vague.mustHaves },
      { caseId: c.id, kind: 'positive-defined' as const, prompt: renderDefined(c.defined), mustHaves: c.defined.mustHaves },
    ]),
    ...cases.negative.map((c) => ({
      caseId: c.id,
      kind: 'negative' as const,
      prompt: renderDefined(c.defined),
      mustHaves: c.defined.mustHaves,
    })),
    ...cases.trigger.map((c) => ({ caseId: c.id, kind: 'trigger' as const, prompt: c.prompt })),
  ];
  return prompts.map((run, i) => ({ ...run, host: (i + pass) % 5 < 3 ? 'claude-sonnet' : 'opencode-deepseek-flash' }));
}
