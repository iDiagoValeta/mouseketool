import { renderDefined, type Cases } from '../cases/schema.ts';

export const HOSTS = ['claude-sonnet', 'opencode-deepseek-flash'] as const;
export type Host = (typeof HOSTS)[number];

export const MODELS: Record<Host, string> = {
  'claude-sonnet': 'claude-sonnet-5-5',
  'opencode-deepseek-flash': 'deepseek/deepseek-flash',
};

export type RunKind = 'positive-vague' | 'positive-defined' | 'negative' | 'trigger' | 'partial';

/**
 * `mustHaves` are the requirements the run is scored against; a trigger run has none.
 * `foundationMustHaves` is set on partial runs only: what a project must cover to be the right base.
 */
export type Run = {
  caseId: string;
  kind: RunKind;
  prompt: string;
  mustHaves?: string[];
  foundationMustHaves?: string[];
  host: Host;
};

/**
 * One run per prompt in a fixed order; run `i` goes to Sonnet when `(i + pass) % 5 < 3`, else to DeepSeek.
 * Sonnet takes 3 of every 5 runs, so it carries 36 of the 58; shifting by the pass number moves
 * every case across both hosts over five passes while each host keeps every kind within one pass.
 * The partial runs come last, so adding them did not move the index of any earlier run.
 */
export function planRuns(cases: Cases, pass: number): Run[] {
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
    ...cases.partial.map((c) => ({
      caseId: c.id,
      kind: 'partial' as const,
      prompt: c.text,
      mustHaves: c.mustHaves,
      foundationMustHaves: c.foundationMustHaves,
    })),
  ];
  return prompts.map((run, i) => ({ ...run, host: (i + pass) % 5 < 3 ? 'claude-sonnet' : 'opencode-deepseek-flash' }));
}
