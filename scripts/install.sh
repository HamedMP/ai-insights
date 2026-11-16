#!/usr/bin/env bash
# Installs the AI Insights skills and registers its MCP server with each AI coding agent found on this machine.
# Use it when a harness has no plugin install, or to set several up at once. Safe to re-run.
set -euo pipefail

SERVER=ai-insights
PACKAGE=ai-insights
MCP_CMD=(npx -y "$PACKAGE" mcp)
SKILLS_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/skills"
ALL=(claude-code codex cursor opencode pi)

usage() {
  cat <<EOF
Usage: scripts/install.sh [--all | --harness <name>]... [--dry-run]

Copies the AI Insights skills into each harness's skills folder and registers the
"$SERVER" MCP server (${MCP_CMD[*]}). Runs as you, without root; touches only your home folder.

  --all              every harness found on this machine (the default)
  --harness <name>   only this harness; repeatable. One of: ${ALL[*]}
  --dry-run          print what would happen, change nothing
  -h, --help         show this help
EOF
}

DRY=0
WANTED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --all) shift ;;
    --harness)
      [ $# -ge 2 ] || { usage; exit 2; }
      case " ${ALL[*]} " in *" $2 "*) WANTED+=("$2") ;; *) echo "Unknown harness: $2"; usage; exit 2 ;; esac
      shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 2 ;;
  esac
done
EXPLICIT=${#WANTED[@]}
[ "$EXPLICIT" -gt 0 ] || WANTED=("${ALL[@]}")

FAILED=0
SKILL_DIRS_DONE=" "
say() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; FAILED=1; }

found() {
  case "$1" in
    claude-code) command -v claude >/dev/null 2>&1 ;;
    codex) command -v codex >/dev/null 2>&1 ;;
    cursor) command -v cursor >/dev/null 2>&1 || command -v cursor-agent >/dev/null 2>&1 || [ -d "$HOME/.cursor" ] ;;
    opencode) command -v opencode >/dev/null 2>&1 ;;
    pi) command -v pi >/dev/null 2>&1 ;;
  esac
}

