import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class TokenMissingError extends Error {
  override name = 'TokenMissingError';

  constructor() {
    super('mouseketool needs a GitHub token: set MOUSEKETOOL_GITHUB_TOKEN or GITHUB_TOKEN, or run "gh auth login".');
  }
}

export type TokenSource = 'MOUSEKETOOL_GITHUB_TOKEN' | 'GITHUB_TOKEN' | 'gh auth token';

export interface ResolvedToken {
  value: string;
  /** Where the value came from, to name in messages instead of the value, which is a secret. */
  source: TokenSource;
}

export class InvalidTokenError extends Error {
  override name = 'InvalidTokenError';

  // The message names where the value came from, never the value: it is a secret.
  constructor(source: TokenSource) {
    super(`The GitHub token from ${source} contains characters a token cannot have; check it.`);
  }
}

// A token is printable ASCII without spaces. Anything else, such as an embedded newline, would
// make fetch reject the Authorization header with an error message that repeats the value.
const VALID_TOKEN = /^[\x21-\x7e]+$/; // pragma: allowlist secret

// The server only reads public repositories, so a dedicated variable comes first: it lets a narrow, read-only
// token serve mouseketool without replacing the GITHUB_TOKEN other tools rely on.
const ENV_SOURCES = ['MOUSEKETOOL_GITHUB_TOKEN', 'GITHUB_TOKEN'] as const;

/**
 * `MOUSEKETOOL_GITHUB_TOKEN`, then `GITHUB_TOKEN`, then whatever `runGh` returns. A blank value counts as
 * missing; an invalid one stops the search, so a typo never silently falls through to a broader token.
 */
export async function resolveToken(
  env: NodeJS.ProcessEnv,
  runGh: () => Promise<string | null>,
): Promise<ResolvedToken> {
  for (const source of ENV_SOURCES) {
    const fromEnv = env[source]?.trim();
    if (fromEnv) {
      return validated(fromEnv, source);
    }
  }

  const fromGh = (await runGh())?.trim();
  if (fromGh) {
    return validated(fromGh, 'gh auth token');
  }

  throw new TokenMissingError();
}

function validated(token: string, source: TokenSource): ResolvedToken {
  if (!VALID_TOKEN.test(token)) {
    throw new InvalidTokenError(source);
  }
  return { value: token, source };
}

/** The token `gh` holds, or null when gh is absent, logged out or fails for any reason. */
export async function ghAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10_000 });
    return stdout;
  } catch {
    return null;
  }
}
