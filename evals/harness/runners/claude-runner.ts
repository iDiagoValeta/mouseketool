import { homedir } from 'node:os';
import { join } from 'node:path';
import { baseEnv, execCapture, type Exec, type Runner } from './runner.ts';

const ALLOWED_TOOLS = [
  'mcp__mouseketool__search_repositories',
  'mcp__mouseketool__inspect_repository',
  'mcp__mouseketool__read_repository_file',
  'Skill',
].join(',');

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

export class ClaudeRunner implements Runner {
  constructor(
    private readonly model: string,
    private readonly exec: Exec = execCapture,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(prompt: string, workspace: string): Promise<{ finalText: string }> {
    // `--setting-sources project` keeps the author's user hooks, skills and plugins out of the run.
    const args = [
      '-p', prompt,
      '--model', this.model,
      '--output-format', 'json',
      '--setting-sources', 'project',
      '--strict-mcp-config',
      // Without it every run leaves a transcript in the author's ~/.claude/projects.
      '--no-session-persistence',
      '--mcp-config', join(workspace, 'mcp.json'),
      '--allowedTools', ALLOWED_TOOLS,
    ];
    // The real HOME is the one extra variable: Claude's OAuth login lives there.
    const env = { ...baseEnv(this.env), HOME: this.env['HOME'] ?? homedir() };
    const { stdout, stderr } = await this.exec('claude', args, { cwd: workspace, env });
    try {
      return { finalText: parseClaudeOutput(stdout) };
    } catch (error) {
      throw new Error(`${(error as Error).message}${stderr ? ` (stderr: ${stderr.slice(0, 300)})` : ''}`, { cause: error });
    }
  }
}
