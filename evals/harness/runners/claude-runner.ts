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
  options: { prompt: string; model: string; workspace: string; cwd: string; builtinTools: string; tools: string[] },
): Promise<string> {
  const { prompt, model, workspace, cwd, builtinTools, tools } = options;
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
    // `dontAsk` denies every tool use that `--allowedTools` does not pre-approve, so nothing waits on a prompt.
    '--permission-mode', 'dontAsk',
    // `--tools` removes the built-in tools the run does not name: no Bash, no web. `""` means none.
    '--tools', builtinTools,
    '--allowedTools', tools.join(','),
  ];
  // The real HOME is the one extra variable: Claude's OAuth login lives there.
  const { stdout, stderr } = await exec('claude', args, {
    cwd,
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
    // A real session has file tools, and without them the host answers a small task by misusing the server's
    // tools on local paths. They are scoped to work/, which `createWorkspace` keeps free of the token, and
    // read-only: write access to work/.claude would let the host plant a skill with hooks that run as the author.
    const fileTools = ['Read', 'Glob', 'Grep'];
    return {
      finalText: await runClaude(this.exec, this.env, {
        prompt,
        model: this.model,
        workspace,
        cwd: join(workspace, 'work'),
        builtinTools: ['Skill', ...fileTools].join(','),
        tools: [...tools, ...fileTools.map((tool) => `${tool}(./**)`)],
      }),
    };
  }
}
