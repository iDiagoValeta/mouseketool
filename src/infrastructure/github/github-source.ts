import {
  SourceError,
  SourceRateLimitedError,
  type FileContent,
  type RepositorySource,
} from '../../application/ports/repository-source.ts';
import type { Candidate } from '../../domain/candidate.ts';
import type { ActivityFacts } from '../../domain/health.ts';
import { parseRepoName } from '../../domain/repo-name.ts';
import type { RepoName } from '../../domain/repo-name.ts';
import type { Clock, RateLimiter } from './rate-limiter.ts';

const API = 'https://api.github.com';
const JSON_MEDIA = 'application/vnd.github+json';
const RAW_MEDIA = 'application/vnd.github.raw';
// GitHub's own advice for a limit it gives no reset time for is to wait at least a minute.
const DEFAULT_LIMIT_WAIT_MS = 60_000;
// A tool call that blocks for longer than this looks hung to the caller; fail with the reset time.
const MAX_LIMIT_WAIT_MS = 60_000;
const BINARY_SNIFF_BYTES = 8_000;
// One query for the counts a page of REST results can only cap: the open issues (without pull
// requests), the commits on the default branch and the issues closed in the window. It costs one
// GraphQL point and nothing from the REST search quota, which stays reserved for searches.
const ACTIVITY_QUERY = `query($owner: String!, $name: String!, $since: GitTimestamp!, $closed: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN) { totalCount }
    defaultBranchRef { target { ... on Commit { history(since: $since) { totalCount } } } }
  }
  search(type: ISSUE, query: $closed, first: 0) { issueCount }
}`;

export class GitHubError extends SourceError {
  override name = 'GitHubError';

  /** `status` is null when no response came back at all. */
  constructor(status: number | null, path: string) {
    super(
      status === null
        ? `GitHub request failed before any response for ${path}`
        : `GitHub request failed with HTTP ${status} for ${path}`,
    );
  }
}

export class RateLimitedError extends SourceRateLimitedError {
  override name = 'RateLimitedError';

  constructor(resetAt: Date) {
    super(resetAt, `GitHub rate limit reached; it resets at ${resetAt.toISOString()}`);
  }
}

interface RepoJson {
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count: number;
  pushed_at?: string | null;
  created_at: string;
  license?: { spdx_id?: string | null } | null;
  topics?: string[];
  archived: boolean;
  language?: string | null;
}

interface ActivityJson {
  repository: {
    issues: { totalCount: number };
    // Null for an empty repository, which has no branch yet.
    defaultBranchRef: { target: { history?: { totalCount: number } } } | null;
  };
  search: { issueCount: number };
}

export class GitHubSource implements RepositorySource {
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly searchLimiter: RateLimiter;
  private readonly clock: Clock;
  // Epoch ms at which an exhausted search quota refills; each process starts blind, so the
  // headers of the last search response are the only way to learn what earlier ones spent.
  private searchQuotaResetsAt: number | null = null;

  constructor(opts: {
    token: string;
    fetch: typeof fetch;
    searchLimiter: RateLimiter;
    clock: Clock;
  }) {
    this.token = opts.token;
    this.fetchFn = opts.fetch;
    this.searchLimiter = opts.searchLimiter;
    this.clock = opts.clock;
  }

  async search(query: string, perQuery: number): Promise<Candidate[]> {
    await this.waitForSearchQuota();
    await this.searchLimiter.acquire();
    const params = new URLSearchParams({ q: query, per_page: String(perQuery) });
    const response = await this.request(`/search/repositories?${params}`);
    this.noteSearchQuota(response);
    const body = (await response.json()) as { items: RepoJson[] };

    // One malformed name must not cost the whole query its results.
    return body.items.flatMap((item) => {
      try {
        return [toCandidate(item)];
      } catch {
        return [];
      }
    });
  }

