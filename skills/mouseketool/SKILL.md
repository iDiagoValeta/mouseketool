---
name: mouseketool
description: Use when the user describes a new product, app, tool or service idea, or a large new component, before any design or code is written. Searches GitHub for existing projects that fit, checks them for real and gives a verdict - reuse, adapt, use as a base, or build from scratch. Do NOT use for small tasks such as scripts, flags, refactors, bug fixes or edits to an existing codebase.
---

# mouseketool

Before building something new, find out whether it already exists. The tools `search_repositories`, `inspect_repository` and `read_repository_file` (MCP server `mouseketool`) gather facts and make no judgments. You judge.

## 1. Gate

If the request is not a new product or a large new component, stop silently: no mention of this skill, no questions, no search.

## 2. Read the input

Split the idea into must-haves and nice-to-haves, and note the stated use (commercial, internal, open source) and stack constraints. Ask at most two questions, and only if the answer would change the verdict; otherwise state your assumption in one line and go on.

## 3. Expand

Write 8 to 15 varied queries: synonyms, the names the community would use, category terms, `topic:` qualifiers, different angles on the same need. Not 15 rewordings of the user's sentence.

## 4. Search and shortlist

Call `search_repositories` once with all queries. Call it a second time only if the first gave nothing useful, with queries from a different angle. Drop candidates that are archived, stale (last push over 18 months ago), or clearly off target. Keep a handful.

## 5. Inspect

Call `inspect_repository` on at most 6 candidates. Drop any with `health.archived`, `health.stale`, or a `health.licenseKind` that blocks the user's stated use (`none` blocks everything; `copyleft` blocks closed-source use). For every capability the verdict depends on, confirm it in the code with `read_repository_file`. A README claim alone is not confirmation.

## 6. Judge

For each candidate: coverage per must-have, health (`maintenance`, recent activity, open issues), license fit, and the rough effort of adapting it versus building from scratch. Never recommend `reuse` or `adapt` for a candidate that misses a must-have.

## 7. Answer

The first line of the answer is exactly one of these, nothing before it:

- `Verdict: reuse owner/name` : use it as is.
- `Verdict: adapt owner/name` : fork or modify it to fit.
- `Verdict: base owner/name` : build on top of it as a foundation.
- `Verdict: build` : nothing fits, build from scratch.

For `reuse`, `adapt` and `base`, list `owner/name` after the word, comma-separated when there are several (`Verdict: adapt foo/bar, baz/qux`). Examples:

```
Verdict: reuse foo/bar
Verdict: adapt foo/bar
Verdict: base foo/bar, baz/qux
Verdict: build
```

Then at most three lines of summary: what you found and why that verdict. Then, per candidate, pros and cons against the user's goal.

If nothing fits, say so plainly: `Verdict: build`, and why. A forced candidate is a failure. Recommending a poor match to have something to show is worse than saying "build it". You may add "build it, and borrow this piece from owner/name" when that is true.
