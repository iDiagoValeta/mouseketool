import { describe, expect, it } from 'vitest';
import {
  GitHubError,
  GitHubSource,
  RateLimitedError,
} from '../../../src/infrastructure/github/github-source.ts';
import { RateLimiter } from '../../../src/infrastructure/github/rate-limiter.ts';
import { FakeClock } from '../../doubles/fake-clock.ts';

const sentinel = 'sentinel-value-1234';
const NOW = 1_800_000_000_000; // ms; the fake clock starts here

type Reply = { status?: number; json?: unknown; body?: string | Uint8Array<ArrayBuffer>; headers?: Record<string, string> };
type Handler = Reply | ((request: Request) => Reply);

interface Seen {
  url: URL;
  headers: Headers;
}

/** A fetch that answers by `pathname` and records every request it receives. */
function setup(routes: Record<string, Handler>) {
  const seen: Seen[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    seen.push({ url, headers: request.headers });
    const route = routes[url.pathname];
    if (route === undefined) {
      return new Response('not routed', { status: 599 });
    }
    const reply = typeof route === 'function' ? route(request) : route;
    const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.body ?? '');
    return new Response(reply.status === 204 ? null : body, {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  }) as typeof fetch;

  const clock = new FakeClock(NOW);
  const searchLimiter = new RateLimiter(30, clock);
  const source = new GitHubSource({ token: sentinel, fetch: fakeFetch, searchLimiter, clock }); // pragma: allowlist secret
  return { source, seen, clock };
}

const REPO_JSON = {
  full_name: 'Foo/Bar',
  html_url: 'https://github.com/Foo/Bar',
  description: 'A thing',
  stargazers_count: 120,
  pushed_at: '2026-10-01T00:00:00Z',
  created_at: '2020-01-01T00:00:00Z',
  license: { spdx_id: 'MIT' },
  topics: ['rag'],
  archived: false,
  language: 'TypeScript',
  open_issues_count: 7,
};

