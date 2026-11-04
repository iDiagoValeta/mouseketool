import { homedir } from 'node:os';
import { join } from 'node:path';
import { baseEnv, execCapture, type Exec, type Runner } from './runner.ts';

export const MCP_TOOLS = [
  'mcp__mouseketool__search_repositories',
  'mcp__mouseketool__inspect_repository',
  'mcp__mouseketool__read_repository_file',
];

export function parseClaudeOutput(stdout: string): string {
  let output: { is_error?: boolean; subtype?: string; result?: unknown };
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(`claude did not print JSON: ${stdout.slice(0, 300)}`);
  }
  if (output.is_error === true) {
    throw new Error(`claude run failed: ${output.subtype ?? 'unknown error'}`);
  }
  return typeof output.result === 'string' ? output.result : '';
}

/**
 * One isolated `claude -p` run in `workspace`: the same flags and environment for the host runs and the judge.
 * Returns the result text; throws on a failed run.
 */
export async function runClaude(
  exec: Exec,
  env: NodeJS.ProcessEnv,
  options: { prompt: string; model: string; workspace: string; builtinTools: string; tools: string[] },
): Promise<string> {
  const { prompt, model, workspace, builtinTools, tools } = options;
  // `--setting-sources project` keeps the author's user hooks, skills and plugins out of the run.
  const args = [
    '-p', prompt,
    '--model', model,
    '--output-format', 'json',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    // Without it every run leaves a transcript in the author's ~/.claude/projects.
    '--no-session-persistence',
    '--mcp-config', join(workspace, 'mcp.json'),
    // `--tools` removes the built-in tools the run does not name; `--allowedTools` alone only pre-approves,
    // so Read, Glob and Grep would stay live in the workspace that holds the token. `""` means none.
    '--tools', builtinTools,
    '--allowedTools', tools.join(','),
  ];
  // The real HOME is the one extra variable: Claude's OAuth login lives there.
  const { stdout, stderr } = await exec('claude', args, {
    cwd: workspace,
    env: { ...baseEnv(env), HOME: env['HOME'] ?? homedir() },
  });
  try {
    return parseClaudeOutput(stdout);
  } catch (error) {
    throw new Error(`${(error as Error).message}${stderr ? ` (stderr: ${stderr.slice(0, 300)})` : ''}`, { cause: error });
  }
}

export class ClaudeRunner implements Runner {
  constructor(
    private readonly model: string,
    private readonly exec: Exec = execCapture,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(prompt: string, workspace: string): Promise<{ finalText: string }> {
    const tools = [...MCP_TOOLS, 'Skill'];
    return { finalText: await runClaude(this.exec, this.env, { prompt, model: this.model, workspace, builtinTools: 'Skill', tools }) };
  }
}
