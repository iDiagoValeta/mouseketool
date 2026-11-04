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

/**
 * An idea that a mature project covers only in part: the right answer is `base` with that project.
 * `mustHaves` is the whole idea; `foundationMustHaves` is what a project must cover to be the right base.
 * `knownFoundations` is not used for scoring; the leak tests and calibration use it.
 */
const partialCase = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  mustHaves: z.array(requirement).min(1),
  foundationMustHaves: z.array(requirement).min(1),
  knownFoundations: z.array(repoName).min(1),
});

export type Defined = z.infer<typeof defined>;
export type PositiveCase = z.infer<typeof positiveCase>;
export type NegativeCase = z.infer<typeof negativeCase>;
export type TriggerCase = z.infer<typeof triggerCase>;
export type PartialCase = z.infer<typeof partialCase>;

/** The defined prompt as the host reads it: a "Must have:" list and, when there is one, a "Nice to have:" list. */
export function renderDefined(d: Defined): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
  const nice = d.niceToHaves.length === 0 ? '' : `\nNice to have:\n${list(d.niceToHaves)}`;
  return `Must have:\n${list(d.mustHaves)}${nice}`;
}

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

export type Cases = {
  positive: PositiveCase[];
  negative: NegativeCase[];
  trigger: TriggerCase[];
  partial: PartialCase[];
};

/** Reads and validates the four case files in `dir`; throws on the first malformed or missing one. */
export function loadCases(dir: string): Cases {
  return {
    positive: z.array(positiveCase).parse(readJson(dir, 'positive.json')),
    negative: z.array(negativeCase).parse(readJson(dir, 'negative.json')),
    trigger: z.array(triggerCase).parse(readJson(dir, 'trigger.json')),
    partial: z.array(partialCase).parse(readJson(dir, 'partial.json')),
  };
}
