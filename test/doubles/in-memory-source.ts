import type {
  FileContent,
  RepositorySource,
} from '../../src/application/ports/repository-source.ts';
import type { Candidate } from '../../src/domain/candidate.ts';
import type { ActivityFacts } from '../../src/domain/health.ts';
import type { RepoName } from '../../src/domain/repo-name.ts';

const NO_ACTIVITY: ActivityFacts = {
  commitsLast90Days: 0,
  issuesClosedLast90Days: 0,
  openIssues: 0,
  contributors: 0,
  latestRelease: null,
};

export interface RepoFixture {
  candidate: Candidate;
  activity?: ActivityFacts;
  readme?: string | null;
  tree?: string[];
  /** File path to content; a path that is not listed is `{ kind: 'missing' }`. */
  files?: Record<string, FileContent>;
}

export interface SourceFixture {
  /** Query text to the candidates that query returns; an unlisted query returns nothing. */
  searches?: Record<string, Candidate[]>;
  /** Query text to the message its `search` call throws with. */
  failingQueries?: Record<string, string>;
  /** Repos that `repository`, `activity`, `readme`, `topLevelTree` and `file` know about. */
  repos?: RepoFixture[];
}

/**
 * Test double for RepositorySource, built from plain data. It also records the arguments it
 * was called with, so tests can assert on them without a mocking library.
 */
export class InMemorySource implements RepositorySource {
  readonly searchCalls: { query: string; perQuery: number }[] = [];
  readonly activityCalls: { name: RepoName; since: Date }[] = [];
  private readonly repos = new Map<RepoName, RepoFixture>();

  constructor(private readonly fixture: SourceFixture = {}) {
    for (const repo of fixture.repos ?? []) {
      this.repos.set(repo.candidate.name.toLowerCase(), repo);
    }
  }

  async search(query: string, perQuery: number): Promise<Candidate[]> {
    this.searchCalls.push({ query, perQuery });
    const failure = this.fixture.failingQueries?.[query];
    if (failure !== undefined) {
      throw new Error(failure);
    }
    return (this.fixture.searches?.[query] ?? []).slice(0, perQuery);
  }

  async repository(name: RepoName): Promise<Candidate> {
    return this.known(name).candidate;
  }

  async activity(name: RepoName, since: Date): Promise<ActivityFacts> {
    this.activityCalls.push({ name, since });
    return this.known(name).activity ?? NO_ACTIVITY;
  }

  async readme(name: RepoName): Promise<string | null> {
    return this.known(name).readme ?? null;
  }

  async topLevelTree(name: RepoName): Promise<string[]> {
    return this.known(name).tree ?? [];
  }

  async file(name: RepoName, path: string): Promise<FileContent> {
    return this.known(name).files?.[path] ?? { kind: 'missing' };
  }

  private known(name: RepoName): RepoFixture {
    const repo = this.repos.get(name);
    if (repo === undefined) {
      throw new Error(`Repository not found: ${name}`);
    }
    return repo;
  }
}
