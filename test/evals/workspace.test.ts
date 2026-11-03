import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Run } from '../../evals/harness/plan-runs.ts';
import { createWorkspace, readRunLog, removeWorkspace } from '../../evals/harness/workspace.ts';

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
    const ws = createWorkspace(run('claude-sonnet'), process.cwd(), base);
    expect(ws.dir).toBe(join(base, 'case-1-positive-vague'));
    expect(existsSync(join(ws.dir, '.claude/skills/mouseketool/SKILL.md'))).toBe(true);
    const config = JSON.parse(readFileSync(join(ws.dir, 'mcp.json'), 'utf8'));
    expect(config.mcpServers.mouseketool.args).toEqual([join(process.cwd(), 'dist/server.mjs')]);
    expect(config.mcpServers.mouseketool.env.MOUSEKETOOL_RUN_LOG).toBe(ws.runLog);
    expect(ws.runLog).toBe(join(ws.dir, 'run.jsonl'));
  });

  it('lays out an opencode workspace with the skill, an empty home and the MCP config', () => {
    const ws = createWorkspace(run('opencode-deepseek-flash'), process.cwd(), base);
    expect(existsSync(join(ws.dir, '.opencode/skills/mouseketool/SKILL.md'))).toBe(true);
    expect(existsSync(join(ws.dir, 'home'))).toBe(true);
    const config = JSON.parse(readFileSync(join(ws.dir, 'opencode.json'), 'utf8'));
    expect(config.mcp.mouseketool.type).toBe('local');
    expect(config.mcp.mouseketool.command[1]).toBe(join(process.cwd(), 'dist/server.mjs'));
    expect(config.mcp.mouseketool.environment.MOUSEKETOOL_RUN_LOG).toBe(ws.runLog);
  });

  it('replaces a workspace left behind by an earlier run', () => {
    const first = createWorkspace(run('claude-haiku'), process.cwd(), base);
    const stale = join(first.dir, 'stale.txt');
    writeFileSync(stale, 'left behind');
    const second = createWorkspace(run('claude-haiku'), process.cwd(), base);
    expect(existsSync(stale)).toBe(false);
    expect(second.dir).toBe(first.dir);
  });

  it('is removed by removeWorkspace', () => {
    const ws = createWorkspace(run('claude-haiku'), process.cwd(), base);
    removeWorkspace(ws);
    expect(existsSync(ws.dir)).toBe(false);
  });
});

describe('readRunLog', () => {
  it('has no calls when the server never ran', () => {
    const ws = createWorkspace(run('claude-haiku'), process.cwd(), base);
    expect(readRunLog(ws)).toEqual({ triggered: false, logRepos: [] });
  });

  it('collects repos across calls, including a failed call without repos', () => {
    const ws = createWorkspace(run('claude-haiku'), process.cwd(), base);
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
