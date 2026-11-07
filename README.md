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

You need Node 24 or later, pnpm, and a GitHub token: either `GITHUB_TOKEN`, or being logged in with `gh auth login`.

```bash
git clone https://github.com/iDiagoValeta/mouseketool.git
cd mouseketool
pnpm install --frozen-lockfile
pnpm build
```

**Claude Code.** The repository is a plugin:

```bash
claude --plugin-dir /path/to/mouseketool
```

**opencode.**
1. Copy `skills/mouseketool/` into a skills directory, such as `.opencode/skills/` or `~/.config/opencode/skills/`.
2. Add the server to `opencode.json`, as in [`opencode.example.json`](opencode.example.json), with the absolute path to `dist/server.mjs`.

The token is sent only to `api.github.com`. It is never logged and never appears in a tool result. Searches are queued to GitHub's limit of 30 per minute.

## Evaluation

`evals/` runs the whole method headless, against real models and the real GitHub API. It has four kinds of case:

- **20 positive ideas**, built on real projects, each in a vague and a defined version;
- **6 ideas covered only in part**, where the right answer is `base` with a mature project;
- **6 invented ideas**, where the right answer is to build;
- **6 small tasks**, where the skill must stay silent.

A recommendation counts as a hit only if all three hold:
- the project came from that run's search, not from the model's memory;
- the host read its code;
- a separate judge confirms it meets every must-have.

Any project that meets them counts, not only the one a case was built on.

```bash
pnpm eval --calibrate   # check the judge and the cases first
pnpm eval --pass 0      # a full pass
```

Results of 2026-11-04 (58 runs), within every threshold:

| Host | Defined | Vague | Partial | Invented | Small tasks |
|---|---|---|---|---|---|
| Claude Code, Sonnet 5.5 | 92% | 83% | 100% | 100% | 100% |
| opencode, deepseek-flash | 100% | 100% | 50% | 100% | 100% |

Every run, with the host's full answer and the judge's verdicts, is in [`evals/results/2026-11-04/`](evals/results/2026-11-04/README.md).

## Development

```bash
pnpm check   # typecheck, lint (including the hexagonal layer rules) and tests
pnpm build   # bundle the server into dist/server.mjs
```

The code is hexagonal:
- `src/domain` and `src/application` import no adapter or IO module;
- `src/infrastructure` holds the GitHub, run-log and MCP adapters;
- `src/composition-root.ts` wires them.

See [`AGENTS.md`](AGENTS.md) for the conventions. GitHub is the only source for now.

## License

[MIT](LICENSE)
