import type { Candidate } from '../../domain/candidate.ts';
import type { ActivityFacts } from '../../domain/health.ts';
import type { RepoName } from '../../domain/repo-name.ts';

export type FileContent = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'missing' };

/** Where repository data comes from. GitHub is the only implementation in v1. */
export interface RepositorySource {
  search(query: string, perQuery: number): Promise<Candidate[]>;
  repository(name: RepoName): Promise<Candidate>;
  activity(name: RepoName, since: Date): Promise<ActivityFacts>;
  readme(name: RepoName): Promise<string | null>;
  topLevelTree(name: RepoName): Promise<string[]>;
  file(name: RepoName, path: string): Promise<FileContent>;
}
