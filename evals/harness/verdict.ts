import { parseRepoName, type RepoName } from '../../src/domain/repo-name.ts';

export type Decision = 'reuse' | 'adapt' | 'base' | 'build';

const BUILD = /^Verdict: build$/;
const WITH_REPOS = /^Verdict: (reuse|adapt|base) (.+)$/;
// The skill lists repos as `owner/name`; a URL or any other word breaks the format.
const OWNER_NAME = /^[^/\s]+\/[^/\s]+$/;

/**
 * Reads the verdict line the skill asks for: the first line of the answer that is not blank, holding the
 * decision and, except for build, one or more `owner/name` separated by commas, and nothing else. Anything
 * else, such as a verdict further down or an extra word on the line, is no verdict.
 */
export function parseVerdict(text: string): { decision: Decision; repos: RepoName[] } | null {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  if (BUILD.test(line)) return { decision: 'build', repos: [] };

  const match = WITH_REPOS.exec(line);
  if (!match) return null;
  const repos: RepoName[] = [];
  for (const entry of match[2]!.split(',').map((e) => e.trim())) {
    if (!OWNER_NAME.test(entry)) return null;
    try {
      repos.push(parseRepoName(entry));
    } catch {
      return null;
    }
  }
  return { decision: match[1] as Decision, repos };
}
