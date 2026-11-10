import { describe, expect, it } from 'vitest';
import { readRepositoryFile } from '../../src/application/read-repository-file.ts';
import type { FileContent } from '../../src/application/ports/repository-source.ts';
import type { Candidate } from '../../src/domain/candidate.ts';
import { InvalidRepoNameError } from '../../src/domain/repo-name.ts';
import { InMemorySource } from '../doubles/in-memory-source.ts';
import { MemoryRunLog } from '../doubles/memory-run-log.ts';

const CANDIDATE: Candidate = {
  name: 'foo/bar',
  url: 'https://github.com/foo/bar',
  description: null,
  stars: 1,
  pushedAt: '2026-10-01T00:00:00Z',
  license: null,
  topics: [],
  archived: false,
  language: null,
};

function setup(files: Record<string, FileContent>) {
  const log = new MemoryRunLog();
  const source = new InMemorySource({ repos: [{ candidate: CANDIDATE, files }] });
  return { log, deps: { source, log } };
}

describe('readRepositoryFile', () => {
  it('returns the text of a small file unchanged', async () => {
    const { deps } = setup({ 'src/a.ts': { kind: 'text', text: 'export {}' } });

    expect(await readRepositoryFile(deps, { repo: 'foo/bar', path: 'src/a.ts' })).toEqual({
      text: 'export {}',
    });
  });

  it('explains a binary file with reason binary', async () => {
    const { deps } = setup({ 'logo.png': { kind: 'binary' } });

    expect(await readRepositoryFile(deps, { repo: 'foo/bar', path: 'logo.png' })).toEqual({
      text: null,
      reason: 'binary',
    });
  });

  it('lists a directory with reason directory', async () => {
    const { deps } = setup({ src: { kind: 'directory', entries: ['a.ts', 'lib/'] } });

    expect(await readRepositoryFile(deps, { repo: 'foo/bar', path: 'src' })).toEqual({
      text: null,
      reason: 'directory',
      entries: ['a.ts', 'lib/'],
    });
  });

  it('explains an absent file with reason missing', async () => {
    const { deps } = setup({});

    expect(await readRepositoryFile(deps, { repo: 'foo/bar', path: 'nope.md' })).toEqual({
      text: null,
      reason: 'missing',
    });
  });

  it('cuts text over 20,000 characters and marks it', async () => {
    const { deps } = setup({ 'big.txt': { kind: 'text', text: 'a'.repeat(20_001) } });

    expect(await readRepositoryFile(deps, { repo: 'foo/bar', path: 'big.txt' })).toEqual({
      text: `${'a'.repeat(20_000)}\n[truncated]`,
    });
  });

  it('returns text of exactly 20,000 characters unchanged', async () => {
    const text = 'a'.repeat(20_000);
    const { deps } = setup({ 'edge.txt': { kind: 'text', text } });

    expect(await readRepositoryFile(deps, { repo: 'foo/bar', path: 'edge.txt' })).toEqual({ text });
  });

  it('normalizes the repo and logs it, also when the file is missing', async () => {
    const { deps, log } = setup({});

    await readRepositoryFile(deps, { repo: 'https://github.com/Foo/Bar.git', path: 'x' });

    expect(log.entries).toEqual([{ tool: 'read_repository_file', repos: ['foo/bar'] }]);
  });

  it('rejects input that is not a repo', async () => {
    const { deps } = setup({});

    await expect(readRepositoryFile(deps, { repo: 'nope', path: 'x' })).rejects.toThrow(
      InvalidRepoNameError,
    );
  });

  it('logs one empty entry and rethrows when the repo name is invalid', async () => {
    const { deps, log } = setup({});

    await expect(readRepositoryFile(deps, { repo: 'nope', path: 'x' })).rejects.toThrow(
      InvalidRepoNameError,
    );
    expect(log.entries).toEqual([{ tool: 'read_repository_file', repos: [] }]);
  });

  it('logs one empty entry and rethrows the source error when the repo is unknown', async () => {
    const { deps, log } = setup({});

    await expect(readRepositoryFile(deps, { repo: 'other/repo', path: 'x' })).rejects.toThrow(
      'Repository not found: other/repo',
    );
    expect(log.entries).toEqual([{ tool: 'read_repository_file', repos: [] }]);
  });
});
