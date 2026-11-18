#!/usr/bin/env bash
# <xbar.title>AI Insights</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>AI Insights</xbar.author>
# <xbar.desc>This week's AI coding-agent sessions in the menu bar, with today, this month and one tip. Local only.</xbar.desc>
# <xbar.dependencies>node,ai-insights</xbar.dependencies>
# <xbar.abouturl>https://ai-insights.app/docs/desktop#menu-bar-scripts</xbar.abouturl>
# <xbar.var>boolean(AI_INSIGHTS_HIDE_COST=false): Leave estimated cost out of the menu.</xbar.var>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisappearItems>true</swiftbar.hideDisappearItems>
#
# A SwiftBar / xbar plugin for AI Insights. Copy it into your plugin folder yourself; AI Insights never
# installs it. It runs your installed `ai-insights` CLI (npm i -g ai-insights), never npx, so it makes no
# network requests. The "30m" in the file name is the refresh interval. Delete the file to remove it.

set -u

# Menu bar apps start plugins with a short PATH; ask the login shell for the one your terminal uses.
if [ -z "${AI_INSIGHTS_PLUGIN_PATH_DONE:-}" ]; then
  login_path=$("${SHELL:-/bin/zsh}" -lc 'printf %s "$PATH"' 2>/dev/null || true)
  export PATH="${login_path:+$login_path:}$PATH:/opt/homebrew/bin:/usr/local/bin"
  export AI_INSIGHTS_PLUGIN_PATH_DONE=1
fi

cli="${AI_INSIGHTS_CLI:-$(command -v ai-insights || true)}"
if [ -z "$cli" ] || ! command -v node >/dev/null 2>&1; then
  echo "AI ?"
  echo "---"
  echo "AI Insights CLI not found"
  echo "Install it in a terminal: npm i -g ai-insights | font=Menlo"
  echo "How this plugin works | href=https://ai-insights.app/docs/desktop#menu-bar-scripts"
  exit 0
fi

# Runs a command with a deadline, so a slow scan never stacks up behind the next refresh.
with_deadline() {
  local seconds=$1
  shift
  "$@" &
  local pid=$!
  ( sleep "$seconds" && kill "$pid" 2>/dev/null ) &
  local watchdog=$!
  wait "$pid"
  local status=$?
  pkill -P "$watchdog" 2>/dev/null
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return $status
}

if [ "${1:-}" = "open-report" ]; then
  report=$(with_deadline 120 "$cli" summary --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s.slice(s.indexOf("{"))).reportPath;if(typeof p==="string"&&p.endsWith(".html"))process.stdout.write(p)}catch{}})')
  if [ -z "$report" ] || [ ! -f "$report" ]; then
    with_deadline 300 "$cli" report --no-open --no-install-prompt >/dev/null 2>&1
    report=$(with_deadline 120 "$cli" summary --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s.slice(s.indexOf("{"))).reportPath;if(typeof p==="string"&&p.endsWith(".html"))process.stdout.write(p)}catch{}})')
  fi
  [ -n "$report" ] && [ -f "$report" ] && open "$report"
  exit 0
fi

json=$(AI_INSIGHTS_NO_INSTALL_PROMPT=1 with_deadline 120 "$cli" summary --json 2>/dev/null)

# Formatting in Node (already required by the CLI); the JSON is read leniently, as the desktop app does.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" HIDE_COST="${AI_INSIGHTS_HIDE_COST:-false}" node -e '
let raw = require("fs").readFileSync(0, "utf8");
let data = null;
try { data = JSON.parse(raw.slice(raw.indexOf("{"))); } catch {}
const out = (line) => process.stdout.write(line + "\n");
const clean = (s, max) => String(s).replace(/\s+/g, " ").replace(/\|/g, "/").trim().slice(0, max);
if (!data || typeof data !== "object") {
  out("AI !"); out("---"); out("AI Insights could not read your history just now");
  out("Run ai-insights summary in a terminal to see why | font=Menlo");
  out("Refresh | refresh=true");
  process.exit(0);
}
const hideCost = /^(1|true|yes)$/i.test(process.env.HIDE_COST || "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const count = (v) => (num(v) === null ? "–" : Math.round(v).toLocaleString("en-US"));
const hours = (m) => (num(m) === null ? "–" : m < 60 ? `${Math.round(m)} min` : m / 60 < 100 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 60)} h`);
const cost = (v) => (num(v) === null ? null : v >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`);
const periods = (data.periods && typeof data.periods === "object") ? data.periods : {};
const week = periods.week || {};
out(`AI ${count(week.sessions)}`);
out("---");
for (const [key, label] of [["today", "Today"], ["week", "This week"], ["month", "This month"]]) {
  const p = periods[key];
  if (!p || typeof p !== "object") continue;
  const parts = [`${count(p.sessions)} sessions`, hours(p.activeMinutes)];
  const c = cost(p.costUsd);
  if (!hideCost && c) parts.push(`≈ ${c}`);
  out(`${label}: ${parts.join(" · ")} | font=Menlo`);
}
const tip = ["week", "today", "month"].map((k) => periods[k] && periods[k].tip && periods[k].tip.text).find((t) => typeof t === "string" && t.trim());
if (tip) {
  out("---");
  const words = clean(tip, 400).split(" ");
  let line = "Tip: ";
  for (const w of words) {
    if ((line + w).length > 60) { out(line.trimEnd()); line = "  "; }
    line += w + " ";
  }
  out(line.trimEnd());
}
out("---");
out(`Open full report | bash="${process.env.SELF.replace(/"/g, "")}" param1=open-report terminal=false`);
out("Refresh | refresh=true");
if (!hideCost) out("Cost is estimated from public API prices | size=11");
' <<< "$json"
