import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRepoName, type RepoName } from '../../src/domain/repo-name.ts';
import { CachedJudge, ClaudeJudge, judgePrompt, parseJudgment, type Judge, type Judgment } from '../../evals/harness/judge.ts';
import type { Exec } from '../../evals/harness/runners/runner.ts';

const repo = parseRepoName('foo/bar');
const mustHaves = ['Detects duplicated keys', 'Exits non-zero on problems'];
const TOKEN = 'test-token-value'; // pragma: allowlist secret

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mouseketool-judge-test-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const claudeResult = (result: string) => JSON.stringify({ is_error: false, subtype: 'success', result });

describe('parseJudgment', () => {
  it('reads the JSON line that ends the answer', () => {
    const text = 'The README covers both.\n{"meets": true, "missing": []}';
    expect(parseJudgment(text, repo)).toEqual({ repo, meets: true, missing: [] });
  });

  it('lists what is missing', () => {
    const text = 'No exit code.\n{"meets": false, "missing": ["Exits non-zero on problems"]}';
    expect(parseJudgment(text, repo)).toEqual({ repo, meets: false, missing: ['Exits non-zero on problems'] });
  });

  it('takes the last line that parses, not an earlier example', () => {
    const text = '{"meets": true, "missing": []}\nOn reflection the code disagrees.\n{"meets": false, "missing": ["a"]}\n';
    expect(parseJudgment(text, repo).meets).toBe(false);
  });

  it('skips trailing lines that are not a verdict object', () => {
    const text = '{"meets": true, "missing": []}\n{"other": 1}\n[1]\nnot json';
    expect(parseJudgment(text, repo).meets).toBe(true);
  });

  it('treats meets true with a missing requirement as a contradiction, so it does not meet', () => {
    const text = '{"meets": true, "missing": ["Detects duplicated keys"]}';
    expect(parseJudgment(text, repo)).toEqual({ repo, meets: false, missing: ['Detects duplicated keys'] });
  });

  it('throws when no line is a verdict', () => {
    expect(() => parseJudgment('It looks good to me.', repo)).toThrow('verdict');
    expect(() => parseJudgment('{"meets": "yes"}', repo)).toThrow('verdict');
    expect(() => parseJudgment('', repo)).toThrow('verdict');
  });
});

describe('ClaudeJudge', () => {
  // `log` is what the server would have written to the run log while the judge worked.
  function recording(
    stdout: string,
    log: string[] = ['{"tool":"inspect_repository","repos":["foo/bar"]}'],
  ): { exec: Exec; calls: Parameters<Exec>[]; seen: { skill: boolean; mcp: boolean }[] } {
    const calls: Parameters<Exec>[] = [];
    const seen: { skill: boolean; mcp: boolean }[] = [];
    const exec: Exec = async (...args) => {
      calls.push(args);
      // The workspace is removed after the call, so what it holds is read while the call runs.
      seen.push({ skill: existsSync(join(args[2].cwd, '.claude')), mcp: existsSync(join(args[2].cwd, 'mcp.json')) });
      if (log.length > 0) writeFileSync(join(args[2].cwd, 'run.jsonl'), `${log.join('\n')}\n`);
      return { stdout, stderr: '', code: 0 };
    };
    return { exec, calls, seen };
  }
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/author', GITHUB_TOKEN: 'ghp-secret', CLAUDECODE: '1' }; // pragma: allowlist secret
  const make = (exec: Exec) => new ClaudeJudge(process.cwd(), TOKEN, exec, env, base);

  it('runs Sonnet with the runner isolation flags and only the three server tools', async () => {
    const { exec, calls } = recording(claudeResult('ok\n{"meets": true, "missing": []}'));
    const judgment = await make(exec).judge(repo, mustHaves);

    expect(judgment).toEqual({ repo, meets: true, missing: [] });
    const [file, args, options] = calls[0]!;
    expect(file).toBe('claude');
    expect(args).toEqual([
      '-p', judgePrompt(repo, mustHaves),
      '--model', 'claude-sonnet-5-5',
      '--output-format', 'json',
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--mcp-config', join(options.cwd, 'mcp.json'),
      // An empty list: no built-in tool at all, so the judge cannot read the workspace.
      '--tools', '',
      '--allowedTools',
      'mcp__mouseketool__search_repositories,mcp__mouseketool__inspect_repository,mcp__mouseketool__read_repository_file',
    ]);
    expect(options.env).toEqual({ PATH: '/usr/bin', HOME: '/home/author' });
  });

  it('works in a workspace with the MCP config and without the skill, and removes it afterwards', async () => {
    const { exec, calls, seen } = recording(claudeResult('{"meets": true, "missing": []}'));
    await make(exec).judge(repo, mustHaves);
    expect(seen[0]).toEqual({ skill: false, mcp: true });
    expect(existsSync(calls[0]![2].cwd)).toBe(false);
  });

  it('asks for the repository, every requirement and the closing JSON line', async () => {
    const { exec, calls } = recording(claudeResult('{"meets": true, "missing": []}'));
    await make(exec).judge(repo, mustHaves);
    const prompt = calls[0]![1][1]!;
    expect(calls[0]![1][0]).toBe('-p');
    expect(prompt).toContain('foo/bar');
    for (const item of mustHaves) expect(prompt).toContain(`- ${item}`);
    expect(prompt).toContain('inspect_repository');
    expect(prompt).toContain('read_repository_file');
    expect(prompt).toContain('archived');
    expect(prompt).toContain('"meets"');
    expect(prompt).toContain('"missing"');
  });

  it('throws when the answer has no verdict line, and still removes the workspace', async () => {
    const { exec, calls } = recording(claudeResult('Looks fine.'));
    await expect(make(exec).judge(repo, mustHaves)).rejects.toThrow('verdict');
    expect(existsSync(calls[0]![2].cwd)).toBe(false);
  });

  it.each([
    ['never called the server', []],
    ['only searched', ['{"tool":"search_repositories","repos":["foo/bar"]}']],
    ['inspected another repo', ['{"tool":"inspect_repository","repos":["other/repo"]}']],
    ['had its inspect call fail', ['{"tool":"inspect_repository","repos":[]}']],
  ])('throws, so nothing is cached, when the judge %s', async (_name, log) => {
    const { exec, calls } = recording(claudeResult('From memory, it does both.\n{"meets": true, "missing": []}'), log);
    await expect(make(exec).judge(repo, mustHaves)).rejects.toThrow('did not inspect foo/bar');
    expect(existsSync(calls[0]![2].cwd)).toBe(false);
  });

  it('throws when the run ended in an error', async () => {
    const { exec } = recording(JSON.stringify({ is_error: true, subtype: 'error_max_turns' }));
    await expect(make(exec).judge(repo, mustHaves)).rejects.toThrow('error_max_turns');
  });

  it('throws when claude cannot be started', async () => {
    const exec: Exec = async () => {
      throw new Error('spawn claude ENOENT');
    };
    await expect(make(exec).judge(repo, mustHaves)).rejects.toThrow('ENOENT');
  });
});

