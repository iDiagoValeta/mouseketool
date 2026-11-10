import type { Candidate } from '../../domain/candidate.ts';
import type { ActivityFacts } from '../../domain/health.ts';
import type { RepoName } from '../../domain/repo-name.ts';

export type FileContent =
  | { kind: 'text'; text: string }
  | { kind: 'binary' }
  | { kind: 'missing' }
  // A directory's entries, with a trailing `/` on each subdirectory.
  | { kind: 'directory'; entries: string[] };

/** A source could not answer. The message is safe to show: it names what failed, never a credential or a query. */
export class SourceError extends Error {
  override name = 'SourceError';
}

/** A source refused because a limit was reached; `resetAt` is when it lifts. */
export class SourceRateLimitedError extends SourceError {
  override name = 'SourceRateLimitedError';

  constructor(
    readonly resetAt: Date,
    message: string,
  ) {
    super(message);
  }
}

/** Where repository data comes from. GitHub is the only implementation in v1. */
export interface RepositorySource {
  search(query: string, perQuery: number): Promise<Candidate[]>;
  repository(name: RepoName): Promise<Candidate>;
  activity(name: RepoName, since: Date): Promise<ActivityFacts>;
  readme(name: RepoName): Promise<string | null>;
  topLevelTree(name: RepoName): Promise<string[]>;
  file(name: RepoName, path: string): Promise<FileContent>;
}