# Replaces only the folders of the skills shipped here, so the person's other skills are never touched.
copy_skills() {
  local dest="$1"
  case "$SKILL_DIRS_DONE" in *" $dest "*) say "skills: already handled in $dest"; return ;; esac
  SKILL_DIRS_DONE="$SKILL_DIRS_DONE$dest "
  local src name
  # Skills from before 0.2 (hindsight, hindsight-coach, hindsight-setup) are left in place; they are the person's to remove.
  if [ -d "$dest/hindsight" ]; then say "note: $dest still has the pre-0.2 hindsight skills; remove $dest/hindsight* once you no longer need them"; fi
  for src in "$SKILLS_SRC"/*/; do
    name="$(basename "$src")"
    if [ -d "$dest/$name" ] && diff -r "$src" "$dest/$name" >/dev/null 2>&1; then
      say "skill $name: up to date in $dest"
    elif [ "$DRY" = 1 ]; then
      say "would copy skill $name to $dest/$name"
    else
      mkdir -p "$dest"
      rm -rf "${dest:?}/$name"
      cp -R "$src" "$dest/$name"
      say "skill $name: copied to $dest/$name"
    fi
  done
}

# Registers through the harness's own `mcp add`, after `probe` shows it is not there yet.
register() {
  local label="$1" probe="$2"; shift 2
  if eval "$probe" >/dev/null 2>&1; then
    say "MCP server $SERVER: already registered with $label"
  elif [ "$DRY" = 1 ]; then
    say "would run: $*"
  elif "$@" </dev/null >/dev/null 2>&1; then
    say "MCP server $SERVER: registered with $label ($*)"
  else
    return 1
  fi
}

cursor_mcp() {
  local config="$HOME/.cursor/mcp.json"
  local snippet="\"$SERVER\": {\"command\": \"npx\", \"args\": [\"-y\", \"$PACKAGE\", \"mcp\"]}"
  if ! command -v node >/dev/null 2>&1; then
    warn "node not found; add this under \"mcpServers\" in $config: $snippet"
    return
  fi
  local status
  status=$(DRY="$DRY" CONFIG="$config" SERVER="$SERVER" PACKAGE="$PACKAGE" node -e '
    const fs = require("node:fs"), path = require("node:path");
    const { CONFIG: file, SERVER: name, PACKAGE: pkg, DRY: dry } = process.env;
    let config = {};
    if (fs.existsSync(file)) {
      try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { console.log("invalid"); process.exit(0); }
      if (!config || typeof config !== "object" || Array.isArray(config)) { console.log("invalid"); process.exit(0); }
    }
    config.mcpServers ??= {};
    if (config.mcpServers[name]) { console.log("present"); process.exit(0); }
    if (dry === "1") { console.log("would"); process.exit(0); }
    config.mcpServers[name] = { command: "npx", args: ["-y", pkg, "mcp"] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.ai-insights-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
    fs.renameSync(tmp, file);
    console.log("added");
  ')
  case "$status" in
    present) say "MCP server $SERVER: already registered in $config" ;;
    would) say "would add $SERVER to $config" ;;
    added) say "MCP server $SERVER: added to $config" ;;
    *) warn "$config is not valid JSON, so it was left alone; add this under \"mcpServers\": $snippet" ;;
  esac
}

install_one() {
  case "$1" in
    claude-code)
      copy_skills "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
      register "Claude Code" "claude mcp get $SERVER" claude mcp add --scope user "$SERVER" -- "${MCP_CMD[@]}" ||
        warn "claude mcp add failed; run: claude mcp add --scope user $SERVER -- ${MCP_CMD[*]}"
      say "tip: the Claude Code plugin (/plugin marketplace add hamedmp/ai-insights, then /plugin install ai-insights@ai-insights) does the same; use one or the other" ;;
    codex)
      copy_skills "$HOME/.agents/skills"
      register "Codex" "codex mcp get $SERVER" codex mcp add "$SERVER" -- "${MCP_CMD[@]}" ||
        warn "codex mcp add failed; run: codex mcp add $SERVER -- ${MCP_CMD[*]}" ;;
    cursor)
      copy_skills "$HOME/.cursor/skills"
      cursor_mcp ;;
    opencode)
      copy_skills "$HOME/.agents/skills"
      register "OpenCode" "opencode mcp list | grep -qw $SERVER" opencode mcp add "$SERVER" -- "${MCP_CMD[@]}" ||
        warn "opencode mcp add failed; add to opencode.json: \"mcp\": {\"$SERVER\": {\"type\": \"local\", \"command\": [\"npx\", \"-y\", \"$PACKAGE\", \"mcp\"]}}" ;;
    pi)
      copy_skills "$HOME/.pi/agent/skills"
      say "Pi has no MCP command line; for the MCP tools run: pi install git:github.com/hamedmp/ai-insights" ;;
  esac
}

[ -d "$SKILLS_SRC" ] || { echo "Cannot find the skills folder at $SKILLS_SRC"; exit 1; }
[ "$DRY" = 1 ] && echo "Dry run: nothing will be changed."

DONE=0
for harness in "${WANTED[@]}"; do
  if ! found "$harness"; then
    if [ "$EXPLICIT" -gt 0 ]; then echo "$harness: not found on this machine"; FAILED=1; else echo "$harness: not found, skipped"; fi
    continue
  fi
  echo "$harness:"
  install_one "$harness"
  DONE=$((DONE + 1))
done

echo
if [ "$DONE" = 0 ]; then
  echo "No supported harness was set up."
  exit 1
fi
echo "Restart your agent, or open a new session, so it picks up the skills and the MCP server. Then ask it to analyze your AI usage (/analyze-ai-usage)."
echo "AI Insights reads your history on this machine only; the analysis runs in your own agent and nothing is uploaded."
exit "$FAILED"
