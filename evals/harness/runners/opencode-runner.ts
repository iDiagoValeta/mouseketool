import { homedir } from 'node:os';
import { join } from 'node:path';
import { MODELS } from '../plan-runs.ts';
import { baseEnv, execCapture, type Exec, type Runner } from './runner.ts';

type Event = { type?: string; error?: { type?: string; message?: string }; part?: { id?: string; messageID?: string; type?: string; text?: string } };

/**
 * The text parts of the last assistant message in the `--format json` event stream.
 * Throws when the stream holds an `error` event, e.g. `{"type":"error","error":{"type":"provider.no-route",...}}`.
 */
export function parseOpencodeOutput(stdout: string): string {
  const events: Event[] = [];
  for (const line of stdout.split('\n')) {
    try {
      events.push(JSON.parse(line) as Event);
    } catch {
      // opencode may print non-JSON lines around the events
    }
  }

  const failure = events.find((event) => event.type === 'error');
  if (failure) {
    throw new Error(`opencode reported an error: ${failure.error?.type ?? 'unknown'}: ${failure.error?.message ?? ''}`);
  }

  const finalMessage = events.findLast((event) => event.part?.messageID !== undefined)?.part?.messageID;
  // Keyed by part id: a part re-sent with more text replaces the earlier one.
  const parts = new Map<string, string>();
  for (const { type, part } of events) {
    if (type === 'text' && part !== undefined && part.messageID === finalMessage && part.id !== undefined) {
      parts.set(part.id, part.text ?? '');
    }
  }
  return [...parts.values()].join('');
}

export class OpencodeRunner implements Runner {
  constructor(
    private readonly exec: Exec = execCapture,
    private readonly dataHome: string = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(prompt: string, workspace: string): Promise<{ finalText: string }> {
    // `--standalone` avoids the author's background `opencode serve`, which has the global config loaded.
    const args = ['run', '--standalone', '--format', 'json', '-m', MODELS['opencode-deepseek-flash'], prompt];
    // No `--auto`: the workspace config denies every tool but the skill and the server's, so nothing is left to approve.
    // HOME and the XDG dirs are the empty workspace home, so no global skill or plugin loads.
    // The data dir stays real because the DeepSeek key lives in opencode's auth store there.
    const home = join(workspace, 'home');
    const env = {
      ...baseEnv(this.env),
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      XDG_DATA_HOME: this.dataHome,
    };
    const { stdout, stderr, code } = await this.exec('opencode', args, { cwd: workspace, env });
    const finalText = parseOpencodeOutput(stdout);
    // An exit 0 without a final answer is a failed run, not an empty verdict.
    if (finalText === '') {
      throw new Error(`opencode produced no final text (exit ${code}): ${stderr.slice(0, 300)}`);
    }
    return { finalText };
  }
}
