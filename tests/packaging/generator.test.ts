import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TREE = join(ROOT, "harness", "hindsight");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string; version: string };
const MCP_ARGS = ["-y", pkg.name, "mcp"];

function json(path: string): any {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

function generate(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(root, "scripts", "generate-harness.mjs"), ...args], { encoding: "utf8" });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hindsight-gen-"));
  temps.push(dir);
  for (const path of ["package.json", "LICENSE", "scripts", "skills", "harness", ".claude-plugin", ".agents", ".cursor-plugin", "mcp.json"]) {
    cpSync(join(ROOT, path), join(dir, path), { recursive: true });
  }
  return dir;
}

describe("generated harness output", () => {
  it("is committed up to date, so CI and installs see the same skills as the source", () => {
    const result = generate(ROOT, "--check");
    expect(result.stdout + result.stderr).toContain("up to date");
    expect(result.status).toBe(0);
  });

  it("goes stale when a canonical skill changes, and regenerating fixes it", () => {
    const dir = copyRepo();
    const skill = join(dir, "skills", "hindsight", "SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nOne more line.\n");
    const stale = generate(dir, "--check");
    expect(stale.status).toBe(1);
    expect(stale.stdout).toContain("harness/hindsight/skills/hindsight/SKILL.md");
    expect(generate(dir).status).toBe(0);
    expect(generate(dir, "--check").status).toBe(0);
  });

  it("goes stale when the package version is bumped, so manifests never ship an old version", () => {
    const dir = copyRepo();
    const path = join(dir, "package.json");
    writeFileSync(path, readFileSync(path, "utf8").replace(`"version": "${pkg.version}"`, `"version": "9.9.9"`));
    expect(generate(dir, "--check").status).toBe(1);
  });

  it("flags a hand-added file inside the generated tree", () => {
    const dir = copyRepo();
    writeFileSync(join(dir, "harness", "hindsight", "skills", "stray.md"), "x");
    const result = generate(dir, "--check");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("stray.md");
  });

  it("refuses a skill whose name does not match its folder", () => {
    const dir = copyRepo();
    const skill = join(dir, "skills", "hindsight-coach", "SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8").replace("name: hindsight-coach", "name: coach"));
    const result = generate(dir, "--check");
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL .*hindsight-coach/);
  });

  it("copies every canonical skill into the installable tree byte for byte", () => {
    const canonical = walk(join(ROOT, "skills")).map((path) => relative(ROOT, path)).sort();
    const tree = walk(join(TREE, "skills")).map((path) => relative(TREE, path)).sort();
    expect(tree).toEqual(canonical);
    for (const path of canonical) expect(readFileSync(join(TREE, path)).equals(readFileSync(join(ROOT, path))), path).toBe(true);
  });
});

describe("manifests", () => {
  const manifests = [
    "harness/hindsight/.claude-plugin/plugin.json",
    "harness/hindsight/.codex-plugin/plugin.json",
    "harness/hindsight/plugin.json",
    ".cursor-plugin/plugin.json",
  ];

  it("all name the plugin hindsight and carry the package version", () => {
    for (const path of manifests) {
      expect(json(path).name, path).toBe("hindsight");
      expect(json(path).version, path).toBe(pkg.version);
    }
  });

  it("launch the MCP server the same way in every harness, with no plugin-root variable", () => {
    for (const path of ["harness/hindsight/.mcp.json", "harness/hindsight/mcp.json", "mcp.json"]) {
      const server = json(path).mcpServers.hindsight;
      expect(server.command, path).toBe("npx");
      expect(server.args, path).toEqual(MCP_ARGS);
      expect(Object.keys(json(path).mcpServers), path).toEqual(["hindsight"]);
    }
    expect(json("harness/hindsight/mcp.json").$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  });

  it("Codex: the listing subtitle fits in 30 characters and points at skills and MCP config", () => {
    const codex = json("harness/hindsight/.codex-plugin/plugin.json");
    expect(codex.interface.shortDescription.length).toBeLessThanOrEqual(30);
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers).toBe("./.mcp.json");
    expect(codex.interface.defaultPrompt.length).toBeLessThanOrEqual(3);
  });

  it("portable plugin.json follows Agent Plugins 1.0: schema declared, OpenAI fields under extensions", () => {
    const portable = json("harness/hindsight/plugin.json");
    expect(portable.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    for (const key of ["skills", "mcpServers", "interface", "apps"]) expect(portable, key).not.toHaveProperty(key);
    const codex = json("harness/hindsight/.codex-plugin/plugin.json");
    expect(portable.extensions["com.openai"].interface).toEqual(codex.interface);
    expect(portable.description).toBe(codex.description);
  });

  it("Cursor: only fields the Cursor manifest schema allows, pointing at the root skills and mcp.json", () => {
    const cursor = json(".cursor-plugin/plugin.json");
    const allowed = new Set([
      "name", "displayName", "description", "version", "minClientVersions", "author", "publisher", "homepage",
      "repository", "license", "logo", "keywords", "category", "tags", "commands", "agents", "skills", "rules",
      "hooks", "variables", "mcpServers",
    ]);
    for (const key of Object.keys(cursor)) expect(allowed, key).toContain(key);
    expect(cursor.skills).toBe("./skills/");
    expect(cursor.mcpServers).toBe("./mcp.json");
  });

  it("marketplaces resolve to a directory holding the Claude Code and Codex manifests", () => {
    const claude = json(".claude-plugin/marketplace.json");
    expect(claude.name).toBe("hindsight");
    const [claudeEntry] = claude.plugins;
    expect(claudeEntry.name).toBe("hindsight");
    expect(existsSync(join(ROOT, claudeEntry.source, ".claude-plugin", "plugin.json"))).toBe(true);

    const codex = json(".agents/plugins/marketplace.json");
    expect(codex.name).toBe("hindsight");
    const [codexEntry] = codex.plugins;
    expect(codexEntry.name).toBe("hindsight");
    expect(codexEntry.source.source).toBe("local");
    expect(codexEntry.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
    expect(typeof codexEntry.category).toBe("string");
    expect(existsSync(join(ROOT, codexEntry.source.path, ".codex-plugin", "plugin.json"))).toBe(true);
  });
});
