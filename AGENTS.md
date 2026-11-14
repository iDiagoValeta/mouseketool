# AGENTS.md

mouseketool is a local MCP server that finds existing GitHub projects for a product idea.
It ships with an Agent Skill that drives the server; the product has no LLM of its own and GitHub is its only source in v1.

## Architecture

Hexagonal (ports and adapters). Dependencies point inward:

- `src/domain/**` and `src/application/**` import nothing from `src/infrastructure/**`, `@modelcontextprotocol/*`, `node:child_process`, `node:fs` or `node:fs/promises`.
- ESLint `no-restricted-imports` enforces this in `pnpm lint`. `test/architecture/contract.test.ts` checks that the rule still fires on a known violation (`test/architecture/fixtures/`).
- `src/infrastructure/mcp/**` (the driving adapter) imports no other adapter (`**/github/**`, `**/run-log/**`); the errors it tells apart, `SourceError` and `SourceRateLimitedError`, live next to `RepositorySource` in `src/application/ports/`.
- Adapters live in `src/infrastructure/**`. The composition root, `src/composition-root.ts`, is the only place that wires them to ports.

## Commands

- `pnpm install --frozen-lockfile`: install dependencies. Use pnpm only, never npm.
- `pnpm typecheck`: `tsc --noEmit`.
- `pnpm lint`: ESLint, including the layer rule.
- `pnpm test`: Vitest.
- `pnpm check`: typecheck, lint and test. Run it before pushing.
- `pnpm build`: bundles `src/main.ts` and every dependency into `dist/server.mjs`, the `mouseketool` bin, plus `dist/THIRD_PARTY_LICENSES.md`. `dist/` is committed, because an installed plugin runs no build. CI rebuilds it and fails when the committed copy differs, so commit it after every change to `src/` or to the dependencies. A Dependabot PR that bumps a bundled dependency fails that check until `pnpm build` is run on its branch and `dist/` is pushed.
- `pnpm eval`: runs the eval harness in `evals/harness/cli.ts`.

## Install

`install.sh` installs and uninstalls (`--uninstall`) for Claude Code, through its plugin marketplace (`.claude-plugin/marketplace.json`), and for opencode. By default it installs the latest release, found through the `/releases/latest` redirect, and pins the Claude Code marketplace to its tag; `MOUSEKETOOL_REF=<branch or tag>` installs that ref instead. Claude Code cannot repoint a marketplace, so moving to another ref removes and adds it again. The README's install commands name the current release; release-please bumps them (`x-release-please-start-version` blocks).

## Local files

`.dev/` holds the design spec and the implementation plans. It is git-ignored and never versioned; this file cites it for context.

## Git

Trunk-based branching:

- `main` is the only long-lived branch.
- Work happens on short-lived branches cut from `main`, one per change.
- PRs are squash-merged, and the branch is deleted on merge.
- Every PR links an issue (`Closes #N`).
- Commits and PR titles follow Conventional Commits (`feat:`, `fix:`, `chore:`, ...). Commit bodies explain why.
- Everything in git is in English.

The `tbd-protection` ruleset protects `main`: changes arrive only through a squash-merged pull request whose `check` CI job passed, history stays linear, and force pushes and deletion are blocked. Release PRs opened by release-please are created by GitHub Actions, so GitHub holds their CI run until it is approved (`gh api -X POST repos/iDiagoValeta/mouseketool/actions/runs/<id>/approve`).

## Releases

release-please runs on `main`. It opens a release PR that bumps the version in `package.json` and updates `CHANGELOG.md`; merging that PR creates the tag and the GitHub release. The version is tracked in `.release-please-manifest.json`.
