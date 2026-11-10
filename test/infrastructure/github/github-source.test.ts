import { describe, expect, it } from 'vitest';
import { SourceError, SourceRateLimitedError } from '../../../src/application/ports/repository-source.ts';
import {
  GitHubError,
  GitHubSource,
  RateLimitedError,
} from '../../../src/infrastructure/github/github-source.ts';
import { Concurrency } from '../../../src/infrastructure/github/concurrency.ts';
import { FakeClock } from '../../doubles/fake-clock.ts';

const sentinel = 'sentinel-value-1234';
const NOW = 1_800_000_000_000; // ms; the fake clock starts here

type Reply = { status?: number; json?: unknown; body?: string | Uint8Array<ArrayBuffer>; headers?: Record<string, string> };
type Handler = Reply | ((request: Request, sent: string | null) => Reply);

interface Seen {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

/** A fetch that answers by `pathname` and records every request it receives. */
function setup(routes: Record<string, Handler>) {
  const seen: Seen[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const sent = typeof init?.body === 'string' ? init.body : null;
    seen.push({ url, method: request.method, headers: request.headers, body: sent });
    const route = routes[url.pathname];
    if (route === undefined) {
      return new Response('not routed', { status: 599 });
    }
    const reply = typeof route === 'function' ? route(request, sent) : route;
    const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.body ?? '');
    return new Response(reply.status === 204 ? null : body, {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  }) as typeof fetch;

  const clock = new FakeClock(NOW);
  const searchConcurrency = new Concurrency(10);
  const source = new GitHubSource({ token: sentinel, fetch: fakeFetch, searchConcurrency, clock }); // pragma: allowlist secret
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

const SEARCH_NODE = {
  nameWithOwner: 'Foo/Bar',
  url: 'https://github.com/Foo/Bar',
  description: 'A thing',
  stargazerCount: 120,
  pushedAt: '2026-10-01T00:00:00Z',
  createdAt: '2020-01-01T00:00:00Z',
  isArchived: false,
  licenseInfo: { spdxId: 'MIT' },
  primaryLanguage: { name: 'TypeScript' },
  repositoryTopics: { nodes: [{ topic: { name: 'rag' } }] },
};

const searchReply = (nodes: unknown[]): Reply => ({ json: { data: { search: { nodes } } } });

describe('GitHubSource.search', () => {
  it('maps the nodes of a GraphQL search to candidates, sending the query and page size as variables', async () => {
    const { source, seen } = setup({ '/graphql': searchReply([SEARCH_NODE]) });

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
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${sentinel}`);
    const { query, variables } = JSON.parse(request?.body ?? '{}') as { query: string; variables: unknown };
    expect(query).toContain('search(type: REPOSITORY');
    expect(variables).toEqual({ q: 'model context protocol server', first: 5 });
  });

  it('never touches the REST search API, whose quota is 30 a minute', async () => {
    const { source, seen } = setup({ '/graphql': searchReply([]) });

    await source.search('a', 5);

    expect(seen.map((s) => s.url.pathname)).toEqual(['/graphql']);
  });

  it('maps null fields to null, [] and created_at', async () => {
    const bare = { ...SEARCH_NODE, description: null, pushedAt: null, licenseInfo: null, primaryLanguage: null, repositoryTopics: { nodes: [] } };
    const { source } = setup({ '/graphql': searchReply([bare]) });

    expect(await source.search('q', 1)).toEqual([
      expect.objectContaining({ description: null, pushedAt: '2020-01-01T00:00:00Z', license: null, language: null, topics: [] }),
    ]);
  });

  it('skips a node whose name does not parse, or an empty node, instead of failing the query', async () => {
    const { source } = setup({ '/graphql': searchReply([{ ...SEARCH_NODE, nameWithOwner: 'not a repo' }, {}, SEARCH_NODE]) });

    const result = await source.search('q', 10);

    expect(result.map((c) => c.name)).toEqual(['foo/bar']);
  });

  it('runs every search through the concurrency limit', async () => {
    let runs = 0;
    class Counting extends Concurrency {
      override run<T>(task: () => Promise<T>): Promise<T> {
        runs += 1;
        return super.run(task);
      }
    }
    const source = new GitHubSource({
      token: sentinel, // pragma: allowlist secret
      fetch: (async () => new Response(JSON.stringify({ data: { search: { nodes: [] } } }))) as typeof fetch,
      searchConcurrency: new Counting(2),
      clock: new FakeClock(NOW),
    });

    await Promise.all(['a', 'b', 'c'].map((q) => source.search(q, 1)));

    expect(runs).toBe(3);
  });

  it('keeps the query out of the message when GraphQL answers with errors', async () => {
    const { source } = setup({ '/graphql': { json: { errors: [{ message: 'Something went wrong' }] } } });

    const error = await source.search('my private idea', 5).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toBe('GitHub GraphQL query failed for a repository search');
  });
});

describe('GitHubSource.search after a refusal', () => {
  const refusal = (resetInS: number): Reply => ({
    json: { errors: [{ type: 'RATE_LIMITED' }] },
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + resetInS) },
  });

  it('sleeps until the reset before the next search when it is close', async () => {
    const { source, seen, clock } = setup({
      '/graphql': () => (seen.length === 1 ? refusal(30) : searchReply([])),
    });

    await expect(source.search('a', 5)).rejects.toBeInstanceOf(RateLimitedError);
    await source.search('b', 5);

    expect(clock.sleeps).toEqual([30_000]);
    expect(seen).toHaveLength(2);
  });

  it('fails the next search without a request when the reset is too far to wait for', async () => {
    const { source, seen } = setup({ '/graphql': refusal(120) });

    await expect(source.search('a', 5)).rejects.toBeInstanceOf(RateLimitedError);
    const error = await source.search('b', 5).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceRateLimitedError);
    expect((error as RateLimitedError).resetAt).toEqual(new Date((NOW / 1000 + 120) * 1000));
    expect(seen).toHaveLength(1);
  });

  it('also learns the reset from a 403 refusal of the request itself', async () => {
    const { source, seen } = setup({
      '/graphql': {
        status: 403,
        json: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 120) },
      },
    });

    await expect(source.search('a', 5)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(source.search('b', 5)).rejects.toBeInstanceOf(RateLimitedError);

    expect(seen).toHaveLength(1);
  });

  it('does not wait when nothing was refused', async () => {
    const { source, clock } = setup({ '/graphql': searchReply([]) });

    await source.search('a', 5);
    await source.search('b', 5);

    expect(clock.sleeps).toEqual([]);
  });
});

describe('a failing fetch', () => {
  function sourceWhoseFetchRejects(error: Error): GitHubSource {
    const clock = new FakeClock(NOW);
    return new GitHubSource({
      token: sentinel, // pragma: allowlist secret
      fetch: (async () => {
        throw error;
      }) as typeof fetch,
      searchConcurrency: new Concurrency(10),
      clock,
    });
  }

  it('rethrows a sanitised GitHubError without the original message or cause', async () => {
    const leaking = new Error(`Headers.append: "Bearer ${sentinel}" is an invalid header value.`, {
      cause: new Error(sentinel),
    });

    const error = await sourceWhoseFetchRejects(leaking)
      .readme('foo/bar')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toContain('/repos/foo/bar/readme');
    expect((error as Error).message).not.toContain(sentinel);
    expect((error as Error).cause).toBeUndefined();
  });

  it('keeps the search query out of the message of a failed search', async () => {
    const error = await sourceWhoseFetchRejects(new TypeError('fetch failed'))
      .search('my private idea', 5)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as Error).message).toContain('/graphql');
    expect((error as Error).message).not.toContain('my private idea');
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

  it('lists a directory, which GitHub answers with JSON even when raw is asked for', async () => {
    const { source } = setup({
      '/repos/foo/bar/contents/src': {
        json: [
          { name: 'a.ts', type: 'file', sha: 'x', _links: {} },
          { name: 'lib', type: 'dir', sha: 'y', _links: {} },
        ],
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    });

    expect(await source.file('foo/bar', 'src')).toEqual({ kind: 'directory', entries: ['a.ts', 'lib/'] });
  });

  it('returns a JSON file as text, since GitHub sends it as raw media', async () => {
    const { source } = setup({
      '/repos/foo/bar/contents/package.json': {
        body: '[1, 2]',
        headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' },
      },
    });

    expect(await source.file('foo/bar', 'package.json')).toEqual({ kind: 'text', text: '[1, 2]' });
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

  function counts(commits: number | null, closed: number, open: number) {
    return {
      json: {
        data: {
          repository: {
            issues: { totalCount: open },
            defaultBranchRef:
              commits === null ? null : { target: { history: { totalCount: commits } } },
          },
          search: { issueCount: closed },
        },
      },
    };
  }

  function activityRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
    return {
      '/graphql': counts(3, 2, 7),
      '/repos/foo/bar/contributors': { json: [{}] },
      '/repos/foo/bar/releases/latest': {
        json: { tag_name: 'v1.2.0', published_at: '2026-09-10T00:00:00Z' },
      },
      ...overrides,
    };
  }

  it('combines the GraphQL counts, the contributors and the latest release', async () => {
    const { source } = setup(activityRoutes());

    expect(await source.activity('foo/bar', SINCE)).toEqual({
      commitsLast90Days: 3,
      issuesClosedLast90Days: 2,
      openIssues: 7,
      contributors: 1,
      latestRelease: { tag: 'v1.2.0', publishedAt: '2026-09-10T00:00:00Z' },
    });
  });

  it('asks GraphQL for the counts of this repository since the window start', async () => {
    const { source, seen } = setup(activityRoutes());

    await source.activity('foo/bar', SINCE);

    const query = seen.find((s) => s.url.pathname === '/graphql');
    expect(query?.method).toBe('POST');
    expect(query?.headers.get('authorization')).toBe(`Bearer ${sentinel}`);
    const { variables } = JSON.parse(query?.body ?? '{}') as { variables: unknown };
    expect(variables).toEqual({
      owner: 'foo',
      name: 'bar',
      since: SINCE.toISOString(),
      closed: `repo:foo/bar is:issue is:closed closed:>=${SINCE.toISOString()}`,
    });
  });

  it('never touches the REST search API', async () => {
    const { source, seen } = setup(activityRoutes());

    await source.activity('foo/bar', SINCE);

    expect(seen.some((s) => s.url.pathname.startsWith('/search'))).toBe(false);
  });

  it('counts contributors past one page from the last page of the Link header', async () => {
    const link =
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=314>; rel="last"';
    const { source, seen } = setup(
      activityRoutes({ '/repos/foo/bar/contributors': { json: [{}], headers: { link } } }),
    );

    expect((await source.activity('foo/bar', SINCE)).contributors).toBe(314);
    const contributors = seen.find((s) => s.url.pathname.endsWith('/contributors'));
    expect(contributors?.url.searchParams.get('per_page')).toBe('1');
  });

  it('gives null contributors when GitHub refuses to count them (403)', async () => {
    const { source } = setup(
      activityRoutes({
        '/repos/foo/bar/contributors': {
          status: 403,
          json: { message: 'The history or contributor list is too large to list contributors' },
        },
      }),
    );

    expect((await source.activity('foo/bar', SINCE)).contributors).toBeNull();
  });

  it('gives 0 commits and contributors for an empty repository and null for a missing release', async () => {
    const { source } = setup(
      activityRoutes({
        '/graphql': counts(null, 0, 0),
        '/repos/foo/bar/contributors': { status: 204 },
        '/repos/foo/bar/releases/latest': { status: 404 },
      }),
    );

    const facts = await source.activity('foo/bar', SINCE);

    expect(facts.commitsLast90Days).toBe(0);
    expect(facts.contributors).toBe(0);
    expect(facts.latestRelease).toBeNull();
  });

  it('throws a SourceError when GraphQL answers with errors, such as for a missing repository', async () => {
    const { source } = setup(
      activityRoutes({
        '/graphql': { json: { data: { repository: null }, errors: [{ type: 'NOT_FOUND' }] } },
      }),
    );

    const error = await source.activity('foo/bar', SINCE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceError);
    expect((error as Error).message).toBe('GitHub GraphQL query failed for foo/bar');
  });

  it('throws RateLimitedError when GraphQL reports its limit as exhausted', async () => {
    const { source } = setup(
      activityRoutes({
        '/graphql': {
          json: { errors: [{ type: 'RATE_LIMITED' }] },
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000600' },
        },
      }),
    );

    const error = await source.activity('foo/bar', SINCE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).resetAt).toEqual(new Date(1_800_000_600_000));
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
