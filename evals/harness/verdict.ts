import { parseRepoName, type RepoName } from '../../src/domain/repo-name.ts';

export type Decision = 'reuse' | 'adapt' | 'base' | 'build';

const VERDICT = /^Verdict: (reuse|adapt|base|build)( .+)?$/;

/**
 * Reads the first line of the answer that matches the verdict format the skill asks for.
 * Entries after the decision that are not repository names are dropped: they cannot match an expected repo.
 */
export function parseVerdict(text: string): { decision: Decision; repos: RepoName[] } | null {
  for (const line of text.split('\n')) {
    const match = VERDICT.exec(line.trimEnd());
    if (!match) continue;
    const repos: RepoName[] = [];
    for (const entry of (match[2] ?? '').split(',')) {
      try {
        repos.push(parseRepoName(entry));
      } catch {
        // not a repository name
      }
    }
    return { decision: match[1] as Decision, repos };
  }
  return null;
}
