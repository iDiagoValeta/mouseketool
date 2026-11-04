import type { PositiveCase } from '../cases/schema.ts';
import type { Judge } from './judge.ts';

/**
 * Judges every known match of every positive case against its defined and its vague requirements,
 * printing one line per (case, version, repo). A case is calibrated when one known match meets both versions,
 * so the judge and the requirements can be trusted before a real pass. A judge error counts as not meeting.
 */
export async function calibrate(
  cases: PositiveCase[],
  judge: Judge,
  print: (line: string) => void,
): Promise<boolean> {
  let allCalibrated = true;
  for (const c of cases) {
    const versions = [
      ['defined', c.defined.mustHaves],
      ['vague', c.vague.mustHaves],
    ] as const;
    let calibrated = false;
    for (const repo of c.knownMatches) {
      let meetsBoth = true;
      for (const [version, mustHaves] of versions) {
        try {
          const judgment = await judge.judge(repo, mustHaves);
          print(`${c.id} ${version} ${repo} ${judgment.meets ? 'meets' : `missing: ${judgment.missing.join('; ')}`}`);
          meetsBoth &&= judgment.meets;
        } catch (error) {
          print(`${c.id} ${version} ${repo} JUDGE ERROR: ${(error as Error).message}`);
          meetsBoth = false;
        }
      }
      calibrated ||= meetsBoth;
    }
    if (!calibrated) {
      print(`NOT CALIBRATED: ${c.id} has no known match that meets both versions`);
      allCalibrated = false;
    }
  }
  return allCalibrated;
}
