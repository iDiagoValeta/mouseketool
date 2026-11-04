# Eval results, 2026-11-04

Pass 0 of the eval in `evals/`, run with the code in `main` on 2026-11-04: 58 runs, 36 on Claude Code and 22 on opencode. Every host is within every threshold:

- hits on at least 80% of defined inputs and 60% of vague ones;
- at least half of the partial ideas answered with the right base;
- at least 5 of 6 negatives right;
- no trigger on a small task.

A verdict counts only if the host read code in that run.

The pass flagged one negative case, `neg-sub-meter-bill-split`, as covered. The judge confirmed that `andis382/onemeter` does everything that case asked for. The case was replaced by `neg-seed-library-germination`, whose single run is in `pass0-replacement.json`; the table below uses it in place of the covered case.

| Host | Runs | Defined | Vague | Partial | Negatives | Small tasks | Median run |
|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | 36 | 92% | 83% | 100% | 100% | 100% | 28 s |
| deepseek-flash | 22 | 100% | 100% | 50% | 100% | 100% | 70 s |

## Every run

A positive hit needs a project that came from that run's search and that the judge confirms meets every must-have. A partial hit needs `base` with a project that the judge confirms covers the foundation. *Known* marks the project the case was built on; *alternative* marks another project the judge accepted.

| Case | Input | Host | Result | Answer |
|---|---|---|---|---|
| `pos-env-file-checks` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse dotenv-linter/dotenv-linter` |
| `pos-env-file-checks` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse dotenv-linter/dotenv-linter` |
| `pos-clean-build-artifacts` | vague | Sonnet 5.5 | miss: not from the search | `Verdict: reuse tbillington/kondo` |
| `pos-clean-build-artifacts` | defined | deepseek-flash | hit (known) | `Verdict: reuse tbillington/kondo` |
| `pos-gmail-filters-as-code` | vague | deepseek-flash | hit (known) | `Verdict: reuse mbrt/gmailctl` |
| `pos-gmail-filters-as-code` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse mbrt/gmailctl` |
| `pos-many-git-repos` | vague | Sonnet 5.5 | hit (alternative) | `Verdict: base jasursadikov/mud, nosarthur/gita` |
| `pos-many-git-repos` | defined | Sonnet 5.5 | miss: not from the search | `Verdict: reuse nosarthur/gita` |
| `pos-terminal-site-monitor` | vague | deepseek-flash | hit (alternative) | `Verdict: reuse Mohamed-Badry/statui` |
| `pos-terminal-site-monitor` | defined | deepseek-flash | hit (known) | `Verdict: reuse Owloops/updo` |
| `pos-domain-name-brainstorm` | vague | Sonnet 5.5 | hit (alternative) | `Verdict: base saidutt46/domain-check` |
| `pos-domain-name-brainstorm` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse brandonyoungdev/tldx` |
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
| `pos-organise-photos-by-metadata` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse jmathai/elodie` |
| `pos-organise-photos-by-metadata` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse jmathai/elodie` |
| `pos-strip-image-metadata` | vague | deepseek-flash | hit (known) | `Verdict: reuse szTheory/exifcleaner` |
| `pos-strip-image-metadata` | defined | deepseek-flash | hit (known) | `Verdict: reuse szTheory/exifcleaner` |
| `pos-sonic-playlists` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse NeptuneHub/AudioMuse-AI` |
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
| `neg-terminal-runbook` | negative | Sonnet 5.5 | right | `Verdict: base asciinema/asciinema` |
| `neg-practice-tempo-log` | negative | Sonnet 5.5 | right | `Verdict: base mjhydri/BeatNet` |
| `neg-choir-practice-tracker` | negative | deepseek-flash | right | `Verdict: build` |
| `neg-seed-library-germination` | negative | deepseek-flash | right | `Verdict: base growstuff/growstuff` |
| `neg-notes-open-actions` | negative | Sonnet 5.5 | right | `Verdict: build` |
| `trg-verbose-flag` | small task | Sonnet 5.5 | silent |  |
| `trg-rename-by-date` | small task | Sonnet 5.5 | silent |  |
| `trg-fix-failing-test` | small task | deepseek-flash | silent |  |
| `trg-write-regex` | small task | deepseek-flash | silent |  |
| `trg-bump-version` | small task | Sonnet 5.5 | silent |  |
| `trg-async-await` | small task | Sonnet 5.5 | silent |  |
| `partial-ascii-concept-animation` | partial | Sonnet 5.5 | hit (known) | `Verdict: base ChrisBuilds/terminaltexteffects` |
| `partial-git-history-narrated-video` | partial | deepseek-flash | hit (alternative) | `Verdict: base utensils/Envisaged` |
| `partial-discord-rpg-game-master` | partial | deepseek-flash | miss: lacks Discord bot for tabletop role-playing games | `Verdict: base 1A7432/loreweaver` |
| `partial-fridge-photo-meal-plan` | partial | Sonnet 5.5 | hit (known) | `Verdict: base mealie-recipes/mealie` |
| `partial-k8s-city-terminal` | partial | Sonnet 5.5 | hit (alternative) | `Verdict: base kdash-rs/kdash, braveadmin/kube-city` |
| `partial-shell-history-weekly-report` | partial | Sonnet 5.5 | hit (known) | `Verdict: base atuinsh/atuin` |

## Files

- `pass0.json`: the full pass. Each run has its prompt, the host's full answer, the repos the search returned and inspected, the number of files it read, and the score with the judge's verdicts.
- `pass0-replacement.json`: the run of the negative case that replaced the covered one.
- `judgments.json`: every judge verdict, keyed by repository and requirement list.
- `calibration.txt`: each case's known projects, judged before the pass against the requirements of their case.

Reproduce with `pnpm eval --calibrate` and `pnpm eval --pass 0`; see the main README.
