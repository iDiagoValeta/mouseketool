# mouseketool
A tool to find useful tools on github.

## Using the skill and the server

`dist/` is not committed: run `pnpm build` before using the Claude Code plugin (`--plugin-dir` on this repo) or the opencode config.

opencode reads project skills from `.opencode/skills/<name>/SKILL.md`; it also reads `.claude/skills/` and `.agents/skills/` in the project, and `~/.config/opencode/skills/`, `~/.claude/skills/` and `~/.agents/skills/` globally. Copy `skills/mouseketool/` into one of them and add the server to `opencode.json` as in `opencode.example.json`. For headless `opencode run`, pass `--standalone`, otherwise it talks to the background service, which has the global config loaded.
