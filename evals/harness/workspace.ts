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
    // Keys are those of opencode v2 (checked with `opencode debug agents`, which prints the resolved rules):
    // - `permissions` is an ordered list and the last matching rule wins, so deny-all comes first. It also
    //   denies `question`, which a headless run could not answer.
    // - `skill` stays allowed so the skill loads; `mouseketool_*` is the `<server>_<tool>` name of the MCP tools.
    // - `codemode: false` exposes the server's tools natively. By default they sit behind the `execute` tool,
    //   which deny-all would remove along with them, and allowing it would add a JavaScript runtime with `fetch`.
    // Docs: opencode.ai/docs/permissions, /docs/mcp-servers and the V1 to V2 migration guide.
    const config = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        servers: {
          mouseketool: {
            type: 'local',
            command: [process.execPath, server],
            environment: serverEnv,
            codemode: false,
          },
        },
      },
      permissions: [
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'skill', resource: '*', effect: 'allow' },
        { action: 'mouseketool_*', resource: '*', effect: 'allow' },
      ],
    };
    writeFileSync(join(dir, 'opencode.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  } else {
    if (options.skill) cpSync(skill, join(dir, '.claude', 'skills', 'mouseketool'), { recursive: true });
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

export type RunLog = { triggered: boolean; searchedRepos: RepoName[]; inspectedRepos: RepoName[] };

/**
 * `triggered` is true when the server logged at least one line, failed calls included.
 * A line that does not parse still shows the server ran, so it counts as a call without repos.
 * `searchedRepos` comes from `search_repositories` lines only: those are the repos the server returned, so a
 * recommendation outside them came from the model's memory. `inspect_repository` logs the repo the model
 * asked for, which can be a remembered one, so it proves nothing about where the name came from.
 */
export function readRunLog(workspace: Workspace): RunLog {
  if (!existsSync(workspace.runLog)) return { triggered: false, searchedRepos: [], inspectedRepos: [] };
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
  return {
    triggered: lines.length > 0,
    searchedRepos: reposOf('search_repositories'),
    inspectedRepos: reposOf('inspect_repository'),
  };
}
