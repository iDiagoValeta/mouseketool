import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunLog } from '../../../src/application/ports/run-log.ts';
import { JsonlRunLog } from '../../../src/infrastructure/run-log/jsonl-run-log.ts';
import { NoopRunLog } from '../../../src/infrastructure/run-log/noop-run-log.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mouseketool-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonlRunLog', () => {
  it('appends one parseable JSON line per record with only tool and repos', async () => {
    const path = join(dir, 'runs.jsonl');
    const log = new JsonlRunLog(path);

    await log.record({ tool: 'search_candidates', repos: ['a/b', 'c/d'] });
    await log.record({ tool: 'inspect_repository', repos: ['a/b'] });

    const lines = (await readFile(path, 'utf8')).split('\n');
    expect(lines.pop()).toBe('');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { tool: 'search_candidates', repos: ['a/b', 'c/d'] },
      { tool: 'inspect_repository', repos: ['a/b'] },
    ]);
  });

  it('drops any extra field a caller sneaks into an entry', async () => {
    const path = join(dir, 'runs.jsonl');
    const entry = { tool: 't', repos: [], query: 'secret idea' } as { tool: string; repos: string[] };

    await new JsonlRunLog(path).record(entry);

    expect(await readFile(path, 'utf8')).toBe('{"tool":"t","repos":[]}\n');
  });

  it('creates the parent directory when it is missing', async () => {
    const path = join(dir, 'nested', 'deeper', 'runs.jsonl');

    await new JsonlRunLog(path).record({ tool: 't', repos: [] });

    expect(await readFile(path, 'utf8')).toBe('{"tool":"t","repos":[]}\n');
  });
});

describe('NoopRunLog', () => {
  it('accepts records and does nothing', async () => {
    const log: RunLog = new NoopRunLog();
    await expect(log.record({ tool: 't', repos: [] })).resolves.toBeUndefined();
  });
});
