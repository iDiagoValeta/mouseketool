import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoName } from '../../src/domain/repo-name.ts';
import type { Run } from './plan-runs.ts';

export type Workspace = { dir: string; runLog: string };

export const WORKSPACE_ROOT = join(tmpdir(), 'mouseketool-eval');

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
    const config = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        mouseketool: {
          type: 'local',
          command: [process.execPath, server],
          environment: serverEnv,
        },
      },
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
}

/**
 * `triggered` is true when the server logged at least one line, failed calls included.
 * A line that does not parse still shows the server ran, so it counts as a call without repos.
 */
export function readRunLog(workspace: Workspace): { triggered: boolean; logRepos: RepoName[] } {
  if (!existsSync(workspace.runLog)) return { triggered: false, logRepos: [] };
  const lines = readFileSync(workspace.runLog, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const repos = lines.flatMap((line): RepoName[] => {
    try {
      const entry = JSON.parse(line) as { repos?: unknown };
      return Array.isArray(entry.repos) ? entry.repos.filter((r): r is RepoName => typeof r === 'string') : [];
    } catch {
      return [];
    }
  });
  return { triggered: lines.length > 0, logRepos: [...new Set(repos)] };
}
