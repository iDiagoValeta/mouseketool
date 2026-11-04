import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Run } from '../../evals/harness/plan-runs.ts';
import { createWorkspace, readRunLog, removeWorkspace } from '../../evals/harness/workspace.ts';

const TOKEN = 'test-token-value';
let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mouseketool-workspace-test-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function run(host: Run['host']): Run {
  return { caseId: 'case-1', kind: 'positive-vague', prompt: 'p', host };
}

describe('createWorkspace', () => {
  it('lays out a Claude workspace with the skill and the MCP config', () => {
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    expect(ws.dir).toBe(join(base, 'case-1-positive-vague'));
    expect(existsSync(join(ws.dir, '.claude/skills/mouseketool/SKILL.md'))).toBe(true);
    const config = JSON.parse(readFileSync(join(ws.dir, 'mcp.json'), 'utf8'));
    expect(config.mcpServers.mouseketool.args).toEqual([join(process.cwd(), 'dist/server.mjs')]);
    expect(config.mcpServers.mouseketool.env).toEqual({ MOUSEKETOOL_RUN_LOG: ws.runLog, GITHUB_TOKEN: TOKEN });
    expect(ws.runLog).toBe(join(ws.dir, 'run.jsonl'));
  });

  it('leaves the skill out of a Claude workspace when asked, keeping the MCP config', () => {
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base, { skill: false });
    expect(existsSync(join(ws.dir, '.claude'))).toBe(false);
    const config = JSON.parse(readFileSync(join(ws.dir, 'mcp.json'), 'utf8'));
    expect(config.mcpServers.mouseketool.env).toEqual({ MOUSEKETOOL_RUN_LOG: ws.runLog, GITHUB_TOKEN: TOKEN });
  });

  it('lays out an opencode workspace with the skill, an empty home and the MCP config', () => {
    const ws = createWorkspace(run('opencode-deepseek-flash'), process.cwd(), TOKEN, base);
    expect(existsSync(join(ws.dir, '.opencode/skills/mouseketool/SKILL.md'))).toBe(true);
    expect(existsSync(join(ws.dir, 'home'))).toBe(true);
    const config = JSON.parse(readFileSync(join(ws.dir, 'opencode.json'), 'utf8'));
    expect(config.mcp.servers.mouseketool.type).toBe('local');
    expect(config.mcp.servers.mouseketool.command[1]).toBe(join(process.cwd(), 'dist/server.mjs'));
    expect(config.mcp.servers.mouseketool.environment).toEqual({ MOUSEKETOOL_RUN_LOG: ws.runLog, GITHUB_TOKEN: TOKEN });
  });

  it('denies every opencode tool except the skill and the mouseketool tools, and drops Code Mode', () => {
    const ws = createWorkspace(run('opencode-deepseek-flash'), process.cwd(), TOKEN, base);
    const config = JSON.parse(readFileSync(join(ws.dir, 'opencode.json'), 'utf8'));
    // Last match wins: the deny-all rule comes first and the two allows after it.
    expect(config.permissions).toEqual([
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'skill', resource: '*', effect: 'allow' },
      { action: 'mouseketool_*', resource: '*', effect: 'allow' },
    ]);
    // Without it the server's tools sit behind the `execute` tool, which the deny-all rule would also remove.
    expect(config.mcp.servers.mouseketool.codemode).toBe(false);
  });

  it('replaces a workspace left behind by an earlier run', () => {
    const first = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    const stale = join(first.dir, 'stale.txt');
    writeFileSync(stale, 'left behind');
    const second = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    expect(existsSync(stale)).toBe(false);
    expect(second.dir).toBe(first.dir);
  });

  it.each(['claude-sonnet', 'opencode-deepseek-flash'] as const)(
    'is readable only by its owner on %s, since the MCP config holds the token',
    (host) => {
      const ws = createWorkspace(run(host), process.cwd(), TOKEN, base);
      const mode = (path: string) => statSync(path).mode & 0o777;
      expect(mode(ws.dir)).toBe(0o700);
      expect(mode(join(ws.dir, host === 'claude-sonnet' ? 'mcp.json' : 'opencode.json'))).toBe(0o600);
    },
  );

  it('is removed by removeWorkspace', () => {
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    removeWorkspace(ws);
    expect(existsSync(ws.dir)).toBe(false);
  });
});

describe('readRunLog', () => {
  it('has no calls when the server never ran', () => {
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    expect(readRunLog(ws)).toEqual({ triggered: false, logRepos: [] });
  });

  it('skips a line that does not parse but still counts the run as triggered', () => {
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    writeFileSync(ws.runLog, '{"tool":"search_repositories","repos":["a/b"]}\n{"tool":"inspect_rep\n');
    expect(readRunLog(ws)).toEqual({ triggered: true, logRepos: ['a/b'] });
  });

  it('collects repos across calls, including a failed call without repos', () => {
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), TOKEN, base);
    writeFileSync(
      ws.runLog,
      [
        '{"tool":"search_repositories","repos":["a/b","c/d"]}',
        '{"tool":"inspect_repository","repos":[]}',
        '{"tool":"read_repository_file","repos":["a/b"]}',
        '',
      ].join('\n'),
    );
    expect(readRunLog(ws)).toEqual({ triggered: true, logRepos: ['a/b', 'c/d'] });
  });
});
