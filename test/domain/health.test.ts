import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../src/domain/candidate.ts';
import type { ActivityFacts } from '../../src/domain/health.ts';
import { assessHealth } from '../../src/domain/health.ts';

const NOW = new Date('2026-07-15T12:00:00Z');

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    name: 'foo/bar',
    url: 'https://github.com/foo/bar',
    description: null,
    stars: 0,
    pushedAt: '2026-07-01T00:00:00Z',
    license: 'MIT',
    topics: [],
    archived: false,
    language: null,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityFacts> = {}): ActivityFacts {
  return {
    commitsLast90Days: 10,
    issuesClosedLast90Days: 0,
    openIssues: 0,
    contributors: 1,
    latestRelease: null,
    ...overrides,
  };
}

describe('assessHealth staleness', () => {
  it('counts whole calendar months since the last push', () => {
    const pushedAt = '2025-01-15T00:00:00Z';

    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2026-07-14T00:00:00Z'))
        .monthsSinceLastPush,
    ).toBe(17);
    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2026-07-15T00:00:00Z'))
        .monthsSinceLastPush,
    ).toBe(18);
  });

  it('does not call 18 months stale and calls 19 months stale', () => {
    const pushedAt = '2025-01-15T00:00:00Z';

    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2026-07-15T00:00:00Z')).stale,
    ).toBe(false);
    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2026-08-15T00:00:00Z')).stale,
    ).toBe(true);
  });

  it('counts a month only once its time of day has passed', () => {
    const pushedAt = '2025-01-15T12:00:00Z';

    expect(
      assessHealth(
        candidate({ pushedAt }),
        activity(),
        new Date('2026-07-15T11:59:59.999Z'),
      ).monthsSinceLastPush,
    ).toBe(17);
    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2026-07-15T12:00:00Z'))
        .monthsSinceLastPush,
    ).toBe(18);
  });

  it('clamps a push on day 31 to the last day of a shorter month', () => {
    const pushedAt = '2025-01-31T00:00:00Z';

    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2025-02-27T23:59:59Z'))
        .monthsSinceLastPush,
    ).toBe(0);
    expect(
      assessHealth(candidate({ pushedAt }), activity(), new Date('2025-02-28T00:00:00Z'))
        .monthsSinceLastPush,
    ).toBe(1);
  });

  it('reports zero months for a push dated after now', () => {
    const signals = assessHealth(
      candidate({ pushedAt: '2026-08-01T00:00:00Z' }),
      activity(),
      NOW,
    );

    expect(signals.monthsSinceLastPush).toBe(0);
    expect(signals.stale).toBe(false);
  });
});

describe('assessHealth maintenance', () => {
  it.each([
    [0, 'inactive'],
    [1, 'slow'],
    [4, 'slow'],
    [5, 'active'],
  ] as const)('maps %i commits in 90 days to %s', (commitsLast90Days, maintenance) => {
    const signals = assessHealth(candidate(), activity({ commitsLast90Days }), NOW);

    expect(signals.maintenance).toBe(maintenance);
  });
});

describe('assessHealth license', () => {
  it.each([
    ['MIT', 'permissive'],
    ['Apache-2.0', 'permissive'],
    ['Unlicense', 'permissive'],
    ['GPL-3.0', 'copyleft'],
    ['GPL-3.0-only', 'copyleft'],
    ['LGPL-2.1-or-later', 'copyleft'],
    ['MPL-2.0', 'copyleft'],
    [null, 'none'],
    ['NOASSERTION', 'other'],
    ['mit', 'other'],
    ['gpl-3.0-only', 'other'],
    ['BUSL-1.1', 'other'],
  ] as const)('classifies license %s as %s', (license, licenseKind) => {
    const signals = assessHealth(candidate({ license }), activity(), NOW);

    expect(signals.licenseKind).toBe(licenseKind);
  });
});

describe('assessHealth archived', () => {
  it('passes the archived flag through', () => {
    expect(assessHealth(candidate({ archived: true }), activity(), NOW).archived).toBe(true);
    expect(assessHealth(candidate({ archived: false }), activity(), NOW).archived).toBe(false);
  });
});
