# mouseketool

mouseketool checks whether public GitHub projects already do what you are about to build. Describe the idea and
its skill searches GitHub through a local MCP server, inspects the best candidates, and gives a verdict for each:
reuse it, adapt it, use it as a base, or build your own.

It reads public data only. It uses a GitHub token from `MOUSEKETOOL_GITHUB_TOKEN`, `~/.config/mouseketool/token`, `GITHUB_TOKEN` or `gh auth token`
and sends it to `api.github.com` only. A read-only token is enough; the server warns when the token can write.

Install in Claude Code:

```
/plugin install mouseketool --marketplace iDiagoValeta/mouseketool
```

Requires Node 24 or later. Source, tests and docs: https://github.com/iDiagoValeta/mouseketool
