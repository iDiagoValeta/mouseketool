import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClaudeRunner, parseClaudeOutput } from '../../evals/harness/runners/claude-runner.ts';
import { OpencodeRunner, parseOpencodeOutput } from '../../evals/harness/runners/opencode-runner.ts';
import type { Exec } from '../../evals/harness/runners/runner.ts';

const claudeFixture = readFileSync('test/evals/fixtures/claude-output.json', 'utf8');
const opencodeFixture = readFileSync('test/evals/fixtures/opencode-output.jsonl', 'utf8');

function text(messageID: string, partId: string, value: string): string {
  return JSON.stringify({ type: 'text', part: { id: partId, messageID, type: 'text', text: value } });
}

function step(messageID: string, type: 'step_start' | 'step_finish'): string {
  return JSON.stringify({ type, part: { messageID, type: type === 'step_start' ? 'step-start' : 'step-finish' } });
}

describe('parseClaudeOutput', () => {
  it('returns the result field of the captured output', () => {
    const finalText = parseClaudeOutput(claudeFixture);
    expect(finalText).toBe((JSON.parse(claudeFixture) as { result: string }).result);
    expect(finalText).toContain('mouseketool');
  });

  it('throws when the run ended in an error', () => {
    const failed = JSON.stringify({ is_error: true, subtype: 'error_max_turns' });
    expect(() => parseClaudeOutput(failed)).toThrow('error_max_turns');
  });

  it('throws on output that is not JSON', () => {
    expect(() => parseClaudeOutput('Not logged in')).toThrow();
  });
});

describe('parseOpencodeOutput', () => {
  it('returns the text of the final message of the captured stream', () => {
    expect(parseOpencodeOutput(opencodeFixture)).toBe('punkpeye/awesome-mcp-servers');
  });

  it('concatenates the text parts of the final message only', () => {
    const stream = [
      step('m1', 'step_start'),
      text('m1', 'p1', 'Let me search.'),
      step('m2', 'step_start'),
      text('m2', 'p2', 'Verdict: build\n'),
      text('m2', 'p3', 'Nothing fits.'),
      step('m2', 'step_finish'),
    ].join('\n');
    expect(parseOpencodeOutput(stream)).toBe('Verdict: build\nNothing fits.');
  });

  it('keeps the last version of a text part that is emitted twice', () => {
    const stream = [text('m1', 'p1', 'Verd'), text('m1', 'p1', 'Verdict: build')].join('\n');
    expect(parseOpencodeOutput(stream)).toBe('Verdict: build');
  });

  it('returns an empty text when the final message has none', () => {
    const stream = [text('m1', 'p1', 'Let me search.'), step('m2', 'step_start')].join('\n');
    expect(parseOpencodeOutput(stream)).toBe('');
  });

  it('ignores lines that are not JSON', () => {
    expect(parseOpencodeOutput(`warning\n${text('m1', 'p1', 'ok')}\n`)).toBe('ok');
  });
});

describe('ClaudeRunner', () => {
  it('runs claude in the workspace with project-only settings and the strict MCP config', async () => {
    const calls: Parameters<Exec>[] = [];
    const exec: Exec = async (...args) => {
      calls.push(args);
      return { stdout: claudeFixture, stderr: '', code: 0 };
    };

    const result = await new ClaudeRunner('claude-haiku-5-5', exec).run('an idea', '/ws');

    expect(result.finalText).toBe(parseClaudeOutput(claudeFixture));
    const [file, args, options] = calls[0]!;
    expect(file).toBe('claude');
    expect(args.slice(0, 2)).toEqual(['-p', 'an idea']);
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-5-5');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('project');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/ws/mcp.json');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(
      'mcp__mouseketool__search_repositories,mcp__mouseketool__inspect_repository,mcp__mouseketool__read_repository_file,Skill',
    );
    expect(options.cwd).toBe('/ws');
  });
});

describe('OpencodeRunner', () => {
  it('runs opencode standalone with an empty home and the real data dir', async () => {
    const calls: Parameters<Exec>[] = [];
    const exec: Exec = async (...args) => {
      calls.push(args);
      return { stdout: opencodeFixture, stderr: '', code: 0 };
    };

    const result = await new OpencodeRunner(exec, '/real/data').run('an idea', '/ws');

    expect(result.finalText).toBe('punkpeye/awesome-mcp-servers');
    const [file, args, options] = calls[0]!;
    expect(file).toBe('opencode');
    expect(args).toEqual([
      'run', '--standalone', '--format', 'json', '-m', 'deepseek/deepseek-flash', '--auto', 'an idea',
    ]);
    expect(options.cwd).toBe('/ws');
    expect(options.env['HOME']).toBe('/ws/home');
    expect(options.env['XDG_CONFIG_HOME']).toBe('/ws/home/.config');
    expect(options.env['XDG_DATA_HOME']).toBe('/real/data');
  });

  it('throws when opencode fails without producing text', async () => {
    const exec: Exec = async () => ({ stdout: '', stderr: 'boom', code: 1 });
    await expect(new OpencodeRunner(exec, '/real/data').run('x', '/ws')).rejects.toThrow('boom');
  });
});
