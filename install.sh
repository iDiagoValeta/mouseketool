#!/bin/sh
# Installs mouseketool for every supported agent found on this machine, Claude Code and opencode:
#
#   curl -fsSL https://raw.githubusercontent.com/iDiagoValeta/mouseketool/main/install.sh | sh
#
# and removes it again:
#
#   curl -fsSL https://raw.githubusercontent.com/iDiagoValeta/mouseketool/main/install.sh | sh -s -- --uninstall
#
# Claude Code gets the repository as a plugin, through its own marketplace commands. opencode gets a copy of the
# repository in $XDG_DATA_HOME/mouseketool, the skill linked into its skills directory and the server added to
# its opencode.json. Running it again updates both.
set -eu

REPO="iDiagoValeta/mouseketool"
# A branch to install from instead of main, to try a change before it is merged.
REF="${MOUSEKETOOL_REF:-main}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/mouseketool"
OPENCODE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
OPENCODE_SKILL="$OPENCODE_DIR/skills/mouseketool"

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

# --- Claude Code -------------------------------------------------------------------------------------------

claude_marketplace() {
  if [ "$REF" = main ]; then echo "$REPO"; else echo "https://github.com/$REPO.git#$REF"; fi
}

claude_install() {
  # HTTPS needs no GitHub SSH key, and the repository is public.
  export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1
  if claude plugin list </dev/null 2>/dev/null | grep -q 'mouseketool@mouseketool'; then
    claude plugin marketplace update mouseketool </dev/null
    claude plugin update mouseketool@mouseketool </dev/null
  else
    claude plugin install mouseketool --marketplace "$(claude_marketplace)" </dev/null
  fi
  if claude mcp get mouseketool </dev/null >/dev/null 2>&1; then
    say "Claude Code also has a server named mouseketool outside the plugin; remove it with: claude mcp remove mouseketool"
  fi
  say "Claude Code: installed. Start a new session to load it."
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
  has curl || fail "curl is required to download mouseketool for opencode."
  has tar || fail "tar is required to unpack mouseketool for opencode."

  # Unpacked next to its final place, so the swap is a rename on the same filesystem.
  mkdir -p "$(dirname "$DATA_DIR")"
  staging=$(mktemp -d "$(dirname "$DATA_DIR")/.mouseketool.XXXXXX")
  if ! curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" | tar -xz -C "$staging" --strip-components=1; then
    rm -rf "$staging"
    fail "could not download $REPO at $REF."
  fi
  rm -rf "$DATA_DIR"
  mv "$staging" "$DATA_DIR"

  if [ -e "$OPENCODE_SKILL" ] && [ ! -L "$OPENCODE_SKILL" ]; then
    say "opencode: $OPENCODE_SKILL already exists and is not a link this script made; remove it and run again."
    return 1
  fi
  mkdir -p "$(dirname "$OPENCODE_SKILL")"
  ln -sfn "$DATA_DIR/skills/mouseketool" "$OPENCODE_SKILL"

  if opencode_config add; then
    say "opencode: installed. Start a new session to load it."
  else
    say "opencode: skill installed. Add this to the \"mcp\" block of your config by hand:"
    say "  \"mouseketool\": { \"type\": \"local\", \"command\": [\"node\", \"$DATA_DIR/dist/server.mjs\"] }"
  fi
}

opencode_uninstall() {
  removed=no
  if [ -L "$OPENCODE_SKILL" ]; then
    rm "$OPENCODE_SKILL"
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
  if [ -z "${GITHUB_TOKEN:-}" ] && ! { has gh && gh auth token >/dev/null 2>&1; }; then
    say "The server needs a GitHub token when it runs: set GITHUB_TOKEN or run \"gh auth login\"."
  fi
}

main() {
  action=install
  case "${1:-}" in
    "") ;;
    --uninstall) action=uninstall ;;
    *) fail "unknown argument \"$1\"; the only option is --uninstall." ;;
  esac

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
