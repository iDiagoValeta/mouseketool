import { parseRepoName } from '../domain/repo-name.ts';
import type { RepoName } from '../domain/repo-name.ts';
import type { FileContent, RepositorySource } from './ports/repository-source.ts';
import type { RunLog } from './ports/run-log.ts';

const FILE_LIMIT = 20_000;

export type ReadFileResult =
  | { text: string }
  | { text: null; reason: 'binary' | 'missing' }
  | { text: null; reason: 'directory'; entries: string[] };

export async function readRepositoryFile(
  deps: { source: RepositorySource; log: RunLog },
  input: { repo: string; path: string },
): Promise<ReadFileResult> {
  let name: RepoName;
  let content: FileContent;
  try {
    name = parseRepoName(input.repo);
    content = await deps.source.file(name, input.path);
  } catch (error) {
    // A rejected call still counts as the tool being triggered.
    await deps.log.record({ tool: 'read_repository_file', repos: [] });
    throw error;
  }

  // The repo is logged only when text came back: a missing or binary file, or a directory, read no code.
  await deps.log.record({ tool: 'read_repository_file', repos: content.kind === 'text' ? [name] : [] });

  if (content.kind === 'directory') {
    return { text: null, reason: 'directory', entries: content.entries };
  }
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