  /** Sleeps out an exhausted quota, or fails at once when the reset is too far to wait for. */
  private async waitForSearchQuota(): Promise<void> {
    if (this.searchQuotaResetsAt === null) {
      return;
    }
    const resetsAt = this.searchQuotaResetsAt;
    const waitMs = resetsAt - this.clock.now();
    if (waitMs > MAX_LIMIT_WAIT_MS) {
      throw new RateLimitedError(new Date(resetsAt));
    }
    this.searchQuotaResetsAt = null;
    if (waitMs > 0) {
      await this.clock.sleep(waitMs);
    }
  }

  private noteSearchQuota(response: Response): void {
    const reset = response.headers.get('x-ratelimit-reset');
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
    this.searchQuotaResetsAt = exhausted && reset !== null ? Number(reset) * 1000 : null;
  }

  async repository(name: RepoName): Promise<Candidate> {
    return toCandidate(await this.repoJson(name));
  }

  async readme(name: RepoName): Promise<string | null> {
    const response = await this.request(`/repos/${name}/readme`, { raw: true, allow: [404] });
    return response.status === 404 ? null : response.text();
  }

  async topLevelTree(name: RepoName): Promise<string[]> {
    // An empty repository answers 404 here.
    const response = await this.request(`/repos/${name}/contents/`, { allow: [404] });
    if (response.status === 404) {
      return [];
    }
    const entries = (await response.json()) as { name: string; type: string }[];
    return entries.map((entry) => (entry.type === 'dir' ? `${entry.name}/` : entry.name));
  }

  async file(name: RepoName, path: string): Promise<FileContent> {
    const segments = path.split('/').filter((segment) => segment !== '');
    // fetch collapses `..` in a URL, which would turn this into a request to another endpoint.
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      return { kind: 'missing' };
    }

