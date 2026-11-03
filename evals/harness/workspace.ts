import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoName } from '../../src/domain/repo-name.ts';
import type { Run } from './plan-runs.ts';

export type Workspace = { dir: string; runLog: string };

export const WORKSPACE_ROOT = join(tmpdir(), 'mouseketool-eval');

/**
 * A fresh directory holding the skill and the host's MCP config, and nothing else:
 * the host must find the mouseketool skill and the server, not the author's own setup.
 * `node` is `process.execPath` so the server does not depend on the PATH the host hands to its children.
 */
export function createWorkspace(run: Run, repoRoot: string, base: string = WORKSPACE_ROOT): Workspace {
  const dir = join(base, `${run.caseId}-${run.kind}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const runLog = join(dir, 'run.jsonl');
  const server = join(repoRoot, 'dist', 'server.mjs');
  const skill = join(repoRoot, 'skills', 'mouseketool');

  if (run.host === 'opencode-deepseek-flash') {
    cpSync(skill, join(dir, '.opencode', 'skills', 'mouseketool'), { recursive: true });
    // HOME points here so the global skill directories of the author are not read.
    mkdirSync(join(dir, 'home'));
    const config = {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        mouseketool: {
          type: 'local',
          command: [process.execPath, server],
          environment: { MOUSEKETOOL_RUN_LOG: runLog },
        },
      },
    };
    writeFileSync(join(dir, 'opencode.json'), JSON.stringify(config, null, 2));
  } else {
    cpSync(skill, join(dir, '.claude', 'skills', 'mouseketool'), { recursive: true });
    const config = {
      mcpServers: {
        mouseketool: { command: process.execPath, args: [server], env: { MOUSEKETOOL_RUN_LOG: runLog } },
      },
    };
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify(config, null, 2));
  }

  return { dir, runLog };
}

export function removeWorkspace(workspace: Workspace): void {
  rmSync(workspace.dir, { recursive: true, force: true });
}

/** `triggered` is true when the server logged at least one call, failed calls included. */
export function readRunLog(workspace: Workspace): { triggered: boolean; logRepos: RepoName[] } {
  if (!existsSync(workspace.runLog)) return { triggered: false, logRepos: [] };
  const lines = readFileSync(workspace.runLog, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const repos = lines.flatMap((line) => (JSON.parse(line) as { repos: RepoName[] }).repos);
  return { triggered: lines.length > 0, logRepos: [...new Set(repos)] };
}
