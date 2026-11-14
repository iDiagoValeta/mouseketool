import { describe, expect, it } from 'vitest';
import { warnIfTokenCanWrite, writeScopes } from '../../../src/infrastructure/github/token-scopes.ts';

describe('writeScopes', () => {
  it('keeps every scope that lets the token change something', () => {
    expect(writeScopes('repo, workflow, admin:org, read:org, gist, write:packages')).toEqual([
      'repo',
      'workflow',
      'admin:org',
      'gist',
      'write:packages',
    ]);
  });

  it('treats public_repo as a write scope: it pushes to public repositories', () => {
    expect(writeScopes('public_repo')).toEqual(['public_repo']);
  });

  it('finds nothing in read-only scopes, an empty header or no header', () => {
    expect(writeScopes('read:org, read:user, user:email')).toEqual([]);
    expect(writeScopes('')).toEqual([]);
    expect(writeScopes(null)).toEqual([]);
  });
});

function stubFetch(response: Response | Error): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetch: fn as typeof fetch, calls };
}

describe('warnIfTokenCanWrite', () => {
  const token = { value: 'gho_example', source: 'gh auth token' as const }; // pragma: allowlist secret

  it('warns once, naming the source and the write scopes but never the token', async () => {
    const { fetch, calls } = stubFetch(new Response('{}', { headers: { 'X-OAuth-Scopes': 'repo, read:org, workflow' } }));
    const lines: string[] = [];

    await warnIfTokenCanWrite({ token, fetch, warn: (line) => lines.push(line) });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.github.com/rate_limit');
    expect(new Headers(calls[0]!.init?.headers).get('Authorization')).toBe('Bearer gho_example');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gh auth token');
    expect(lines[0]).toContain('repo, workflow');
    expect(lines[0]).not.toContain('read:org');
    expect(lines[0]).not.toContain('gho_example');
  });

  it('stays silent for a token without the header, such as a fine-grained one', async () => {
    const { fetch } = stubFetch(new Response('{}'));
    const lines: string[] = [];

    await warnIfTokenCanWrite({ token, fetch, warn: (line) => lines.push(line) });

    expect(lines).toEqual([]);
  });

  it('stays silent for a classic token with read-only scopes', async () => {
    const { fetch } = stubFetch(new Response('{}', { headers: { 'X-OAuth-Scopes': 'read:user' } }));
    const lines: string[] = [];

    await warnIfTokenCanWrite({ token, fetch, warn: (line) => lines.push(line) });

    expect(lines).toEqual([]);
  });

  it('stays silent and does not throw when the request fails', async () => {
    const { fetch } = stubFetch(new Error('network down: Bearer gho_example'));
    const lines: string[] = [];

    await expect(warnIfTokenCanWrite({ token, fetch, warn: (line) => lines.push(line) })).resolves.toBeUndefined();
    expect(lines).toEqual([]);
  });
});
