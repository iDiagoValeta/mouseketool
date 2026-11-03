import { parseRepoName } from '../domain/repo-name.ts';
import type { RepositorySource } from './ports/repository-source.ts';
import type { RunLog } from './ports/run-log.ts';

const FILE_LIMIT = 20_000;

export type ReadFileResult = { text: string } | { text: null; reason: 'binary' | 'missing' };

export async function readRepositoryFile(
  deps: { source: RepositorySource; log: RunLog },
  input: { repo: string; path: string },
): Promise<ReadFileResult> {
  const name = parseRepoName(input.repo);
  const content = await deps.source.file(name, input.path);

  await deps.log.record({ tool: 'read_repository_file', repos: [name] });

  if (content.kind !== 'text') {
    return { text: null, reason: content.kind };
  }
  return {
    text:
      content.text.length > FILE_LIMIT
        ? `${content.text.slice(0, FILE_LIMIT)}\n[truncated]`
        : content.text,
  };
}
