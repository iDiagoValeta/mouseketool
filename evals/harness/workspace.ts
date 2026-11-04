import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoName } from '../../src/domain/repo-name.ts';
import type { Run } from './plan-runs.ts';

export type Workspace = { dir: string; runLog: string };

export const WORKSPACE_ROOT = join(tmpdir(), 'mouseketool-eval');

/** Directories created and not yet removed: the ones holding the token that an interrupt would leave on disk. */
const liveWorkspaces = new Set<string>();

/**
 * A fresh directory holding the skill (unless `options.skill` is false) and the host's MCP config, and nothing else:
 * the host must find the mouseketool skill and the server, not the author's own setup.
 * The token reaches the server only through its MCP config, never through the host's environment.
 * `node` is `process.execPath` so the server does not depend on the PATH the host hands to its children.
 */
export function createWorkspace(
  run: Run,
  repoRoot: string,
  githubToken: string,
  base: string = WORKSPACE_ROOT,
  // The judge gets the MCP server but must not be able to load the skill.
  options: { skill: boolean } = { skill: true },
): Workspace {
  const dir = join(base, `${run.caseId}-${run.kind}`);
  rmSync(dir, { recursive: true, force: true });
  liveWorkspaces.add(dir);
  // The MCP config holds the GitHub token, so only the author may read the workspace.
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const runLog = join(dir, 'run.jsonl');
  const server = join(repoRoot, 'dist', 'server.mjs');
  const serverEnv = { MOUSEKETOOL_RUN_LOG: runLog, GITHUB_TOKEN: githubToken }; // pragma: allowlist secret
  const skill = join(repoRoot, 'skills', 'mouseketool');

  if (run.host === 'opencode-deepseek-flash') {
    if (options.skill) cpSync(skill, join(dir, '.opencode', 'skills', 'mouseketool'), { recursive: true });
    // HOME points here so the global skill directories of the author are not read.
    mkdirSync(join(dir, 'home'));
    // The host reads untrusted READMEs and code, and this directory holds the token, so it gets no built-in tool.
    // Measured on opencode v2.2.3 (2026-11-04) by asking the host which tools it can call and what they reach:
    // - `permissions` is an ordered list and the last matching rule wins, so deny-all comes first. It also
    //   denies `question`, which a headless run could not answer.
    // - MCP tools are only reachable from inside `execute`, a sandbox with no file, process or shell access
    //   (`fetch` refuses `file://`); `codemode: false` did not change that. So `execute` stays allowed, and so
    //   do `mouseketool*`, the action name of the server's tools (`mouseketool_*` and `mouseketool.*` match nothing).
    // - `skill` stays allowed so the skill loads.
    const config = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        mouseketool: {
          type: 'local',
          command: [process.execPath, server],
          environment: serverEnv,
        },
      },
      permissions: [
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'skill', resource: '*', effect: 'allow' },
        { action: 'execute', resource: '*', effect: 'allow' },
        { action: 'mouseketool*', resource: '*', effect: 'allow' },
      ],
    };
    writeFileSync(join(dir, 'opencode.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  } else {
    // The host runs in work/ and its file tools reach only that, so the token's config stays one level up.
    mkdirSync(join(dir, 'work'));
    if (options.skill) cpSync(skill, join(dir, 'work', '.claude', 'skills', 'mouseketool'), { recursive: true });
    const config = {
      mcpServers: {
        mouseketool: { command: process.execPath, args: [server], env: serverEnv },
      },
    };
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  return { dir, runLog };
}

export function removeWorkspace(workspace: Workspace): void {
  rmSync(workspace.dir, { recursive: true, force: true });
  liveWorkspaces.delete(workspace.dir);
}

/** For SIGINT and SIGTERM, where the `finally` blocks that remove workspaces never run. */
export function removeLiveWorkspaces(): void {
  for (const dir of liveWorkspaces) rmSync(dir, { recursive: true, force: true });
  liveWorkspaces.clear();
}

export type RunLog = { triggered: boolean; searchedRepos: RepoName[]; inspectedRepos: RepoName[]; fileReads: number };

/**
 * `triggered` is true when the server logged a search or an inspect, failed calls included.
 * A line that does not parse still shows the server ran, so it counts as a call without repos.
 * `searchedRepos` comes from `search_repositories` lines only: those are the repos the server returned, so a
 * recommendation outside them came from the model's memory. `inspect_repository` logs the repo the model
 * asked for, which can be a remembered one, so it proves nothing about where the name came from.
 * `fileReads` counts the `read_repository_file` lines, failed calls included: the skill requires reading code
 * before any verdict, and a failed read still shows the host tried.
 */
export function readRunLog(workspace: Workspace): RunLog {
  if (!existsSync(workspace.runLog)) return { triggered: false, searchedRepos: [], inspectedRepos: [], fileReads: 0 };
  const lines = readFileSync(workspace.runLog, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const reposOf = (tool: string): RepoName[] => {
    const repos = lines.flatMap((line): RepoName[] => {
      try {
        const entry = JSON.parse(line) as { tool?: unknown; repos?: unknown };
        if (entry.tool !== tool || !Array.isArray(entry.repos)) return [];
        return entry.repos.filter((r): r is RepoName => typeof r === 'string');
      } catch {
        return [];
      }
    });
    return [...new Set(repos)];
  };
  // The method starts with a search or an inspect. A lone read_repository_file call is a host without local file
  // tools trying the server's reader on a local path, not the skill firing. A line that does not parse is kept as
  // a call, since it still shows the server ran something.
  const methodRan = lines.some((line) => {
    try {
      const { tool } = JSON.parse(line) as { tool?: unknown };
      return tool === 'search_repositories' || tool === 'inspect_repository';
    } catch {
      return true;
    }
  });
  const fileReads = lines.filter((line) => {
    try {
      return (JSON.parse(line) as { tool?: unknown }).tool === 'read_repository_file';
    } catch {
      return false;
    }
  }).length;
  return {
    triggered: methodRan,
    searchedRepos: reposOf('search_repositories'),
    inspectedRepos: reposOf('inspect_repository'),
    fileReads,
  };
}
