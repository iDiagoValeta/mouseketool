import { describe, expect, it } from 'vitest';
import { GitHubSource } from '../../../src/infrastructure/github/github-source.ts';
import { RateLimiter, systemClock } from '../../../src/infrastructure/github/rate-limiter.ts';
import { ghAuthToken, resolveToken } from '../../../src/infrastructure/github/token.ts';

// Talks to the real GitHub API with the real token, so it only runs on request.
describe.skipIf(process.env['MOUSEKETOOL_LIVE'] !== '1')('GitHubSource against api.github.com', () => {
  async function liveSource(): Promise<GitHubSource> {
    return new GitHubSource({
      token: await resolveToken(process.env, ghAuthToken),
      fetch,
      searchLimiter: new RateLimiter(30, systemClock),
      clock: systemClock,
    });
  }

  it('finds candidates for a query', async () => {
    const candidates = await (await liveSource()).search('model context protocol server', 5);

    expect(candidates.length).toBeGreaterThan(0);
  });

  it('reads the README of modelcontextprotocol/typescript-sdk', async () => {
    const readme = await (await liveSource()).readme('modelcontextprotocol/typescript-sdk');

    expect(readme).not.toBeNull();
  });
});
