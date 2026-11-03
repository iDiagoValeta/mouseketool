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

const positiveCase = z.object({
  id: z.string().min(1),
  vague: z.string().min(1),
  defined: z.string().min(1),
  expected: z.array(repoName).min(1),
});

const negativeCase = z.object({ id: z.string().min(1), defined: z.string().min(1) });
const triggerCase = z.object({ id: z.string().min(1), prompt: z.string().min(1) });

export type PositiveCase = z.infer<typeof positiveCase>;
export type NegativeCase = z.infer<typeof negativeCase>;
export type TriggerCase = z.infer<typeof triggerCase>;

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
