import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunLog } from '../../application/ports/run-log.ts';
import type { RepoName } from '../../domain/repo-name.ts';

export class JsonlRunLog implements RunLog {
  constructor(private readonly path: string) {}

  async record(entry: { tool: string; repos: RepoName[] }): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Fields are picked one by one so a caller cannot widen the entry and leak input into the log.
    const line = JSON.stringify({ tool: entry.tool, repos: entry.repos });
    await appendFile(this.path, `${line}\n`);
  }
}
