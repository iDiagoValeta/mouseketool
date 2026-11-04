import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseRepoName, type RepoName } from '../../src/domain/repo-name.ts';

const repoName = z.string().transform((value, ctx): RepoName => {
  try {
    return parseRepoName(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: `Not a repository name: "${value}"` });
    return z.NEVER;
  }
});

const requirement = z.string().min(1);

const defined = z.object({
  mustHaves: z.array(requirement).min(1),
  niceToHaves: z.array(requirement),
});

/**
 * `knownMatches` is not used for scoring, which is by requirements; the leak tests and
 * calibration use it. `vague.mustHaves` are the requirements the vague sentence clearly implies.
 */
const positiveCase = z.object({
  id: z.string().min(1),
  vague: z.object({ text: z.string().min(1), mustHaves: z.array(requirement).min(1) }),
  defined,
  knownMatches: z.array(repoName).min(1),
});

const negativeCase = z.object({ id: z.string().min(1), defined });
const triggerCase = z.object({ id: z.string().min(1), prompt: z.string().min(1) });

export type Defined = z.infer<typeof defined>;
export type PositiveCase = z.infer<typeof positiveCase>;
export type NegativeCase = z.infer<typeof negativeCase>;
export type TriggerCase = z.infer<typeof triggerCase>;

/** The defined prompt as the host reads it: a "Must have:" list and, when there is one, a "Nice to have:" list. */
export function renderDefined(d: Defined): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
  const nice = d.niceToHaves.length === 0 ? '' : `\nNice to have:\n${list(d.niceToHaves)}`;
  return `Must have:\n${list(d.mustHaves)}${nice}`;
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

/** Reads and validates the three case files in `dir`; throws on the first malformed or missing one. */
export function loadCases(dir: string): {
  positive: PositiveCase[];
  negative: NegativeCase[];
  trigger: TriggerCase[];
} {
  return {
    positive: z.array(positiveCase).parse(readJson(dir, 'positive.json')),
    negative: z.array(negativeCase).parse(readJson(dir, 'negative.json')),
    trigger: z.array(triggerCase).parse(readJson(dir, 'trigger.json')),
  };
}
