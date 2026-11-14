import type { ResolvedToken } from './token.ts';

// Answers with the token's scopes in its headers and costs nothing from any rate limit.
const RATE_LIMIT_URL = 'https://api.github.com/rate_limit';
const TOKEN_HELP_URL = 'https://github.com/iDiagoValeta/mouseketool#github-token';

/**
 * The scopes in an `X-OAuth-Scopes` header that let a token change something. Only `read:*` and `user:email`
 * are read-only; everything else, `public_repo` and `notifications` included, can write.
 */
export function writeScopes(header: string | null): string[] {
  return (header ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '' && !scope.startsWith('read:') && scope !== 'user:email');
}

/**
 * Warns once when the token can write, since mouseketool only reads public repositories. Classic and OAuth
 * tokens (the one `gh` holds among them) list their scopes in `X-OAuth-Scopes`; fine-grained tokens send no
 * such header and get no warning. Any failure is ignored: this is advice, and the server works without it.
 */
export async function warnIfTokenCanWrite(opts: {
  token: ResolvedToken; // pragma: allowlist secret
  fetch: typeof fetch;
  warn: (line: string) => void;
}): Promise<void> {
  let header: string | null;
  try {
    const response = await opts.fetch(RATE_LIMIT_URL, {
      headers: { Authorization: `Bearer ${opts.token.value}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    header = response.headers.get('x-oauth-scopes');
  } catch {
    // Nothing from the error is kept: fetch can repeat a header value, and with it the token.
    return;
  }

  const scopes = writeScopes(header);
  if (scopes.length > 0) {
    opts.warn(
      `mouseketool: the GitHub token from ${opts.token.source} can write (${scopes.join(', ')}), ` +
        `but mouseketool only reads public repositories. A read-only token is enough: ${TOKEN_HELP_URL}`,
    );
  }
}
