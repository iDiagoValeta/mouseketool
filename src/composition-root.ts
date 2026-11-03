import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunLog } from './application/ports/run-log.ts';
import { GitHubSource } from './infrastructure/github/github-source.ts';
import { RateLimiter, systemClock } from './infrastructure/github/rate-limiter.ts';
import { ghAuthToken, resolveToken } from './infrastructure/github/token.ts';
import { createMcpServer } from './infrastructure/mcp/server.ts';
import { JsonlRunLog } from './infrastructure/run-log/jsonl-run-log.ts';
import { NoopRunLog } from './infrastructure/run-log/noop-run-log.ts';

// GitHub allows 30 search requests per minute for an authenticated caller.
const SEARCHES_PER_MINUTE = 30;

export async function compose(env: NodeJS.ProcessEnv): Promise<McpServer> {
  const token = await resolveToken(env, ghAuthToken);
  const source = new GitHubSource({
    token,
    fetch,
    searchLimiter: new RateLimiter(SEARCHES_PER_MINUTE, systemClock),
    clock: systemClock,
  });

  const logPath = env['MOUSEKETOOL_RUN_LOG'];
  const log: RunLog = logPath ? new JsonlRunLog(logPath) : new NoopRunLog();

  return createMcpServer({ source, log, now: () => new Date() });
}