    const encoded = segments.map(encodeURIComponent).join('/');
    const response = await this.request(`/repos/${name}/contents/${encoded}`, {
      raw: true,
      allow: [404],
    });
    if (response.status === 404) {
      return { kind: 'missing' };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { kind: 'binary' };
    }
    return { kind: 'text', text: new TextDecoder().decode(bytes) };
  }

  async activity(name: RepoName, since: Date): Promise<ActivityFacts> {
    const [owner, repo] = name.split('/') as [string, string];
    const sinceIso = since.toISOString();
    const [counts, contributors, release] = await Promise.all([
      this.graphql<ActivityJson>(ACTIVITY_QUERY, name, {
        owner,
        name: repo,
        since: sinceIso,
        closed: `repo:${name} is:issue is:closed closed:>=${sinceIso}`,
      }),
      // GitHub refuses with a 403 to list the contributors of a very large repository.
      this.request(`/repos/${name}/contributors?per_page=1`, { allow: [403] }),
      this.request(`/repos/${name}/releases/latest`, { allow: [404] }),
    ]);

    return {
      commitsLast90Days: counts.repository.defaultBranchRef?.target.history?.totalCount ?? 0,
      issuesClosedLast90Days: counts.search.issueCount,
      openIssues: counts.repository.issues.totalCount,
      // A 204 on contributors is an empty repository, and has no body.
      contributors:
        contributors.status === 403
          ? null
          : contributors.status === 204
            ? 0
            : await countItems(contributors),
      latestRelease: release.status === 404 ? null : await toRelease(release),
    };
  }

  /** Runs one GraphQL query; GraphQL reports a missing repository as `errors` in a 200. */
  private async graphql<T>(
    query: string,
    name: RepoName,
    variables: Record<string, string>,
  ): Promise<T> {
    const response = await this.request('/graphql', { body: JSON.stringify({ query, variables }) });
    const body = (await response.json()) as { data?: T | null; errors?: unknown[] };
    if ((body.errors?.length ?? 0) === 0 && body.data != null) {
      return body.data;
    }
    // An exhausted GraphQL limit also comes back as a 200 with errors, and with the usual headers.
    const reset = response.headers.get('x-ratelimit-reset');
    if (response.headers.get('x-ratelimit-remaining') === '0' && reset !== null) {
      throw new RateLimitedError(new Date(Number(reset) * 1000));
    }
    throw new SourceError(`GitHub GraphQL query failed for ${name}`);
  }

  private async repoJson(name: RepoName): Promise<RepoJson> {
    const response = await this.request(`/repos/${name}`);
    return (await response.json()) as RepoJson;
  }

  /**
   * Sends one request and returns the response when it is 2xx or one of the statuses the
   * caller handles itself. A rate-limited reply waits for the reset and is retried once.
   */
  private async request(
    path: string,
    opts: { raw?: boolean; allow?: number[]; body?: string } = {},
  ): Promise<Response> {
    let response = await this.send(path, opts);
    let limit = this.rateLimit(response);

    if (limit !== null) {
      const waitMs = Math.max(0, limit.resetAt.getTime() - this.clock.now());
      if (waitMs > MAX_LIMIT_WAIT_MS) {
        throw new RateLimitedError(limit.resetAt);
      }
      await this.clock.sleep(waitMs);
      response = await this.send(path, opts);
      limit = this.rateLimit(response);
      if (limit !== null) {
        throw new RateLimitedError(limit.resetAt);
      }
    }

    if (response.ok || opts.allow?.includes(response.status) === true) {
      return response;
    }
    // The path only, never the headers: they carry the token.
    throw new GitHubError(response.status, path.split('?')[0]!);
  }

  private async send(path: string, opts: { raw?: boolean; body?: string }): Promise<Response> {
    try {
      return await this.fetchFn(`${API}${path}`, {
        ...(opts.body === undefined ? {} : { method: 'POST', body: opts.body }),
        headers: {
          Accept: opts.raw === true ? RAW_MEDIA : JSON_MEDIA,
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      // Neither the original message nor its cause is kept: fetch can repeat a header value,
      // and with it the token, in the text of its error.
      throw new GitHubError(null, path.split('?')[0]!);
    }
  }

  /** The time the limit lifts when this response is a rate-limit refusal, else null. */
  private rateLimit(response: Response): { resetAt: Date } | null {
    if (response.status !== 403 && response.status !== 429) {
      return null;
    }

    const retryAfter = response.headers.get('retry-after');
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
    if (retryAfter === null && !exhausted) {
      return null;
    }

    const reset = response.headers.get('x-ratelimit-reset');
    if (retryAfter !== null) {
      return { resetAt: new Date(this.clock.now() + Number(retryAfter) * 1000) };
    }
    if (reset !== null) {
      return { resetAt: new Date(Number(reset) * 1000) };
    }
    return { resetAt: new Date(this.clock.now() + DEFAULT_LIMIT_WAIT_MS) };
  }
}

function toCandidate(raw: RepoJson): Candidate {
  return {
    name: parseRepoName(raw.full_name),
    url: raw.html_url,
    description: raw.description ?? null,
    stars: raw.stargazers_count,
    // The domain computes months from this, so it must always be a date. Empty repos have no push.
    pushedAt: raw.pushed_at ?? raw.created_at,
    license: raw.license?.spdx_id ?? null,
    topics: raw.topics ?? [],
    archived: raw.archived,
    language: raw.language ?? null,
  };
}

/**
 * The item count of a list asked for one item per page: the number of its last page, or the
 * items of the only page when the `Link` header names no last page.
 */
async function countItems(response: Response): Promise<number> {
  const last = response.headers
    .get('link')
    ?.split(',')
    .find((part) => part.includes('rel="last"'))
    ?.match(/<([^>]+)>/)?.[1];
  const page = last === undefined ? null : new URL(last).searchParams.get('page');
  return page === null ? ((await response.json()) as unknown[]).length : Number(page);
}

async function toRelease(response: Response): Promise<ActivityFacts['latestRelease']> {
  const body = (await response.json()) as {
    tag_name: string;
    published_at?: string | null;
    created_at?: string;
  };
  return { tag: body.tag_name, publishedAt: body.published_at ?? body.created_at ?? '' };
}