describe('CachedJudge', () => {
  const file = () => join(base, 'nested', 'judgments.json');

  function counting(result: (repo: RepoName) => Judgment | Error): { judge: Judge; calls: [RepoName, string[]][] } {
    const calls: [RepoName, string[]][] = [];
    const judge: Judge = {
      async judge(r, items) {
        calls.push([r, items]);
        const out = result(r);
        if (out instanceof Error) throw out;
        return out;
      },
    };
    return { judge, calls };
  }
  const meets = (r: RepoName): Judgment => ({ repo: r, meets: true, missing: [] });

  it('calls the inner judge on a miss and stores the judgment keyed by repo and requirements', async () => {
    const { judge, calls } = counting(meets);
    const cached = new CachedJudge(judge, file());
    expect(await cached.judge(repo, mustHaves)).toEqual({ repo, meets: true, missing: [] });
    expect(calls).toHaveLength(1);
    const stored = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Judgment>;
    expect(Object.keys(stored)).toEqual([`foo/bar\n${mustHaves.join('\n')}`]);
  });

  it('answers a repeat from the file without calling the inner judge, even in a new instance', async () => {
    const first = counting(meets);
    await new CachedJudge(first.judge, file()).judge(repo, mustHaves);
    const second = counting(() => new Error('must not be called'));
    expect(await new CachedJudge(second.judge, file()).judge(repo, mustHaves)).toEqual({ repo, meets: true, missing: [] });
    expect(second.calls).toHaveLength(0);
  });

  it('keeps different repos and different requirement lists apart', async () => {
    const { judge, calls } = counting(meets);
    const cached = new CachedJudge(judge, file());
    await cached.judge(repo, mustHaves);
    await cached.judge(parseRepoName('foo/baz'), mustHaves);
    await cached.judge(repo, [mustHaves[0]!]);
    expect(calls).toHaveLength(3);
  });

  it('does not cache an error', async () => {
    let fail = true;
    const { judge, calls } = counting((r) => (fail ? new Error('no verdict') : meets(r)));
    const cached = new CachedJudge(judge, file());
    await expect(cached.judge(repo, mustHaves)).rejects.toThrow('no verdict');
    expect(existsSync(file())).toBe(false);
    fail = false;
    expect((await cached.judge(repo, mustHaves)).meets).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each(['null', '[]', '"text"', '3'])('rejects at construction a cache file holding %s, which is not an object', (content) => {
    const bad = join(base, 'bad.json');
    writeFileSync(bad, content);
    expect(() => new CachedJudge(counting(meets).judge, bad)).toThrow('bad.json');
  });

  it('fails fast at construction on a cache file that does not parse, leaving it untouched', () => {
    const broken = join(base, 'broken.json');
    writeFileSync(broken, '{broken');
    const { judge, calls } = counting(meets);
    expect(() => new CachedJudge(judge, broken)).toThrow('broken.json');
    expect(calls).toHaveLength(0);
    expect(readFileSync(broken, 'utf8')).toBe('{broken');
  });
});
