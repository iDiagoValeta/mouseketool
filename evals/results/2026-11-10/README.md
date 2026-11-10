# Eval results, 2026-11-10

Pass 1 of the eval in `evals/`, attempted four times on 2026-11-10 against `main`. Each attempt had 58 runs: 35 on Claude Code and 23 on opencode. Between attempts, the skill was changed where the misses pointed. The fourth attempt is within every threshold, with every run right:

- hits on at least 80% of defined inputs and 60% of vague ones;
- at least half of the partial ideas answered with the right base;
- at least 5 of 6 negatives right;
- no trigger on a small task.

These runs used the stricter scoring of [#40](https://github.com/iDiagoValeta/mouseketool/pull/40). A recommendation counts only if:
- the project came from that run's search;
- the host read a file of that project;
- the verdict has the skill's exact format on the first line of the answer.

Earlier results were scored with looser rules, so they cannot be compared one to one.

| Host | Runs | Defined | Vague | Partial | Negatives | Small tasks | Median run |
|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | 35 | 100% | 100% | 100% | 100% | 100% | 29 s |
| deepseek-flash | 23 | 100% | 100% | 100% | 100% | 100% | 62 s |

One clean run is not a guarantee. With 2 to 6 runs of a kind per host, one miss moves a share by 17 to 50 points, and the first three attempts each missed a threshold by a single case.

## How the skill changed

Each row is one attempt at pass 1. The skill was the one in `main` after the PR named in the row.

| Attempt | Skill after | Host | Defined | Vague | Partial | Negatives | Small tasks | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | [#46](https://github.com/iDiagoValeta/mouseketool/pull/46) | Sonnet 5.5 | 100% | 75% | 67% | 100% | 100% | FAIL |
| 1 | [#46](https://github.com/iDiagoValeta/mouseketool/pull/46) | deepseek-flash | 100% | 100% | 100% | 50% | 100% | FAIL |
| 2 | [#52](https://github.com/iDiagoValeta/mouseketool/pull/52) | Sonnet 5.5 | 92% | 100% | 33% | 100% | 100% | FAIL |
| 2 | [#52](https://github.com/iDiagoValeta/mouseketool/pull/52) | deepseek-flash | 100% | 100% | 100% | 100% | 100% | FAIL |
| 3 | [#54](https://github.com/iDiagoValeta/mouseketool/pull/54) | Sonnet 5.5 | 92% | 92% | 67% | 75% | 100% | FAIL |
| 3 | [#54](https://github.com/iDiagoValeta/mouseketool/pull/54) | deepseek-flash | 100% | 100% | 100% | 100% | 100% | FAIL |
| 4 | [#56](https://github.com/iDiagoValeta/mouseketool/pull/56) | Sonnet 5.5 | 100% | 100% | 100% | 100% | 100% | PASS |
| 4 | [#56](https://github.com/iDiagoValeta/mouseketool/pull/56) | deepseek-flash | 100% | 100% | 100% | 100% | 100% | PASS |

- **Attempt 1** had five misses, and four of them came from gaps in the skill:
  - a sentence before the verdict line;
  - a name written from the package name: `invoice2data/invoice2data` instead of `invoice-x/invoice2data`;
  - two projects recommended from memory without any search returning them;
  - `build` where a mature app already did a must-have end to end.

  [#52](https://github.com/iDiagoValeta/mouseketool/pull/52) closed those gaps.
- **Attempt 2** fixed them, but Sonnet then picked young projects that looked like the idea as bases, such as `braveadmin/kube-city` (1 star) over `kdash-rs/kdash`. [#54](https://github.com/iDiagoValeta/mouseketool/pull/54) made maturity decide among bases.
- **Attempt 3** missed three projects the search never returned: `tldx`, `AudioMuse-AI` and `avrae`. In each, the model knew its best candidate lacked a must-have, but the skill allowed a second search only when the first found nothing useful. One run also listed a directory without reading a file. [#56](https://github.com/iDiagoValeta/mouseketool/pull/56) asks for a second search, aimed at the uncovered must-haves, and says a listing is not a read.

## Search through GraphQL

After [#60](https://github.com/iDiagoValeta/mouseketool/pull/60) moved search to GraphQL, raised the cap from 15 to 30 queries a call, and the skill asked for more vocabulary variants, pass 1 ran once more. It passed every threshold, with 56 of 58 runs right. The report is `pass1-graphql.json`.

| Host | Defined | Vague | Partial | Negatives | Small tasks | Median run |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | 100% | 92% | 67% | 100% | 100% | 26 s |
| deepseek-flash | 100% | 100% | 100% | 100% | 100% | 77 s |

- **More candidates per run, same recall.** Each run saw 66 distinct repositories from its searches on average, against 46 in the fourth attempt with REST. The project a case was built on came back in 42 of 46 positive and partial runs, the same count as with REST. GraphQL recovered two that REST had missed and missed one that REST had found.
- **The two misses are Sonnet's choices.**
  - `partial-k8s-city-terminal`: the search returned `derailed/k9s` and `kdash-rs/kdash`, and Sonnet again chose `braveadmin/kube-city` (1 star) as the base. [#54](https://github.com/iDiagoValeta/mouseketool/pull/54) narrowed this bias but did not remove it.
  - `pos-many-git-repos` vague: no search returned `nosarthur/gita` or `jasursadikov/mud`, and Sonnet chose `bircni/git-statuses`, which lacks batch commands.

## Opus spot check

Three hard runs on Opus 5.5 (`claude-opus-5-5` on Claude Code), with the skill of [#52](https://github.com/iDiagoValeta/mouseketool/pull/52). These are the two partial ideas that ask the most judgment, and the negative with five must-haves. They ran through the spot host of [#50](https://github.com/iDiagoValeta/mouseketool/pull/50), outside the rotation.

| Case | Input | Host | Result | Answer |
|---|---|---|---|---|
| `neg-choir-practice-tracker` | negative | Opus 5.5 | right | `Verdict: build` |
| `partial-discord-rpg-game-master` | partial | Opus 5.5 | miss: lacks Discord bot for tabletop role-playing games; Rolls dice using tabletop RPG dice notation such as 1d20+5 | `Verdict: base diceframe/diceframe` |
| `partial-k8s-city-terminal` | partial | Opus 5.5 | hit (alternative) | `Verdict: base kdash-rs/kdash` |

Opus missed the same way Sonnet did in attempt 2: it chose a young AI game master over a mature Discord dice bot. [#54](https://github.com/iDiagoValeta/mouseketool/pull/54) targets that miss; Opus was not run again, so whether it fixes it on Opus is untested.

## Every run of the fourth attempt

A positive hit needs a project that came from that run's search, that the host read, and that the judge confirms meets every must-have. A partial hit needs `base` with a project that the judge confirms covers the foundation. *Known* marks the project the case was built on; *alternative* marks another project the judge accepted.

| Case | Input | Host | Result | Answer |
|---|---|---|---|---|
| `pos-env-file-checks` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse dotenv-linter/dotenv-linter` |
| `pos-env-file-checks` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse dotenv-linter/dotenv-linter` |
| `pos-clean-build-artifacts` | vague | deepseek-flash | hit (known) | `Verdict: reuse tbillington/kondo` |
| `pos-clean-build-artifacts` | defined | deepseek-flash | hit (known) | `Verdict: reuse tbillington/kondo` |
| `pos-gmail-filters-as-code` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse mbrt/gmailctl` |
| `pos-gmail-filters-as-code` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse mbrt/gmailctl` |
| `pos-many-git-repos` | vague | Sonnet 5.5 | hit (known) | `Verdict: base yetidevworks/drydock, nosarthur/gita` |
| `pos-many-git-repos` | defined | deepseek-flash | hit (known) | `Verdict: reuse nosarthur/gita` |
| `pos-terminal-site-monitor` | vague | deepseek-flash | hit (known) | `Verdict: reuse owloops/updo` |
| `pos-terminal-site-monitor` | defined | Sonnet 5.5 | hit (alternative) | `Verdict: reuse abhixdd/uptimekit-cli` |
| `pos-domain-name-brainstorm` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse brandonyoungdev/tldx` |
| `pos-domain-name-brainstorm` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse brandonyoungdev/tldx` |
| `pos-baby-care-log` | vague | deepseek-flash | hit (known) | `Verdict: reuse babybuddy/babybuddy` |
| `pos-baby-care-log` | defined | deepseek-flash | hit (known) | `Verdict: reuse babybuddy/babybuddy` |
| `pos-bank-statement-to-csv` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse benjamin-awd/monopoly` |
| `pos-bank-statement-to-csv` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse benjamin-awd/monopoly` |
| `pos-invoice-data-extraction` | vague | Sonnet 5.5 | hit (known) | `Verdict: base invoice-x/invoice2data` |
| `pos-invoice-data-extraction` | defined | deepseek-flash | hit (known) | `Verdict: reuse invoice-x/invoice2data` |
| `pos-csv-json-into-sqlite` | vague | deepseek-flash | hit (known) | `Verdict: reuse simonw/sqlite-utils` |
| `pos-csv-json-into-sqlite` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse simonw/sqlite-utils` |
| `pos-calendar-contacts-sync` | vague | Sonnet 5.5 | hit (known) | `Verdict: base pimutils/vdirsyncer` |
| `pos-calendar-contacts-sync` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse pimutils/vdirsyncer` |
| `pos-gps-track-video` | vague | deepseek-flash | hit (alternative) | `Verdict: base time4tea/gopro-dashboard-overlay` |
| `pos-gps-track-video` | defined | deepseek-flash | hit (alternative) | `Verdict: base time4tea/gopro-dashboard-overlay` |
| `pos-ios-dependency-notices` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse mono0926/licenseplist` |
| `pos-ios-dependency-notices` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse mono0926/licenseplist` |
| `pos-organise-photos-by-metadata` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse jmathai/elodie` |
| `pos-organise-photos-by-metadata` | defined | deepseek-flash | hit (known) | `Verdict: reuse jmathai/elodie` |
| `pos-strip-image-metadata` | vague | deepseek-flash | hit (known) | `Verdict: reuse szTheory/exifcleaner` |
| `pos-strip-image-metadata` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse sztheory/exifcleaner` |
| `pos-sonic-playlists` | vague | Sonnet 5.5 | hit (known) | `Verdict: base neptunehub/audiomuse-ai` |
| `pos-sonic-playlists` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse neptunehub/audiomuse-ai` |
| `pos-subtitle-download` | vague | deepseek-flash | hit (known) | `Verdict: reuse diaoul/subliminal` |
| `pos-subtitle-download` | defined | deepseek-flash | hit (known) | `Verdict: reuse diaoul/subliminal` |
| `pos-pgp-key-manager` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse orhun/gpg-tui` |
| `pos-pgp-key-manager` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse orhun/gpg-tui` |
| `pos-container-to-run-command` | vague | Sonnet 5.5 | hit (known) | `Verdict: reuse lavie/runlike` |
| `pos-container-to-run-command` | defined | deepseek-flash | hit (known) | `Verdict: reuse lavie/runlike` |
| `pos-notebook-comparison` | vague | deepseek-flash | hit (known) | `Verdict: reuse jupyter/nbdime` |
| `pos-notebook-comparison` | defined | Sonnet 5.5 | hit (known) | `Verdict: reuse jupyter/nbdime` |
| `neg-lease-key-dates` | negative | Sonnet 5.5 | right | `Verdict: base devilmango/contract_renewal_radar` |
| `neg-terminal-runbook` | negative | Sonnet 5.5 | right | `Verdict: base qianbrady/termquill, asciinema/asciinema` |
| `neg-practice-tempo-log` | negative | deepseek-flash | right | `Verdict: base dlepaux/realtime-bpm-analyzer` |
| `neg-choir-practice-tracker` | negative | deepseek-flash | right | `Verdict: build` |
| `neg-seed-library-germination` | negative | Sonnet 5.5 | right | `Verdict: base koha-community/koha` |
| `neg-notes-open-actions` | negative | Sonnet 5.5 | right | `Verdict: build` |
| `trg-verbose-flag` | small task | Sonnet 5.5 | silent |  |
| `trg-rename-by-date` | small task | deepseek-flash | silent |  |
| `trg-fix-failing-test` | small task | deepseek-flash | silent |  |
| `trg-write-regex` | small task | Sonnet 5.5 | silent |  |
| `trg-bump-version` | small task | Sonnet 5.5 | silent |  |
| `trg-async-await` | small task | Sonnet 5.5 | silent |  |
| `partial-ascii-concept-animation` | partial | deepseek-flash | hit (alternative) | `Verdict: base hpjansson/chafa` |
| `partial-git-history-narrated-video` | partial | deepseek-flash | hit (known) | `Verdict: base acaudwell/Gource, ahmedkhaleel2004/gitdiagram` |
| `partial-discord-rpg-game-master` | partial | Sonnet 5.5 | hit (known) | `Verdict: base avrae/avrae, bobby-gray/open-tabletop-gm` |
| `partial-fridge-photo-meal-plan` | partial | Sonnet 5.5 | hit (known) | `Verdict: base mealie-recipes/mealie, rldiao/mealie-mcp-server` |
| `partial-k8s-city-terminal` | partial | Sonnet 5.5 | hit (alternative) | `Verdict: base nklmilojevic/sofka` |
| `partial-shell-history-weekly-report` | partial | deepseek-flash | hit (known) | `Verdict: base atuinsh/atuin` |

The other attempts are in `pass1-iteration1.json` to `pass1-iteration3.json`, the Opus runs in `opus-spot.json`, the judge's verdicts in `judgments.json` and the calibration in `calibration.txt`.
