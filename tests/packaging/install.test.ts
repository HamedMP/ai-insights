import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "install.sh");
const MCP = "npx -y @matrix-os/hindsight mcp";
const SKILLS = ["hindsight", "hindsight-coach", "hindsight-setup"];

// A fake harness CLI that records every call and remembers servers added with `mcp add`.
const STUB = `#!/bin/sh
name=$(basename "$0")
echo "$name $*" >> "$STUB_LOG"
state="$STUB_STATE/$name"
if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then [ -f "$state" ] && exit 0 || exit 1; fi
if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then [ -f "$state" ] && echo "hindsight"; exit 0; fi
if [ "$1" = "mcp" ] && [ "$2" = "add" ]; then touch "$state"; exit 0; fi
exit 0
`;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(harnesses: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "hindsight-install-"));
  temps.push(dir);
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  for (const path of [home, bin, state]) mkdirSync(path, { recursive: true });
  for (const name of harnesses) {
    writeFileSync(join(bin, name), STUB);
    chmodSync(join(bin, name), 0o755);
  }
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const run = (...args: string[]) =>
    spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        HOME: home,
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        STUB_LOG: log,
        STUB_STATE: state,
      },
    });
  const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  return { home, run, calls };
}

describe("scripts/install.sh", () => {
  it("installs skills and registers the MCP server for each harness it finds", () => {
    const { home, run, calls } = sandbox(["claude", "codex"]);
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    for (const skill of SKILLS) {
      expect(existsSync(join(home, ".claude", "skills", skill, "SKILL.md")), skill).toBe(true);
      expect(existsSync(join(home, ".agents", "skills", skill, "SKILL.md")), skill).toBe(true);
    }
    expect(calls()).toContain(`claude mcp add --scope user hindsight -- ${MCP}`);
    expect(calls()).toContain(`codex mcp add hindsight -- ${MCP}`);
    expect(result.stdout).toMatch(/cursor.*not found/i);
  });

  it("is safe to re-run: nothing is registered twice and skills are left as they are", () => {
    const { run, calls } = sandbox(["claude", "codex"]);
    run();
    const second = run();
    expect(second.status).toBe(0);
    expect(calls().filter((call) => call.includes("mcp add"))).toHaveLength(2);
    expect(second.stdout).toMatch(/already registered/);
    expect(second.stdout).toMatch(/up to date/);
  });

  it("refreshes an older copy of a skill", () => {
    const { home, run } = sandbox(["codex"]);
    const stale = join(home, ".agents", "skills", "hindsight");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "SKILL.md"), "old");
    writeFileSync(join(stale, "leftover.md"), "old");
    expect(run("--harness", "codex").status).toBe(0);
    expect(readFileSync(join(stale, "SKILL.md"), "utf8")).toBe(readFileSync(join(ROOT, "skills", "hindsight", "SKILL.md"), "utf8"));
    expect(existsSync(join(stale, "leftover.md"))).toBe(false);
  });

  it("fails clearly when the requested harness is not installed", () => {
    const { run, calls } = sandbox([]);
    const result = run("--harness", "opencode");
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/opencode.*not found/i);
    expect(calls()).toEqual([]);
  });

  it("adds hindsight to Cursor's mcp.json without touching the servers already there", () => {
    const { home, run } = sandbox([]);
    const config = join(home, ".cursor", "mcp.json");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ mcpServers: { other: { command: "other-server" } } }));
    expect(run("--harness", "cursor").status).toBe(0);
    const merged = JSON.parse(readFileSync(config, "utf8"));
    expect(merged.mcpServers.other).toEqual({ command: "other-server" });
    expect(merged.mcpServers.hindsight).toEqual({ command: "npx", args: ["-y", "@matrix-os/hindsight", "mcp"] });
    expect(existsSync(join(home, ".cursor", "skills", "hindsight", "SKILL.md"))).toBe(true);
    const before = readFileSync(config, "utf8");
    expect(run("--harness", "cursor").stdout).toMatch(/already registered/);
    expect(readFileSync(config, "utf8")).toBe(before);
  });

  it("leaves an unreadable Cursor mcp.json alone and tells the person what to add", () => {
    const { home, run } = sandbox([]);
    const config = join(home, ".cursor", "mcp.json");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, "{ not json");
    const result = run("--harness", "cursor");
    expect(result.status).toBe(1);
    expect(readFileSync(config, "utf8")).toBe("{ not json");
    expect(result.stdout).toContain('"hindsight"');
  });

  it("--dry-run changes nothing", () => {
    const { home, run, calls } = sandbox(["claude"]);
    const result = run("--dry-run");
    expect(result.status).toBe(0);
    expect(existsSync(join(home, ".claude", "skills"))).toBe(false);
    expect(calls().filter((call) => call.includes("mcp add"))).toEqual([]);
    expect(result.stdout).toMatch(/would/i);
  });

  it("rejects unknown arguments with usage", () => {
    const { run } = sandbox([]);
    const result = run("--harness", "vim");
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(/usage/i);
  });

  it("never escalates privileges or fetches and runs remote scripts", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).not.toMatch(/\bsudo\b/);
    expect(text).not.toMatch(/\b(curl|wget)\b/);
  });
});
