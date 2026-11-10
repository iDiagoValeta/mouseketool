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

const GITHUB_URL = /^(https?:\/\/)?(www\.)?github\.com\//;

/**
 * Accepts `owner/name`, a `.git` suffix, or a GitHub URL, also one that points inside the
 * repository (`/tree/...`, `/blob/...`, `#readme`); anything else throws.
 */
export function parseRepoName(input: string): RepoName {
  const trimmed = input.trim().toLowerCase();
  let path = trimmed.replace(GITHUB_URL, '');
  if (path !== trimmed) {
    // A URL names the repository in its first two segments; the rest is a page inside it.
    path = path.split(/[?#]/)[0]!.split('/').slice(0, 2).join('/');
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/, '');

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
