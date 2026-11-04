# Eval results, 2026-11-04

Pass 0 of the eval in `evals/`, run with the code in `main` on 2026-11-04. Every host is within every threshold (hits on 80% of defined inputs and 60% of vague ones, at least 5 of 6 negatives, no trigger on a small task). The Claude Code share was rerun after its file tools were made read-only (`pass0-sonnet-rerun.json`); the opencode share comes from the full pass (`pass0.json`), whose opencode code path did not change.

| Host | Runs | Defined | Vague | Negatives | Small tasks | Median run |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | 32 | 92% | 75% | 100% | 100% | 24 s |
| deepseek-flash | 20 | 100% | 100% | 100% | 100% | 58 s |

## Every run

A hit needs the recommended project to come from that run's search and to meet every must-have, as confirmed by the judge. *Known* marks the project the case was built on; *alternative* marks another project the judge accepted.

| Case | Input | Host | Result | Answer |
|---|---|---|---|---|
| `pos-env-file-checks` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse dotenv-linter/dotenv-linter, wemake-services/dotenv-linter` |
| `pos-env-file-checks` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse dotenv-linter/dotenv-linter, plus dotenv-linter/action-dotenv-linter for GitHub Actions` |
| `pos-clean-build-artifacts` | vague | Sonnet 5.5 | miss: not from the search | `Verdict: reuse tbillington/kondo` |
| `pos-clean-build-artifacts` | defined | deepseek-flash | hit (known) | `Verdict: adapt tbillington/kondo` |
| `pos-gmail-filters-as-code` | vague | deepseek-flash | hit (known) | `Verdict: reuse mbrt/gmailctl` |
| `pos-gmail-filters-as-code` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse mbrt/gmailctl` |
| `pos-many-git-repos` | vague | Sonnet 5.5 | miss: not from the search | `Verdict: reuse nosarthur/gita` |
| `pos-many-git-repos` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse nosarthur/gita` |
| `pos-terminal-site-monitor` | vague | deepseek-flash | hit (alternative) | `Verdict: reuse abhixdd/uptimekit-cli` |
| `pos-terminal-site-monitor` | defined | deepseek-flash | hit (known) | `Verdict: reuse Owloops/updo` |
| `pos-domain-name-brainstorm` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse brandonyoungdev/tldx` |
| `pos-domain-name-brainstorm` | defined | Sonnet 5.5 | miss: lacks Can print only the available domains | `Verdict: adapt saidutt46/domain-check` |
| `pos-baby-care-log` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse babybuddy/babybuddy` |
| `pos-baby-care-log` | defined | deepseek-flash | hit (known) | `Verdict: reuse babybuddy/babybuddy` |
| `pos-bank-statement-to-csv` | vague | deepseek-flash | hit (known) | `Verdict: reuse benjamin-awd/monopoly` |
| `pos-bank-statement-to-csv` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse benjamin-awd/monopoly` |
| `pos-invoice-data-extraction` | vague | Sonnet 5.5 | miss: not from the search | `Verdict: base invoice2data/invoice2data` |
| `pos-invoice-data-extraction` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse invoice-x/invoice2data` |
| `pos-csv-json-into-sqlite` | vague | deepseek-flash | hit (known) | `Verdict: reuse simonw/sqlite-utils` |
| `pos-csv-json-into-sqlite` | defined | deepseek-flash | hit (known) | `Verdict: reuse simonw/sqlite-utils` |
| `pos-calendar-contacts-sync` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse pimutils/vdirsyncer` |
| `pos-calendar-contacts-sync` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse pimutils/vdirsyncer` |
| `pos-gps-track-video` | vague | Sonnet 5.5 | hit (alternative) | `Verdict: reuse time4tea/gopro-dashboard-overlay` |
| `pos-gps-track-video` | defined | deepseek-flash | hit (known) | `Verdict: reuse gpx-animator/gpx-animator` |
| `pos-ios-dependency-notices` | vague | deepseek-flash | hit (known) | `Verdict: reuse mono0926/LicensePlist` |
| `pos-ios-dependency-notices` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse mono0926/LicensePlist` |
| `pos-organise-photos-by-metadata` | vague | Sonnet 5.5 | hit (known) | `Verdict: adapt jmathai/elodie` |
| `pos-organise-photos-by-metadata` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse jmathai/elodie` |
| `pos-strip-image-metadata` | vague | deepseek-flash | hit (alternative) | `Verdict: reuse exiftool/exiftool` |
| `pos-strip-image-metadata` | defined | deepseek-flash | hit (known) | `Verdict: reuse szTheory/exifcleaner` |
| `pos-sonic-playlists` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse neptunehub/audiomuse-ai` |
| `pos-sonic-playlists` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse NeptuneHub/AudioMuse-AI` |
| `pos-subtitle-download` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse Diaoul/subliminal` |
| `pos-subtitle-download` | defined | deepseek-flash | hit (known) | `Verdict: reuse Diaoul/subliminal` |
| `pos-pgp-key-manager` | vague | deepseek-flash | hit (known) | `Verdict: reuse orhun/gpg-tui` |
| `pos-pgp-key-manager` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse orhun/gpg-tui` |
| `pos-container-to-run-command` | vague | Sonnet 5.5 | hit (known) | `Verdict: adapt lavie/runlike` |
| `pos-container-to-run-command` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse lavie/runlike` |
| `pos-notebook-comparison` | vague | deepseek-flash | hit (known) | `Verdict: reuse jupyter/nbdime` |
| `pos-notebook-comparison` | defined | deepseek-flash | hit (known) | `Verdict: reuse jupyter/nbdime` |
| `neg-lease-key-dates` | negative | Sonnet 5.5 | right | `Verdict: build` |
| `neg-terminal-runbook` | negative | Sonnet 5.5 | right | `Verdict: base qianbrady/termquill` |
| `neg-practice-tempo-log` | negative | Sonnet 5.5 | right | `Verdict: build` |
| `neg-choir-practice-tracker` | negative | deepseek-flash | right | `Verdict: build` |
| `neg-sub-meter-bill-split` | negative | deepseek-flash | right | `Verdict: build` |
| `neg-notes-open-actions` | negative | Sonnet 5.5 | right | `Verdict: build` |
| `trg-verbose-flag` | small task | Sonnet 5.5 | silent |  |
| `trg-rename-by-date` | small task | Sonnet 5.5 | silent |  |
| `trg-fix-failing-test` | small task | deepseek-flash | silent |  |
| `trg-write-regex` | small task | deepseek-flash | silent |  |
| `trg-bump-version` | small task | Sonnet 5.5 | silent |  |
| `trg-async-await` | small task | Sonnet 5.5 | silent |  |

## Files

- `pass0.json`: the full pass, both hosts. Each run has its prompt, the host's full answer, the repos the search returned and inspected, and the score with the judge's verdicts.
- `pass0-sonnet-rerun.json`: the Claude Code share, rerun on the final code.
- `judgments.json`: every judge verdict, keyed by repository and requirement list.
- `calibration.txt`: each case's known projects judged against both versions of the case before the pass.

Reproduce with `pnpm eval --calibrate` and `pnpm eval --pass 0`; see the main README.
