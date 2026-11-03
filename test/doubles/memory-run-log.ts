import type { RunLog } from '../../src/application/ports/run-log.ts';
import type { RepoName } from '../../src/domain/repo-name.ts';

export class MemoryRunLog implements RunLog {
  readonly entries: { tool: string; repos: RepoName[] }[] = [];

  async record(entry: { tool: string; repos: RepoName[] }): Promise<void> {
    this.entries.push(entry);
  }
}
