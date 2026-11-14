# mouseketool

[![CI](https://github.com/iDiagoValeta/mouseketool/actions/workflows/ci.yml/badge.svg)](https://github.com/iDiagoValeta/mouseketool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 24+](https://img.shields.io/badge/node-%3E%3D24-339933)
[![M8ven Score](https://m8ven.ai/badge/mcp/idiagovaleta-mouseketool-1srau9?v=1c4b1a35dbc979d045ad0af26529cfc1)](https://m8ven.ai/mcp/idiagovaleta-mouseketool-1srau9?s=readme)

**Before you build something new, find out whether it already exists.**

When you tell your coding agent you want to build a new tool, app or library, mouseketool searches GitHub for projects that already do it. It checks them for real: their health, their license, and the code behind each README's claims. Then it answers with a verdict against your requirements: **reuse**, **adapt**, **use as a base**, or **build from scratch**.

![opencode with deepseek-flash: a request for a terminal tool that turns a concept into animated ASCII illustrations; the skill searches GitHub, reads code from the candidates and answers "Verdict: base peterbrittain/asciimatics, hpjansson/chafa" with pros and cons](docs/demo.svg)

## How it works

- **An MCP server** does the mechanical work and makes no judgment:
  - many GitHub searches in one call;
  - repository inspection: README, files, activity, releases, issues, contributors and license, plus plain health signals;
  - file reads.
- **An Agent Skill** teaches your agent the method:
  1. separate the must-haves from the nice-to-haves;
  2. search from several angles;
  3. inspect the mature candidates;
  4. confirm in the code what the verdict relies on;
  5. answer verdict first, with pros and cons per candidate.

The skill triggers by itself when you want a new reusable tool to exist, and stays silent on small tasks such as a one-off script, a fix or a new flag. mouseketool has no LLM of its own: your agent's model does the judging.

## Install

You need Node 24 or later and a [GitHub token](#github-token).

<!-- x-release-please-start-version -->
```bash
curl -fsSL https://raw.githubusercontent.com/iDiagoValeta/mouseketool/v1.2.1/install.sh | sh
```
<!-- x-release-please-end -->

This installs the latest release of mouseketool for every supported agent on your machine:
- **Claude Code**: installed as a plugin, through Claude Code's own marketplace commands, pinned to that release.
- **opencode**: the release goes to `~/.local/share/mouseketool`, the skill to `~/.config/opencode/skills/`, and the server to your `opencode.json`.

Neither the script nor what it installs comes from `main`: a change reaches you only once it is released, and the repository's releases are immutable, so a published version cannot be replaced. Run the same command again to move to the latest release. To uninstall:

<!-- x-release-please-start-version -->
```bash
curl -fsSL https://raw.githubusercontent.com/iDiagoValeta/mouseketool/v1.2.1/install.sh | sh -s -- --uninstall
```
<!-- x-release-please-end -->

With Claude Code alone you can also skip the script:

<!-- x-release-please-start-version -->
```bash
claude plugin marketplace add iDiagoValeta/mouseketool@v1.2.1
claude plugin install mouseketool@mouseketool
```
<!-- x-release-please-end -->

and uninstall with:

```bash
claude plugin marketplace remove mouseketool
```

### GitHub token

mouseketool only reads public repositories, so it needs a token that can do nothing more. The server takes the first one it finds:

1. `MOUSEKETOOL_GITHUB_TOKEN`, a token for mouseketool alone. **Recommended**: a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with repository access "Public repositories (read-only)" and no permissions added.
2. `GITHUB_TOKEN`.
3. The token of `gh auth login`. It usually carries scopes such as `repo` and `workflow`, which can write to every repository you can reach, private ones included.

Export the variable in your shell profile, so that Claude Code or opencode passes it on to the server:

```bash
export MOUSEKETOOL_GITHUB_TOKEN=github_pat_...
```

When the token in use can write, the server says so on stderr at start. That check reads the `X-OAuth-Scopes` header, which only classic and `gh` tokens send.

The token is sent only to `api.github.com`. It is never logged and never appears in a tool result. Searches go through GitHub's GraphQL API, 10 at a time, so a call of up to 30 queries does not wait on the REST search limit of 30 per minute.

## Evaluation

`evals/` runs the whole method headless, against real models and the real GitHub API. It has four kinds of case:

- **20 positive ideas**, built on real projects, each in a vague and a defined version;
- **6 ideas covered only in part**, where the right answer is `base` with a mature project;
- **6 invented ideas**, where the right answer is to build, from scratch or on a mature foundation (`base`) that the run found and read;
- **6 small tasks**, where the skill must stay silent.

A recommendation counts as a hit only if all three hold:
- the project came from that run's search, not from the model's memory: a project the model already knew counts only once a search in that run returns it, which also confirms its exact name;
- the host read at least one file of that project;
- a separate judge confirms it meets every must-have.

Any project that meets them counts, not only the one a case was built on. The verdict counts only when it has the exact format of the skill on the first line of the answer.

```bash
pnpm eval --calibrate   # check the judge and the cases first
pnpm eval --pass 0      # a full pass
pnpm eval --pass 0 --host claude-opus --only <case>,<case>   # a few cases on Opus
```

Results of 2026-11-10 (58 runs) with search through GraphQL, within every threshold:

| Host | Defined | Vague | Partial | Invented | Small tasks |
|---|---|---|---|---|---|
| Claude Code, Sonnet 5.5 | 100% | 92% | 67% | 100% | 100% |
| opencode, deepseek-flash | 100% | 100% | 100% | 100% | 100% |

The same pass with REST search had every run right on its fourth attempt; each earlier attempt had missed one threshold by a single case, and its misses led to a change in the skill. A spot check on Opus 5.5 got 2 of 3 hard runs right. Every run of every attempt, with the host's full answer and the judge's verdicts, is in [`evals/results/2026-11-10/`](evals/results/2026-11-10/README.md).

## Development

```bash
git clone https://github.com/iDiagoValeta/mouseketool.git
cd mouseketool
pnpm install --frozen-lockfile
pnpm check   # typecheck, lint (including the hexagonal layer rules) and tests
pnpm build   # bundle the server and its dependencies into dist/server.mjs
claude --plugin-dir .   # try your local copy in Claude Code
```

`dist/` is committed, because an installed plugin runs no build. CI fails when it does not match the source, so commit it after `pnpm build`.

The code is hexagonal:
- `src/domain` and `src/application` import no adapter or IO module;
- `src/infrastructure` holds the GitHub, run-log and MCP adapters;
- `src/composition-root.ts` wires them.

See [`AGENTS.md`](AGENTS.md) for the conventions. GitHub is the only source for now.

## License

[MIT](LICENSE)
