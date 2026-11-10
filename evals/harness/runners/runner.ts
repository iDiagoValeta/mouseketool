import { execFile, type ChildProcess } from 'node:child_process';

export interface Runner {
  run(prompt: string, workspace: string): Promise<{ finalText: string }>;
}

const PASSED_THROUGH = new Set(['PATH', 'TERM', 'LANG', 'TMPDIR']);

/**
 * The only variables a host process inherits. Anything else in the author's environment
 * (cloud keys, GITHUB_TOKEN, the parent Claude Code session) must not reach a model-driven process.
 */
export function baseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && (PASSED_THROUGH.has(key) || key.startsWith('LC_'))) kept[key] = value;
  }
  return kept;
}

export const RUN_TIMEOUT_MS = 15 * 60 * 1000;

export type Exec = (
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; code: number }>;

// Host and judge processes still running: they spend paid model time, so an interrupt must stop them.
const live = new Set<ChildProcess>();

/** Stops every host or judge process still running. Their MCP servers exit when their stdin closes. */
export function killLiveProcesses(): void {
  for (const child of live) child.kill('SIGTERM');
  live.clear();
}

/**
 * Resolves with the exit code, so a host that fails after printing something is still parsed.
 * Rejects on a timeout or when the process cannot be started.
 */
export const execCapture: Exec = (file, args, { cwd, env }) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd, env, timeout: RUN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        live.delete(child);
        if (!error) return resolve({ stdout, stderr, code: 0 });
        if (error.killed || typeof error.code !== 'number') return reject(error);
        resolve({ stdout, stderr, code: error.code });
      },
    );
    live.add(child);
    // Hosts wait a few seconds for piped stdin before starting; nothing will come.
    child.stdin?.end();
  });
