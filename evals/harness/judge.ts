import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { RepoName } from '../../src/domain/repo-name.ts';
import { MCP_TOOLS, runClaude } from './runners/claude-runner.ts';
import { execCapture, type Exec } from './runners/runner.ts';
import { createWorkspace, readRunLog, removeWorkspace, WORKSPACE_ROOT } from './workspace.ts';

export type Judgment = { repo: RepoName; meets: boolean; missing: string[] };

export interface Judge {
  judge(repo: RepoName, mustHaves: string[]): Promise<Judgment>;
}

export const JUDGE_MODEL = 'claude-sonnet-5-5';

/** Strict on purpose: a "could be built on top" answer would let any big framework meet any requirement. */
export function judgePrompt(repo: RepoName, mustHaves: string[]): string {
  return [
    `Decide whether the GitHub project ${repo} meets every one of these requirements:`,
    ...mustHaves.map((item) => `- ${item}`),
    '',
    `Call inspect_repository on ${repo}. Confirm each requirement in the README and, for anything the verdict depends on, in the code with read_repository_file.`,
    'A requirement is met only if the project does it today, out of the box or with configuration. "It could be built on top of this project" does not count.',
    'An archived repository meets nothing.',
    '',
    'End your answer with one line of JSON and nothing after it: {"meets": true|false, "missing": ["<requirement text>", ...]}',
    'List in "missing" every requirement that is not met, with its exact text; it is empty only when "meets" is true.',
  ].join('\n');
}

/**
 * Reads the last line of the answer that is a JSON object with a boolean `meets`.
 * `meets: true` with something missing contradicts itself, so it does not meet.
 */
export function parseJudgment(text: string, repo: RepoName): Judgment {
  for (const line of text.split('\n').reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.trim());
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const { meets, missing } = parsed as { meets?: unknown; missing?: unknown };
    if (typeof meets !== 'boolean') continue;
    const gaps = Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string') : [];
    return { repo, meets: meets && gaps.length === 0, missing: gaps };
  }
  throw new Error(`The judge answered without a verdict line: ${text.slice(-300)}`);
}

export class ClaudeJudge implements Judge {
  constructor(
    private readonly repoRoot: string,
    private readonly githubToken: string,
    private readonly exec: Exec = execCapture,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly base: string = WORKSPACE_ROOT,
  ) {}

  async judge(repo: RepoName, mustHaves: string[]): Promise<Judgment> {
    // The judge reads repositories through the MCP server but never gets the skill, so it cannot start a search of its own.
    // `kind` only names the directory here.
    const run = { caseId: `judge-${randomUUID()}`, kind: 'positive-defined' as const, prompt: '', host: 'claude-sonnet' as const };
    const workspace = createWorkspace(run, this.repoRoot, this.githubToken, this.base, { skill: false });
    try {
      const text = await runClaude(this.exec, this.env, {
        prompt: judgePrompt(repo, mustHaves),
        model: JUDGE_MODEL,
        workspace: workspace.dir,
        cwd: workspace.dir,
        builtinTools: '',
        tools: MCP_TOOLS,
      });
      // A verdict given without reading the repo comes from memory, or from a call that failed, and would be cached.
      if (!readRunLog(workspace).inspectedRepos.includes(repo)) {
        throw new Error(`The judge did not inspect ${repo}, so its verdict is not grounded`);
      }
      return parseJudgment(text, repo);
    } finally {
      removeWorkspace(workspace);
    }
  }
}

/**
 * Remembers judgments in a JSON file so a repeated calibration or pass does not pay for the same verdict twice.
 * Errors are not stored. The key is the repo and the requirements only: it ignores the judge prompt and model,
 * so `judgments.json` must be deleted after changing either, or the old verdicts keep answering.
 * The file is read once, at construction, so a corrupt one stops the run before any judge call.
 */
export class CachedJudge implements Judge {
  private readonly stored: Record<string, Judgment>;

  constructor(
    private readonly inner: Judge,
    private readonly file: string,
  ) {
    this.stored = CachedJudge.load(file);
  }

  async judge(repo: RepoName, mustHaves: string[]): Promise<Judgment> {
    const key = `${repo}\n${mustHaves.join('\n')}`;
    const hit = this.stored[key];
    if (hit !== undefined) return hit;
    const judgment = await this.inner.judge(repo, mustHaves);
    this.stored[key] = judgment;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.stored, null, 2));
    return judgment;
  }

  /** A missing file is an empty cache; one that is not a JSON object throws, so it is never overwritten with less. */
  private static load(file: string): Record<string, Judgment> {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`The judgment cache ${file} is not valid JSON; fix or delete it`, { cause: error });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`The judgment cache ${file} is not a JSON object; fix or delete it`);
    }
    return parsed as Record<string, Judgment>;
  }
}
