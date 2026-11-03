import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class TokenMissingError extends Error {
  override name = 'TokenMissingError';

  constructor() {
    super('mouseketool needs a GitHub token: set GITHUB_TOKEN or run "gh auth login".');
  }
}

export class InvalidTokenError extends Error {
  override name = 'InvalidTokenError';

  // The message names where the value came from, never the value: it is a secret.
  constructor(source: 'GITHUB_TOKEN' | 'gh auth token') {
    super(`The GitHub token from ${source} contains characters a token cannot have; check it.`);
  }
}

// A token is printable ASCII without spaces. Anything else, such as an embedded newline, would
// make fetch reject the Authorization header with an error message that repeats the value.
const VALID_TOKEN = /^[\x21-\x7e]+$/; // pragma: allowlist secret

/** `GITHUB_TOKEN` wins; otherwise whatever `runGh` returns. A blank value counts as missing. */
export async function resolveToken(
  env: NodeJS.ProcessEnv,
  runGh: () => Promise<string | null>,
): Promise<string> {
  const fromEnv = env['GITHUB_TOKEN']?.trim();
  if (fromEnv) {
    return validated(fromEnv, 'GITHUB_TOKEN');
  }

  const fromGh = (await runGh())?.trim();
  if (fromGh) {
    return validated(fromGh, 'gh auth token');
  }

  throw new TokenMissingError();
}

function validated(token: string, source: 'GITHUB_TOKEN' | 'gh auth token'): string {
  if (!VALID_TOKEN.test(token)) {
    throw new InvalidTokenError(source);
  }
  return token;
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
