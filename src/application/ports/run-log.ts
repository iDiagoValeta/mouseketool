import type { RepoName } from '../../domain/repo-name.ts';

/**
 * Records which tool ran and which repos it returned. Inputs are deliberately not part of an
 * entry, so no query text, secret or prompt can land in the log.
 */
export interface RunLog {
  record(entry: { tool: string; repos: RepoName[] }): Promise<void>;
}
