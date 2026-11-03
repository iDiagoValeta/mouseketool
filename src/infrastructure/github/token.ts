import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class TokenMissingError extends Error {
  override name = 'TokenMissingError';

  constructor() {
    super('mouseketool needs a GitHub token: set GITHUB_TOKEN or run "gh auth login".');
  }
}

/** `GITHUB_TOKEN` wins; otherwise whatever `runGh` returns. A blank value counts as missing. */
export async function resolveToken(
  env: NodeJS.ProcessEnv,
  runGh: () => Promise<string | null>,
): Promise<string> {
  const fromEnv = env['GITHUB_TOKEN']?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromGh = (await runGh())?.trim();
  if (fromGh) {
    return fromGh;
  }

  throw new TokenMissingError();
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
