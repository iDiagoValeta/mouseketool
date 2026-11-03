import type { Candidate } from '../domain/candidate.ts';
import { assessHealth } from '../domain/health.ts';
import type { ActivityFacts, HealthSignals } from '../domain/health.ts';
import { parseRepoName } from '../domain/repo-name.ts';
import type { RepositorySource } from './ports/repository-source.ts';
import type { RunLog } from './ports/run-log.ts';

const README_LIMIT = 12_000;
const ACTIVITY_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RepositoryReport {
  candidate: Candidate;
  health: HealthSignals;
  activity: ActivityFacts;
  readme: string | null;
  tree: string[];
}

export async function inspectRepository(
  deps: { source: RepositorySource; log: RunLog; now: () => Date },
  input: { repo: string },
): Promise<RepositoryReport> {
  const name = parseRepoName(input.repo);
  const now = deps.now();
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);

  const [candidate, activity, readme, tree] = await Promise.all([
    deps.source.repository(name),
    deps.source.activity(name, since),
    deps.source.readme(name),
    deps.source.topLevelTree(name),
  ]);

  await deps.log.record({ tool: 'inspect_repository', repos: [name] });

  return {
    candidate,
    health: assessHealth(candidate, activity, now),
    activity,
    readme: readme === null ? null : truncate(readme, README_LIMIT),
    tree,
  };
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}
