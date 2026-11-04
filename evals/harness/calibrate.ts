import type { PartialCase, PositiveCase } from '../cases/schema.ts';
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
          print(`${c.id} ${version} ${repo} ${judgment.meets ? 'meets' : judgment.missing.length === 0 ? 'does not meet' : `missing: ${judgment.missing.join('; ')}`}`);
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

/**
 * Judges every known foundation of every partial case against its foundation requirements. A case is calibrated
 * when one known foundation meets them, so the judge can be trusted to accept the right base before a real pass.
 * The whole idea is not judged: it is meant to be only partly covered. A judge error counts as not meeting.
 */
export async function calibratePartial(
  cases: PartialCase[],
  judge: Judge,
  print: (line: string) => void,
): Promise<boolean> {
  let allCalibrated = true;
  for (const c of cases) {
    let calibrated = false;
    for (const repo of c.knownFoundations) {
      try {
        const judgment = await judge.judge(repo, c.foundationMustHaves);
        print(`${c.id} foundation ${repo} ${judgment.meets ? 'meets' : judgment.missing.length === 0 ? 'does not meet' : `missing: ${judgment.missing.join('; ')}`}`);
        calibrated ||= judgment.meets;
      } catch (error) {
        print(`${c.id} foundation ${repo} JUDGE ERROR: ${(error as Error).message}`);
      }
    }
    if (!calibrated) {
      print(`NOT CALIBRATED: ${c.id} has no known foundation that meets its foundation requirements`);
      allCalibrated = false;
    }
  }
  return allCalibrated;
}
