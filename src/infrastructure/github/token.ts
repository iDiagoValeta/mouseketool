import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class TokenMissingError extends Error {
  override name = 'TokenMissingError';

  constructor() {
    super(
      'mouseketool needs a GitHub token: save one in ~/.config/mouseketool/token, set MOUSEKETOOL_GITHUB_TOKEN ' +
        'or GITHUB_TOKEN, or run "gh auth login".',
    );
  }
}

export class TokenFileError extends Error {
  override name = 'TokenFileError';

  constructor(path: string) {
    super(`The GitHub token file ${path} exists but cannot be read; check its permissions.`);
  }
}

export interface ResolvedToken {
  value: string;
  /** Where the value came from, to name in messages instead of the value, which is a secret. */
  source: string;
}

export class InvalidTokenError extends Error {
  override name = 'InvalidTokenError';

  // The message names where the value came from, never the value: it is a secret.
  constructor(source: string) {
    super(`The GitHub token from ${source} contains characters a token cannot have; check it.`);
  }
}

// A token is printable ASCII without spaces. Anything else, such as an embedded newline, would
// make fetch reject the Authorization header with an error message that repeats the value.
const VALID_TOKEN = /^[\x21-\x7e]+$/; // pragma: allowlist secret

/** `$XDG_CONFIG_HOME/mouseketool/token`, else `$HOME/.config/mouseketool/token`; null when neither is set. */
export function tokenFilePath(env: NodeJS.ProcessEnv): string | null {
  const configHome = env['XDG_CONFIG_HOME']?.trim() || (env['HOME']?.trim() ? join(env['HOME'], '.config') : '');
  return configHome ? join(configHome, 'mouseketool', 'token') : null;
}

/**
 * The server only reads public repositories, so the sources meant for mouseketool alone come first: they let a
 * narrow, read-only token serve it without replacing the GITHUB_TOKEN other tools rely on. The file is there
 * for agents started from a desktop app, which never see the variables a shell profile exports.
 *
 * `MOUSEKETOOL_GITHUB_TOKEN`, then the token file, then `GITHUB_TOKEN`, then whatever `runGh` returns. A blank
 * value or a missing file counts as missing; an invalid value or an unreadable file stops the search, so a
 * mistake never silently falls through to a broader token.
 */
export async function resolveToken(
  env: NodeJS.ProcessEnv,
  runGh: () => Promise<string | null>,
): Promise<ResolvedToken> {
  const own = env['MOUSEKETOOL_GITHUB_TOKEN']?.trim();
  if (own) {
    return validated(own, 'MOUSEKETOOL_GITHUB_TOKEN');
  }

  const path = tokenFilePath(env);
  const fromFile = path === null ? null : (await readTokenFile(path))?.trim();
  if (path !== null && fromFile) {
    return validated(fromFile, path);
  }

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

async function readTokenFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw new TokenFileError(path);
  }
}

function validated(token: string, source: string): ResolvedToken {
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
