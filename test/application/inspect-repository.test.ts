import { describe, expect, it } from 'vitest';
import { inspectRepository } from '../../src/application/inspect-repository.ts';
import type { Candidate } from '../../src/domain/candidate.ts';
import type { ActivityFacts } from '../../src/domain/health.ts';
import { assessHealth } from '../../src/domain/health.ts';
import { InvalidRepoNameError } from '../../src/domain/repo-name.ts';
import type { RepoFixture } from '../doubles/in-memory-source.ts';
import { InMemorySource } from '../doubles/in-memory-source.ts';
import { MemoryRunLog } from '../doubles/memory-run-log.ts';

const NOW = new Date('2026-11-03T12:00:00Z');

const CANDIDATE: Candidate = {
  name: 'foo/bar',
  url: 'https://github.com/foo/bar',
  description: 'A thing',
  stars: 120,
  pushedAt: '2026-10-01T00:00:00Z',
  license: 'MIT',
  topics: ['rag'],
  archived: false,
  language: 'TypeScript',
};

const ACTIVITY: ActivityFacts = {
  commitsLast90Days: 12,
  issuesClosedLast90Days: 4,
  openIssues: 7,
  contributors: 3,
  latestRelease: { tag: 'v1.0.0', publishedAt: '2026-09-01T00:00:00Z' },
};

function setup(overrides: Partial<RepoFixture> = {}) {
  const source = new InMemorySource({
    repos: [{ candidate: CANDIDATE, activity: ACTIVITY, tree: ['src', 'README.md'], ...overrides }],
  });
  const log = new MemoryRunLog();
  return { source, log, deps: { source, log, now: () => NOW } };
}

describe('inspectRepository', () => {
  it('normalizes a GitHub URL to owner/name', async () => {
    const { deps, source } = setup();

    const report = await inspectRepository(deps, { repo: 'https://github.com/Foo/Bar' });

    expect(report.candidate).toEqual(CANDIDATE);
    expect(source.activityCalls[0]?.name).toBe('foo/bar');
  });

  it('rejects input that is not a repo', async () => {
    const { deps } = setup();

    await expect(inspectRepository(deps, { repo: 'not a repo' })).rejects.toThrow(
      InvalidRepoNameError,
    );
  });

  it('asks for activity since 90 days before now', async () => {
    const { deps, source } = setup();

    await inspectRepository(deps, { repo: 'foo/bar' });

    expect(source.activityCalls[0]?.since).toEqual(new Date('2026-08-05T12:00:00Z'));
  });

  it('derives health from the candidate, its activity and the injected now', async () => {
    const { deps } = setup();

    const report = await inspectRepository(deps, { repo: 'foo/bar' });

    expect(report.health).toEqual(assessHealth(CANDIDATE, ACTIVITY, NOW));
    expect(report.health).toMatchObject({ maintenance: 'active', licenseKind: 'permissive' });
    expect(report.activity).toEqual(ACTIVITY);
    expect(report.tree).toEqual(['src', 'README.md']);
  });

  it('cuts a README over 12,000 characters and marks it', async () => {
    const { deps } = setup({ readme: 'a'.repeat(13_000) });

    const report = await inspectRepository(deps, { repo: 'foo/bar' });

    expect(report.readme).toBe(`${'a'.repeat(12_000)}\n[truncated]`);
  });

  it('returns a README of exactly 12,000 characters unchanged', async () => {
    const readme = 'a'.repeat(12_000);
    const { deps } = setup({ readme });

    expect((await inspectRepository(deps, { repo: 'foo/bar' })).readme).toBe(readme);
  });

  it('keeps a missing README as null', async () => {
    const { deps } = setup({ readme: null });

    expect((await inspectRepository(deps, { repo: 'foo/bar' })).readme).toBeNull();
  });

  it('logs the normalized repo name', async () => {
    const { deps, log } = setup();

    await inspectRepository(deps, { repo: 'https://github.com/Foo/Bar' });

    expect(log.entries).toEqual([{ tool: 'inspect_repository', repos: ['foo/bar'] }]);
  });
});