describe('GitHubSource.search', () => {
  it('maps items to candidates and sends the query, page size and headers', async () => {
    const { source, seen } = setup({
      '/search/repositories': { json: { items: [REPO_JSON] } },
    });

    const result = await source.search('model context protocol server', 5);

    expect(result).toEqual([
      {
        name: 'foo/bar',
        url: 'https://github.com/Foo/Bar',
        description: 'A thing',
        stars: 120,
        pushedAt: '2026-10-01T00:00:00Z',
        license: 'MIT',
        topics: ['rag'],
        archived: false,
        language: 'TypeScript',
      },
    ]);
    const [request] = seen;
    expect(request?.url.searchParams.get('q')).toBe('model context protocol server');
    expect(request?.url.searchParams.get('per_page')).toBe('5');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${sentinel}`);
    expect(request?.headers.get('accept')).toBe('application/vnd.github+json');
    expect(request?.headers.get('x-github-api-version')).toBe('2022-11-28');
  });

  it('skips an item whose full_name does not parse instead of failing the query', async () => {
    const { source } = setup({
      '/search/repositories': {
        json: { items: [{ ...REPO_JSON, full_name: 'not a repo' }, REPO_JSON] },
      },
    });

    const result = await source.search('q', 10);

    expect(result.map((c) => c.name)).toEqual(['foo/bar']);
  });

  it('paces searches through the limiter: the 31st waits for the window', async () => {
    const { source, clock } = setup({ '/search/repositories': { json: { items: [] } } });

    for (let i = 0; i < 31; i += 1) {
      await source.search('q', 1);
    }

    expect(clock.sleeps).toEqual([60_000]);
  });
});

describe('GitHubSource.repository', () => {
  it('maps a repo, with the license from spdx_id', async () => {
    const { source, seen } = setup({ '/repos/foo/bar': { json: REPO_JSON } });

    const candidate = await source.repository('foo/bar');

    expect(candidate.license).toBe('MIT');
    expect(candidate.name).toBe('foo/bar');
    expect(seen[0]?.url.pathname).toBe('/repos/foo/bar');
  });

  it('maps null and missing fields to null, [] and created_at', async () => {
    const { source } = setup({
      '/repos/foo/bar': {
        json: {
          full_name: 'foo/bar',
          html_url: 'https://github.com/foo/bar',
          stargazers_count: 0,
          pushed_at: null,
          created_at: '2024-05-05T05:05:05Z',
          license: null,
          archived: true,
        },
      },
    });

    expect(await source.repository('foo/bar')).toEqual({
      name: 'foo/bar',
      url: 'https://github.com/foo/bar',
      description: null,
      stars: 0,
      pushedAt: '2024-05-05T05:05:05Z',
      license: null,
      topics: [],
      archived: true,
      language: null,
    });
  });

  it('throws GitHubError naming the status and path, never the token', async () => {
    const { source } = setup({ '/repos/foo/bar': { status: 500, body: 'boom' } });

    const error = await source.repository('foo/bar').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as Error).message).toContain('500');
    expect((error as Error).message).toContain('/repos/foo/bar');
    expect((error as Error).message).not.toContain(sentinel);
  });

  it('throws GitHubError on a 404 repository', async () => {
    const { source } = setup({ '/repos/foo/bar': { status: 404, json: { message: 'Not Found' } } });

    await expect(source.repository('foo/bar')).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('GitHubSource.readme', () => {
  it('asks for the raw media type and returns the text', async () => {
    const { source, seen } = setup({ '/repos/foo/bar/readme': { body: '# Bar' } });

    expect(await source.readme('foo/bar')).toBe('# Bar');
    expect(seen[0]?.headers.get('accept')).toBe('application/vnd.github.raw');
  });

  it('returns null on 404', async () => {
    const { source } = setup({ '/repos/foo/bar/readme': { status: 404 } });

    expect(await source.readme('foo/bar')).toBeNull();
  });
});

describe('GitHubSource.topLevelTree', () => {
  it('marks directories with a trailing slash', async () => {
    const { source } = setup({
      '/repos/foo/bar/contents/': {
        json: [
          { name: 'src', type: 'dir' },
          { name: 'README.md', type: 'file' },
        ],
      },
    });

    expect(await source.topLevelTree('foo/bar')).toEqual(['src/', 'README.md']);
  });

  it('returns [] for an empty repository (404)', async () => {
    const { source } = setup({ '/repos/foo/bar/contents/': { status: 404 } });

    expect(await source.topLevelTree('foo/bar')).toEqual([]);
  });
});

describe('GitHubSource.file', () => {
  it('returns the text of a file, asking for the raw media type', async () => {
    const { source, seen } = setup({ '/repos/foo/bar/contents/src/a%20b.ts': { body: 'export {}' } });

    expect(await source.file('foo/bar', 'src/a b.ts')).toEqual({ kind: 'text', text: 'export {}' });
    expect(seen[0]?.headers.get('accept')).toBe('application/vnd.github.raw');
  });

  it('returns missing on 404', async () => {
    const { source } = setup({ '/repos/foo/bar/contents/nope.txt': { status: 404 } });

    expect(await source.file('foo/bar', 'nope.txt')).toEqual({ kind: 'missing' });
  });

  it('refuses a path that climbs out of the contents endpoint without calling GitHub', async () => {
    const { source, seen } = setup({});

    expect(await source.file('foo/bar', '../../../user')).toEqual({ kind: 'missing' });
    expect(seen).toEqual([]);
  });

  it('returns binary when a NUL byte is in the first 8000 bytes', async () => {
    const bytes = new Uint8Array(100).fill(65);
    bytes[50] = 0;
    const { source } = setup({ '/repos/foo/bar/contents/logo.png': { body: bytes } });

    expect(await source.file('foo/bar', 'logo.png')).toEqual({ kind: 'binary' });
  });

  it('ignores a NUL byte past the first 8000 bytes', async () => {
    const bytes = new Uint8Array(9000).fill(65);
    bytes[8500] = 0;
    const { source } = setup({ '/repos/foo/bar/contents/big.txt': { body: bytes } });

    expect(await source.file('foo/bar', 'big.txt')).toMatchObject({ kind: 'text' });
  });
});

describe('GitHubSource.activity', () => {
  const SINCE = new Date('2026-08-05T00:00:00Z');

  function activityRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
    return {
      '/repos/foo/bar': { json: { ...REPO_JSON, open_issues_count: 7 } },
      '/repos/foo/bar/commits': { json: [{}, {}, {}] },
      '/repos/foo/bar/issues': {
        json: [
          { closed_at: '2026-09-01T00:00:00Z' },
          { closed_at: '2026-08-05T00:00:00Z' },
          { closed_at: '2026-07-01T00:00:00Z' },
          { closed_at: '2026-09-02T00:00:00Z', pull_request: {} },
        ],
      },
      '/repos/foo/bar/contributors': { json: [{}, {}] },
      '/repos/foo/bar/releases/latest': {
        json: { tag_name: 'v1.2.0', published_at: '2026-09-10T00:00:00Z' },
      },
      ...overrides,
    };
  }

  it('combines commits, closed issues, open issues, contributors and the latest release', async () => {
    const { source, seen } = setup(activityRoutes());

    expect(await source.activity('foo/bar', SINCE)).toEqual({
      commitsLast90Days: 3,
      issuesClosedLast90Days: 2,
      openIssues: 7,
      contributors: 2,
      latestRelease: { tag: 'v1.2.0', publishedAt: '2026-09-10T00:00:00Z' },
    });

    const commits = seen.find((s) => s.url.pathname.endsWith('/commits'));
    expect(commits?.url.searchParams.get('since')).toBe(SINCE.toISOString());
    expect(commits?.url.searchParams.get('per_page')).toBe('100');
    const issues = seen.find((s) => s.url.pathname.endsWith('/issues'));
    expect(issues?.url.searchParams.get('state')).toBe('closed');
    expect(issues?.url.searchParams.get('since')).toBe(SINCE.toISOString());
  });

  it('never touches the search API', async () => {
    const { source, seen } = setup(activityRoutes());

    await source.activity('foo/bar', SINCE);

    expect(seen.some((s) => s.url.pathname.startsWith('/search'))).toBe(false);
  });

  it('caps commits and contributors at 100', async () => {
    const hundred = Array.from({ length: 100 }, () => ({}));
    const { source } = setup(
      activityRoutes({
        '/repos/foo/bar/commits': { json: hundred },
        '/repos/foo/bar/contributors': { json: hundred },
      }),
    );

    const facts = await source.activity('foo/bar', SINCE);

    expect(facts.commitsLast90Days).toBe(100);
    expect(facts.contributors).toBe(100);
  });

  it('gives 0 commits for an empty repository (409) and null for a missing release (404)', async () => {
    const { source } = setup(
      activityRoutes({
        '/repos/foo/bar/commits': { status: 409, json: { message: 'Git Repository is empty.' } },
        '/repos/foo/bar/contributors': { status: 204 },
        '/repos/foo/bar/releases/latest': { status: 404 },
      }),
    );

    const facts = await source.activity('foo/bar', SINCE);

    expect(facts.commitsLast90Days).toBe(0);
    expect(facts.contributors).toBe(0);
    expect(facts.latestRelease).toBeNull();
  });
});

describe('rate limiting', () => {
  const RESET_S = NOW / 1000 + 30; // half a minute after the fake clock's now

  function limited(extra: Record<string, string> = {}): Reply {
    return {
      status: 403,
      json: { message: 'rate limit exceeded' },
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET_S), ...extra },
    };
  }

  it('sleeps until x-ratelimit-reset through the clock and retries once', async () => {
    let calls = 0;
    const { source, clock } = setup({
      '/repos/foo/bar/readme': () => (++calls === 1 ? limited() : { body: '# Bar' }),
    });

    expect(await source.readme('foo/bar')).toBe('# Bar');
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([30_000]);
  });

  it('still waits and retries when the reset is exactly 60 s away', async () => {
    let calls = 0;
    const { source, clock } = setup({
      '/repos/foo/bar/readme': () =>
        ++calls === 1
          ? limited({ 'x-ratelimit-reset': String(NOW / 1000 + 60) })
          : { body: '# Bar' },
    });

    expect(await source.readme('foo/bar')).toBe('# Bar');
    expect(clock.sleeps).toEqual([60_000]);
  });

  it('throws RateLimitedError at once, without sleeping, when the reset is 61 s away', async () => {
    let calls = 0;
    const resetAt = NOW / 1000 + 61;
    const { source, clock } = setup({
      '/repos/foo/bar/readme': () => {
        calls += 1;
        return limited({ 'x-ratelimit-reset': String(resetAt) });
      },
    });

    const error = await source.readme('foo/bar').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).resetAt).toEqual(new Date(resetAt * 1000));
    expect((error as Error).message).toContain(new Date(resetAt * 1000).toISOString());
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('applies the same cap to retry-after', async () => {
    const { source, clock } = setup({
      '/repos/foo/bar/readme': limited({ 'retry-after': '61' }),
    });

    await expect(source.readme('foo/bar')).rejects.toBeInstanceOf(RateLimitedError);
    expect(clock.sleeps).toEqual([]);
  });

  it('prefers retry-after (seconds) when present, also on 429', async () => {
    let calls = 0;
    const { source, clock } = setup({
      '/repos/foo/bar/readme': () =>
        ++calls === 1 ? { ...limited({ 'retry-after': '7' }), status: 429 } : { body: 'ok' },
    });

    await source.readme('foo/bar');

    expect(clock.sleeps).toEqual([7_000]);
  });

  it('throws RateLimitedError with the reset time when the retry is limited too', async () => {
    let calls = 0;
    const { source } = setup({
      '/repos/foo/bar/readme': () => {
        calls += 1;
        return limited();
      },
    });

    const error = await source.readme('foo/bar').catch((e: unknown) => e);

    expect(calls).toBe(2);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).resetAt).toEqual(new Date(RESET_S * 1000));
    expect((error as Error).message).toContain(new Date(RESET_S * 1000).toISOString());
    expect((error as Error).message).not.toContain(sentinel);
  });

  it('treats a 403 without rate-limit headers as a plain GitHubError', async () => {
    const { source, clock } = setup({ '/repos/foo/bar/readme': { status: 403 } });

    await expect(source.readme('foo/bar')).rejects.toBeInstanceOf(GitHubError);
    expect(clock.sleeps).toEqual([]);
  });
});
