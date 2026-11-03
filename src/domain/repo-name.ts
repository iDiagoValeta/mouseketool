/** A GitHub repository as `owner/name`, always lower case. */
export type RepoName = string;

export class InvalidRepoNameError extends Error {
  override name = 'InvalidRepoNameError';

  constructor(input: string) {
    super(`Expected "owner/name", got "${input}"`);
  }
}

const OWNER = /^[a-z0-9-]+$/;
// The name ends up in API paths, so `.` and `..` must not pass as a name.
const NAME = /^(?!\.\.?$)[a-z0-9._-]+$/;

/** Accepts `owner/name`, a GitHub URL or a `.git` suffix; anything else throws. */
export function parseRepoName(input: string): RepoName {
  const path = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?github\.com\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');

  const parts = path.split('/');
  if (parts.length !== 2) {
    throw new InvalidRepoNameError(input);
  }

  const [owner, name] = parts as [string, string];
  if (!OWNER.test(owner) || !NAME.test(name)) {
    throw new InvalidRepoNameError(input);
  }

  return `${owner}/${name}`;
}
