import type { Candidate } from './candidate.ts';

export interface ActivityFacts {
  commitsLast90Days: number;
  issuesClosedLast90Days: number;
  openIssues: number;
  contributors: number;
  latestRelease: { tag: string; publishedAt: string } | null;
}

export type LicenseKind = 'permissive' | 'copyleft' | 'none' | 'other';

export interface HealthSignals {
  archived: boolean;
  monthsSinceLastPush: number;
  stale: boolean;
  licenseKind: LicenseKind;
  maintenance: 'active' | 'slow' | 'inactive';
}

// These thresholds are a judgement call, not a standard. Eighteen months without a push
// is where a project usually needs a fork before it can be relied on. Five commits in
// 90 days is roughly one a fortnight, enough to show someone is still working on it.
const STALE_AFTER_MONTHS = 18;
const ACTIVE_MIN_COMMITS = 5;
const SLOW_MIN_COMMITS = 1;

// SPDX ids are case-sensitive, so these are matched exactly.
const PERMISSIVE_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'Zlib',
]);
const COPYLEFT_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'MPL-2.0',
  'EPL-2.0',
]);
// A copyleft id also comes as `-only` or `-or-later`, which pins or opens the version.
const VERSION_SUFFIX = /-(only|or-later)$/;

/**
 * Derives the health signals of a candidate from its record and its recent activity.
 * `now` is injected so the result is deterministic.
 */
export function assessHealth(
  candidate: Candidate,
  activity: ActivityFacts,
  now: Date,
): HealthSignals {
  const monthsSinceLastPush = wholeMonthsBetween(new Date(candidate.pushedAt), now);

  return {
    archived: candidate.archived,
    monthsSinceLastPush,
    stale: monthsSinceLastPush > STALE_AFTER_MONTHS,
    licenseKind: classifyLicense(candidate.license),
    maintenance: classifyMaintenance(activity.commitsLast90Days),
  };
}

/**
 * Whole calendar months from `from` to `to`, floored. A month counts only once its day and
 * time have passed.
 */
function wholeMonthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());

  if (addUtcMonths(from, months) > to) {
    months -= 1;
  }

  return Math.max(0, months);
}

/**
 * Adds whole months in UTC. A day that does not exist in the target month clamps to that
 * month's last day, so 31 January plus one month is 28 February.
 */
function addUtcMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function classifyLicense(license: string | null): LicenseKind {
  if (license === null) {
    return 'none';
  }
  if (PERMISSIVE_LICENSES.has(license)) {
    return 'permissive';
  }
  if (COPYLEFT_LICENSES.has(license.replace(VERSION_SUFFIX, ''))) {
    return 'copyleft';
  }
  return 'other';
}

function classifyMaintenance(commitsLast90Days: number): HealthSignals['maintenance'] {
  if (commitsLast90Days >= ACTIVE_MIN_COMMITS) {
    return 'active';
  }
  if (commitsLast90Days >= SLOW_MIN_COMMITS) {
    return 'slow';
  }
  return 'inactive';
}
