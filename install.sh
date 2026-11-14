#!/bin/sh
# Installs mouseketool for every supported agent found on this machine, Claude Code and opencode, or removes it
# with --uninstall. The README gives the command, which fetches this script from the latest release.
#
# It installs the latest release, never main, so a change reaches users only once it is released. Claude Code
# gets the repository as a plugin, through its own marketplace commands, pinned to that release. opencode gets
# a copy of the release in $XDG_DATA_HOME/mouseketool, a copy of the skill in its skills directory and the
# server added to its opencode.json. Running it again moves both to the latest release.
set -eu

REPO="iDiagoValeta/mouseketool"
# A branch or tag to install instead of the latest release, to try a change before it is released.
REF="${MOUSEKETOOL_REF:-}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/mouseketool"
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
OPENCODE_SKILL="$OPENCODE_DIR/skills/mouseketool"
# Marks the skill copy as this script's, so an install replaces and an uninstall removes only that copy.
MARKER=".installed-by-mouseketool"

say() { printf 'mouseketool: %s\n' "$*"; }
fail() {
  printf 'mouseketool: %s\n' "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

need_node() {
  has node || fail "Node.js 24 or later is required (https://nodejs.org)."
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 24 ] || fail "Node.js 24 or later is required; found $(node --version)."
}

# The tag of the latest release, read from where GitHub redirects /releases/latest; no API call, no rate limit.
latest_release() {
  url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") || return 1
  tag=${url##*/releases/tag/}
  [ "$tag" != "$url" ] && [ -n "$tag" ] || return 1
  echo "$tag"
}

resolve_ref() {
  has curl || fail "curl is required to download mouseketool."
  if [ -z "$REF" ]; then
    REF=$(latest_release) || fail "could not find the latest release of $REPO."
  fi
  # The ref goes into URLs and a marketplace source; a branch or tag name needs nothing else.
  case "$REF" in
    *[!A-Za-z0-9._/-]*) fail "\"$REF\" is not a branch or tag name." ;;
  esac
  say "installing $REF."
}

# --- Claude Code -------------------------------------------------------------------------------------------

