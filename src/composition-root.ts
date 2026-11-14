import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RunLog } from './application/ports/run-log.ts';
import { GitHubSource } from './infrastructure/github/github-source.ts';
import { Concurrency, systemClock } from './infrastructure/github/concurrency.ts';
import { ghAuthToken, resolveToken } from './infrastructure/github/token.ts';
import { warnIfTokenCanWrite } from './infrastructure/github/token-scopes.ts';
import { createMcpServer } from './infrastructure/mcp/server.ts';
import { JsonlRunLog } from './infrastructure/run-log/jsonl-run-log.ts';
import { NoopRunLog } from './infrastructure/run-log/noop-run-log.ts';

// Read at run time from the package.json one level up, from src/ and from dist/ alike, so a release that only
// bumps the version leaves the committed bundle unchanged.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Searches go through GraphQL, which has no per-minute search quota; 15 at once ran with no error or
// retry-after in a burst of 60 (#59), so 10 at once leaves room for the rest of the caller's GitHub use.
const SEARCHES_AT_ONCE = 10;

export async function compose(env: NodeJS.ProcessEnv): Promise<McpServer> {
  const token = await resolveToken(env, ghAuthToken);
  // Not awaited: the check is advice and must not delay the server's start. stdout carries the protocol.
  void warnIfTokenCanWrite({ token, fetch, warn: (line) => process.stderr.write(`${line}\n`) });
  const source = new GitHubSource({
    token: token.value,
    fetch,
    searchConcurrency: new Concurrency(SEARCHES_AT_ONCE),
    clock: systemClock,
  });

  const logPath = env['MOUSEKETOOL_RUN_LOG'];
  const log: RunLog = logPath ? new JsonlRunLog(logPath) : new NoopRunLog();

  return createMcpServer({ source, log, now: () => new Date(), version });
}
