import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SourceError,
  SourceRateLimitedError,
  type RepositorySource,
} from '../../../src/application/ports/repository-source.ts';
import type { Candidate } from '../../../src/domain/candidate.ts';
import { createMcpServer } from '../../../src/infrastructure/mcp/server.ts';
import { InMemorySource } from '../../doubles/in-memory-source.ts';
import { MemoryRunLog } from '../../doubles/memory-run-log.ts';

function candidate(name: string, stars = 0): Candidate {
  return {
    name,
    url: `https://github.com/${name}`,
    description: null,
    stars,
    pushedAt: '2026-01-01T00:00:00Z',
    license: null,
    topics: [],
    archived: false,
    language: null,
  };
}

const NOW = new Date('2026-11-03T00:00:00Z');
const clients: Client[] = [];

async function connect(source: RepositorySource, log = new MemoryRunLog()): Promise<Client> {
  const server = createMcpServer({ source, log, now: () => NOW, version: '9.9.9' });
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  clients.push(client);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe('text');
  return content[0]!.text;
}

function sourceFailingWith(error: Error): RepositorySource {
  const fail = () => Promise.reject(error);
  return {
    search: fail,
    repository: fail,
    activity: fail,
    readme: fail,
    topLevelTree: fail,
    file: fail,
  };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('createMcpServer', () => {
  it('names itself mouseketool', async () => {
    const client = await connect(new InMemorySource());

    expect(client.getServerVersion()?.name).toBe('mouseketool');
  });

  it('exposes exactly the three tools, each described for the host model', async () => {
    const client = await connect(new InMemorySource());

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'inspect_repository',
      'read_repository_file',
      'search_repositories',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.description?.length ?? 0).toBeLessThan(600);
    }
    const search = tools.find((tool) => tool.name === 'search_repositories');
    expect(search?.description).toMatch(/1 to 30/);
    expect(search?.description).toMatch(/does no judging/i);
  });

  it('names in the descriptions the fields the responses really carry', async () => {
    const source = new InMemorySource({
      searches: { 'local rag': [candidate('foo/bar', 5)] },
      repos: [{ candidate: candidate('foo/bar', 5), readme: '# bar', tree: ['src'] }],
    });
    const client = await connect(source);
    const { tools } = await client.listTools();
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';

    const found = JSON.parse(
      textOf(await client.callTool({ name: 'search_repositories', arguments: { queries: ['local rag'] } })),
    ) as { candidates: Record<string, unknown>[] };
    const inspected = JSON.parse(
      textOf(await client.callTool({ name: 'inspect_repository', arguments: { repo: 'foo/bar' } })),
    ) as { health: Record<string, unknown> };

    for (const field of Object.keys(found.candidates[0]!)) expect(described('search_repositories')).toContain(field);
    for (const field of Object.keys(inspected.health)) expect(described('inspect_repository')).toContain(field);
    // The health block has no adoption field: stars and contributors are raw facts, not a signal.
    expect(described('inspect_repository')).not.toMatch(/adoption/i);
  });

  it('returns merged candidates from search_repositories as JSON', async () => {
    const source = new InMemorySource({
      searches: {
        'local rag': [candidate('foo/bar', 5), candidate('baz/qux', 50)],
        'topic:rag': [candidate('foo/bar', 5)],
      },
    });
    const log = new MemoryRunLog();
    const client = await connect(source, log);

    const result = await client.callTool({
      name: 'search_repositories',
      arguments: { queries: ['local rag', 'topic:rag'] },
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result)) as {
      candidates: { name: string; matchedQueries: number }[];
    };
    expect(body.candidates.map((c) => [c.name, c.matchedQueries])).toEqual([
      ['foo/bar', 2],
      ['baz/qux', 1],
    ]);
    expect(log.entries).toEqual([{ tool: 'search_repositories', repos: ['foo/bar', 'baz/qux'] }]);
  });

  it('returns the report from inspect_repository as JSON', async () => {
    const source = new InMemorySource({
      repos: [{ candidate: candidate('foo/bar', 5), readme: '# bar', tree: ['src'] }],
    });
    const client = await connect(source);

    const result = await client.callTool({
      name: 'inspect_repository',
      arguments: { repo: 'https://github.com/Foo/Bar' },
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result)) as { candidate: Candidate; readme: string };
    expect(body.candidate.name).toBe('foo/bar');
    expect(body.readme).toBe('# bar');
  });

  it('returns the file from read_repository_file as JSON', async () => {
    const source = new InMemorySource({
      repos: [
        {
          candidate: candidate('foo/bar'),
          files: { 'a.txt': { kind: 'text', text: 'hello' } },
        },
      ],
    });
    const client = await connect(source);

    const found = await client.callTool({
      name: 'read_repository_file',
      arguments: { repo: 'foo/bar', path: 'a.txt' },
    });
    const missing = await client.callTool({
      name: 'read_repository_file',
      arguments: { repo: 'foo/bar', path: 'nope.txt' },
    });

    expect(JSON.parse(textOf(found))).toEqual({ text: 'hello' });
    expect(JSON.parse(textOf(missing))).toEqual({ text: null, reason: 'missing' });
  });

  it('returns an invalid repo name as an error with the expected form', async () => {
    const client = await connect(new InMemorySource());

    const result = await client.callTool({
      name: 'inspect_repository',
      arguments: { repo: 'foo' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Expected "owner/name", got "foo"');
  });

  it('returns a query count outside 1 to 30 as an error', async () => {
    const client = await connect(new InMemorySource());

    const none = await client.callTool({ name: 'search_repositories', arguments: { queries: [] } });
    const many = await client.callTool({
      name: 'search_repositories',
      arguments: { queries: Array.from({ length: 31 }, (_, i) => `q${i}`) },
    });

    // The schema rejects them before the use case runs, naming the bound that was broken.
    expect(none.isError).toBe(true);
    expect(textOf(none)).toMatch(/>=1 items/);
    expect(many.isError).toBe(true);
    expect(textOf(many)).toMatch(/<=30 items/);
  });

  it('declares every tool read-only and open-world, and the query bounds in the search schema', async () => {
    const client = await connect(new InMemorySource());
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    }
    const search = tools.find((tool) => tool.name === 'search_repositories');
    expect(search?.inputSchema.properties?.['queries']).toMatchObject({ minItems: 1, maxItems: 30 });
  });

  it('returns the rate limit and source errors of any source with their message', async () => {
    const resetAt = new Date('2026-11-03T00:05:00Z');

    const limited = await (
      await connect(sourceFailingWith(new SourceRateLimitedError(resetAt, 'Rate limit reached; it resets at 2026-11-03T00:05:00.000Z')))
    ).callTool({ name: 'inspect_repository', arguments: { repo: 'foo/bar' } });
    const broken = await (
      await connect(sourceFailingWith(new SourceError('The source failed with HTTP 500 for /repos/foo/bar')))
    ).callTool({ name: 'read_repository_file', arguments: { repo: 'foo/bar', path: 'a' } });

    expect(limited.isError).toBe(true);
    expect(textOf(limited)).toBe('Rate limit reached; it resets at 2026-11-03T00:05:00.000Z');
    expect(broken.isError).toBe(true);
    expect(textOf(broken)).toBe('The source failed with HTTP 500 for /repos/foo/bar');
  });

  it('hides the text of an unexpected error', async () => {
    const client = await connect(sourceFailingWith(new Error('secret ghp_abc leaked in a stack')));

    const result = await client.callTool({
      name: 'inspect_repository',
      arguments: { repo: 'foo/bar' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Unexpected error in inspect_repository');
  });
});
