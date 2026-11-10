import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { inspectRepository } from '../../application/inspect-repository.ts';
import {
  SourceError,
  SourceRateLimitedError,
  type RepositorySource,
} from '../../application/ports/repository-source.ts';
import type { RunLog } from '../../application/ports/run-log.ts';
import { readRepositoryFile } from '../../application/read-repository-file.ts';
import { searchCandidates, TooManyQueriesError } from '../../application/search-candidates.ts';
import { InvalidRepoNameError } from '../../domain/repo-name.ts';

const SEARCH_DESCRIPTION =
  'Searches GitHub for existing projects. Takes 1 to 30 varied queries in one call: ' +
  'synonyms, community names, and "topic:" qualifiers. Returns the merged candidates as JSON ' +
  '(name, url, description, stars, pushedAt, license, topics, archived, language, matchedQueries) plus per-query ' +
  'errors. Candidates found by several queries rank first. The server does no judging: ' +
  'deciding what is relevant is up to you.';

const INSPECT_DESCRIPTION =
  'Inspects one GitHub repository. Returns JSON with its metadata (candidate), health signals ' +
  '(archived, monthsSinceLastPush, stale, licenseKind, maintenance), activity of the last 90 days ' +
  '(commits, closed issues, open issues without pull requests, contributors or null when GitHub will not ' +
  'count them, latest release), the README (truncated) and the ' +
  'top-level file list. The server does no judging: it reports facts, you decide. ' +
  '`repo` is "owner/name" or a GitHub URL.';

const READ_FILE_DESCRIPTION =
  'Reads one file from a GitHub repository, for example a manifest or a docs page, to check ' +
  'what a project really does. Returns JSON: { text } with the content (truncated when long), ' +
  'or { text: null, reason } when the file is binary or missing. A directory path returns ' +
  '{ text: null, reason: "directory", entries }, with a trailing "/" on subdirectories. ' +
  '`repo` is "owner/name" or a GitHub URL; `path` is relative to the repository root.';

// Every tool only reads public GitHub data: a host may run them without asking, and their results change as
// GitHub does.
const ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };

// Errors a caller can act on: their message is safe to show and says what to change.
const REPORTABLE = [InvalidRepoNameError, TooManyQueriesError, SourceRateLimitedError, SourceError];

export function createMcpServer(deps: {
  source: RepositorySource;
  log: RunLog;
  now: () => Date;
  version: string;
}): McpServer {
  const server = new McpServer({ name: 'mouseketool', version: deps.version });

  server.registerTool(
    'search_repositories',
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        queries: z.array(z.string()).min(1).max(30).describe('1 to 30 GitHub search queries'),
      },
      annotations: ANNOTATIONS,
    },
    (input) => respond('search_repositories', () => searchCandidates(deps, input)),
  );

  server.registerTool(
    'inspect_repository',
    {
      description: INSPECT_DESCRIPTION,
      inputSchema: { repo: z.string().describe('"owner/name" or a GitHub URL') },
      annotations: ANNOTATIONS,
    },
    (input) => respond('inspect_repository', () => inspectRepository(deps, input)),
  );

  server.registerTool(
    'read_repository_file',
    {
      description: READ_FILE_DESCRIPTION,
      annotations: ANNOTATIONS,
      inputSchema: {
        repo: z.string().describe('"owner/name" or a GitHub URL'),
        path: z.string().describe('File path relative to the repository root'),
      },
    },
    (input) => respond('read_repository_file', () => readRepositoryFile(deps, input)),
  );

  return server;
}

async function respond(tool: string, run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run()) }] };
  } catch (error) {
    // Anything not listed may carry a stack, a URL or a secret, so it is never echoed.
    const reportable = REPORTABLE.some((type) => error instanceof type);
    const message = reportable ? (error as Error).message : `Unexpected error in ${tool}`;
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}