# Prints the ref the mouseketool marketplace is pinned to (empty when it follows the default branch), or fails
# when that marketplace is not added.
CLAUDE_REF_JS='
let list;
try { list = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { process.exit(1); }
const entry = Array.isArray(list) ? list.find((m) => m.name === "mouseketool") : undefined;
if (entry === undefined) process.exit(1);
console.log(entry.ref ?? "");
'

claude_install() {
  # HTTPS needs no GitHub SSH key, and the repository is public.
  export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1
  if current=$(claude plugin marketplace list --json </dev/null 2>/dev/null | node -e "$CLAUDE_REF_JS"); then
    if [ "$current" = "$REF" ] && claude plugin list </dev/null 2>/dev/null | grep -q 'mouseketool@mouseketool'; then
      # Same ref: a tag stays where it is, a branch may have moved.
      claude plugin marketplace update mouseketool </dev/null
      claude plugin update mouseketool@mouseketool </dev/null
      claude_warn_duplicate
      say "Claude Code: up to date. Start a new session to load any change."
      return 0
    fi
    # Claude Code cannot point a marketplace at another ref. Removing it also removes the plugin, which is
    # installed again below from the new ref.
    claude plugin marketplace remove mouseketool </dev/null
  fi
  claude plugin marketplace add "$REPO@$REF" </dev/null
  claude plugin install mouseketool@mouseketool </dev/null
  claude_warn_duplicate
  say "Claude Code: installed. Start a new session to load it."
}

claude_warn_duplicate() {
  if claude mcp get mouseketool </dev/null >/dev/null 2>&1; then
    say "Claude Code also has a server named mouseketool outside the plugin; remove it with: claude mcp remove mouseketool"
  fi
}

claude_uninstall() {
  # Removing the marketplace also uninstalls the plugins it brought.
  if claude plugin marketplace list </dev/null 2>/dev/null | grep -q 'mouseketool'; then
    claude plugin marketplace remove mouseketool </dev/null
    say "Claude Code: removed."
  else
    say "Claude Code: not installed, nothing to remove."
  fi
}

# --- opencode ----------------------------------------------------------------------------------------------

# Adds or removes the server in opencode.json. Only the mcp.mouseketool key is touched; a file with comments is
# left alone, since rewriting it would drop them.
OPENCODE_CONFIG_JS='
const fs = require("node:fs");
const path = require("node:path");
const [action, file, server] = process.argv.slice(1);
let config = { $schema: "https://opencode.ai/config.json" };
if (fs.existsSync(file)) {
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    console.error(`mouseketool: ${file} is not plain JSON, so it was left as it is.`);
    process.exit(3);
  }
}
if (action === "add") {
  config.mcp = { ...config.mcp, mouseketool: { type: "local", command: ["node", server] } };
} else {
  if (config.mcp?.mouseketool === undefined) process.exit(0);
  delete config.mcp.mouseketool;
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
'

opencode_config() {
  if [ ! -f "$OPENCODE_DIR/opencode.json" ] && [ -f "$OPENCODE_DIR/opencode.jsonc" ]; then
    say "opencode: $OPENCODE_DIR/opencode.jsonc has comments, so it was left as it is."
    return 3
  fi
  node -e "$OPENCODE_CONFIG_JS" "$1" "$OPENCODE_DIR/opencode.json" "$DATA_DIR/dist/server.mjs"
}

opencode_install() {
  has tar || fail "tar is required to unpack mouseketool for opencode."

  # Unpacked next to its final place, so the swap is a rename on the same filesystem.
  mkdir -p "$(dirname "$DATA_DIR")"
  staging=$(mktemp -d "$(dirname "$DATA_DIR")/.mouseketool.XXXXXX")
  if ! curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$staging" --strip-components=1; then
    rm -rf "$staging"
    fail "could not download $REPO at $REF."
  fi
  rm -rf "$DATA_DIR"
  mv "$staging" "$DATA_DIR"

  if [ -e "$OPENCODE_SKILL" ] && [ ! -f "$OPENCODE_SKILL/$MARKER" ]; then
    say "opencode: $OPENCODE_SKILL already exists and was not installed by this script; remove it and run again."
    return 1
  fi
  rm -rf "$OPENCODE_SKILL"
  mkdir -p "$(dirname "$OPENCODE_SKILL")"
  cp -R "$DATA_DIR/skills/mouseketool" "$OPENCODE_SKILL"
  : >"$OPENCODE_SKILL/$MARKER"

  if opencode_config add; then
    say "opencode: installed. Start a new session to load it."
  else
    say "opencode: skill installed. Add this to the \"mcp\" block of your config by hand:"
    say "  \"mouseketool\": { \"type\": \"local\", \"command\": [\"node\", \"$DATA_DIR/dist/server.mjs\"] }"
  fi
}

opencode_uninstall() {
  removed=no
  if [ -f "$OPENCODE_SKILL/$MARKER" ]; then
    rm -rf "$OPENCODE_SKILL"
    removed=yes
  fi
  if [ -f "$OPENCODE_DIR/opencode.json" ]; then
    node -e "$OPENCODE_CONFIG_JS" remove "$OPENCODE_DIR/opencode.json" "" || true
  fi
  if [ -d "$DATA_DIR" ]; then
    rm -rf "$DATA_DIR"
    removed=yes
  fi
  if [ "$removed" = yes ]; then say "opencode: removed."; else say "opencode: not installed, nothing to remove."; fi
}

# --- main --------------------------------------------------------------------------------------------------

token_hint() {
  if [ -z "${MOUSEKETOOL_GITHUB_TOKEN:-}" ] && [ ! -s "${XDG_CONFIG_HOME:-$HOME/.config}/mouseketool/token" ]; then
    say "The server reads public repositories only; save a read-only token of its own in ~/.config/mouseketool/token:"
    say "  https://github.com/iDiagoValeta/mouseketool#github-token"
  fi
}

main() {
  action=install
  case "${1:-}" in
    "") ;;
    --uninstall) action=uninstall ;;
    *) fail "unknown argument \"$1\"; the only option is --uninstall." ;;
  esac

  [ "$action" = install ] && resolve_ref

  found=no
  if has claude; then
    found=yes
    [ "$action" = install ] && need_node
    "claude_$action"
  fi
  if has opencode; then
    found=yes
    need_node
    "opencode_$action"
  fi
  [ "$found" = yes ] || fail "found neither Claude Code (claude) nor opencode (opencode) on the PATH."

  [ "$action" = install ] && token_hint
  return 0
}

# Everything above is only definitions: when the script is piped into sh, nothing runs until sh has read it all.
main "$@"
