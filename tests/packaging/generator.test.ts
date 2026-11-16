import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TREE = join(ROOT, "harness", "ai-insights");
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
  const dir = mkdtempSync(join(tmpdir(), "ai-insights-gen-"));
  temps.push(dir);
  for (const path of ["package.json", "LICENSE", "scripts", "skills", "harness", ".claude-plugin", ".agents", ".cursor-plugin", "mcp.json", "assets"]) {
    if (existsSync(join(ROOT, path))) cpSync(join(ROOT, path), join(dir, path), { recursive: true });
  }
  return dir;
}

// Only the PNG header is read, so a signature and an IHDR chunk are enough to stand in for an image.
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function withIcon(dir: string, icon = png(512, 512)): void {
  rmSync(join(dir, "assets"), { recursive: true, force: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "icon.png"), icon);
  writeFileSync(join(dir, "assets", "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
}

const read = (dir: string, path: string): any => JSON.parse(readFileSync(join(dir, path), "utf8"));

describe("generated harness output", () => {
  it("is committed up to date, so CI and installs see the same skills as the source", () => {
    const result = generate(ROOT, "--check");
    expect(result.stdout + result.stderr).toContain("up to date");
    expect(result.status).toBe(0);
  });

  it("goes stale when a canonical skill changes, and regenerating fixes it", () => {
    const dir = copyRepo();
    const skill = join(dir, "skills", "analyze-ai-usage", "SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nOne more line.\n");
    const stale = generate(dir, "--check");
    expect(stale.status).toBe(1);
    expect(stale.stdout).toContain("harness/ai-insights/skills/analyze-ai-usage/SKILL.md");
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
    writeFileSync(join(dir, "harness", "ai-insights", "skills", "stray.md"), "x");
    const result = generate(dir, "--check");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("stray.md");
  });

  it("refuses a skill whose name does not match its folder", () => {
    const dir = copyRepo();
    const skill = join(dir, "skills", "ai-insights-coach", "SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8").replace("name: ai-insights-coach", "name: coach"));
    const result = generate(dir, "--check");
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL .*ai-insights-coach/);
  });

  it("copies every canonical skill into the installable tree byte for byte", () => {
    const canonical = walk(join(ROOT, "skills")).map((path) => relative(ROOT, path)).sort();
    const tree = walk(join(TREE, "skills")).map((path) => relative(TREE, path)).sort();
    expect(tree).toEqual(canonical);
    for (const path of canonical) expect(readFileSync(join(TREE, path)).equals(readFileSync(join(ROOT, path))), path).toBe(true);
  });
});

describe("plugin icon", () => {
  it("shows in every listing that has an icon field, from a copy inside the installed plugin", () => {
    const dir = copyRepo();
    withIcon(dir);
    expect(generate(dir).status).toBe(0);
    const tree = join(dir, "harness", "ai-insights");

    const claude = read(tree, ".claude-plugin/plugin.json");
    expect(claude.icon).toBe("./assets/icon.png");
    const codex = read(tree, ".codex-plugin/plugin.json");
    expect(codex.interface.logo).toBe("./assets/icon.png");
    expect(codex.interface.composerIcon).toBe("./assets/icon.svg");
    expect(read(tree, "plugin.json").extensions["com.openai"].interface).toEqual(codex.interface);
    for (const path of [claude.icon, codex.interface.logo, codex.interface.composerIcon]) {
      expect(readFileSync(join(tree, path)).equals(readFileSync(join(dir, path))), path).toBe(true);
    }
    const cursor = read(dir, ".cursor-plugin/plugin.json");
    expect(existsSync(join(dir, cursor.logo)), cursor.logo).toBe(true);

    // Claude Code's marketplace reports icon fields on an entry as unknown, and the portable schema has none.
    expect(read(dir, ".claude-plugin/marketplace.json").plugins[0]).not.toHaveProperty("icon");
    expect(read(tree, "plugin.json")).not.toHaveProperty("icon");
    expect(read(tree, "plugin.json")).not.toHaveProperty("logo");
    expect(generate(dir, "--check").status).toBe(0);
  });

  it("goes stale when the icon is added or changed, so listings never point at a missing or old image", () => {
    const dir = copyRepo();
    withIcon(dir);
    expect(generate(dir).status).toBe(0);
    writeFileSync(join(dir, "assets", "icon.png"), png(1024, 1024));
    const result = generate(dir, "--check");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("harness/ai-insights/assets/icon.png");
  });

  it("refuses an icon the Claude Code directory would reject: not a square PNG of 512 to 2048 pixels", () => {
    for (const icon of [png(512, 300), png(256, 256), png(4096, 4096), Buffer.from("<svg/>")]) {
      const dir = copyRepo();
      withIcon(dir, icon);
      const result = generate(dir);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/FAIL .*assets\/icon\.png/);
    }
  });

  it("is left out of every manifest while the repository has no icon", () => {
    const dir = copyRepo();
    rmSync(join(dir, "assets"), { recursive: true, force: true });
    expect(generate(dir).status).toBe(0);
    const tree = join(dir, "harness", "ai-insights");
    expect(read(tree, ".claude-plugin/plugin.json")).not.toHaveProperty("icon");
    expect(read(tree, ".codex-plugin/plugin.json").interface).not.toHaveProperty("logo");
    expect(read(dir, ".cursor-plugin/plugin.json")).not.toHaveProperty("logo");
    expect(existsSync(join(tree, "assets"))).toBe(false);
  });

  it("every icon the committed manifests name exists", () => {
    const paths = [
      [TREE, json("harness/ai-insights/.claude-plugin/plugin.json").icon],
      [TREE, json("harness/ai-insights/.codex-plugin/plugin.json").interface.logo],
      [TREE, json("harness/ai-insights/.codex-plugin/plugin.json").interface.composerIcon],
      [ROOT, json(".cursor-plugin/plugin.json").logo],
    ].filter(([, path]) => path !== undefined);
    for (const [base, path] of paths) expect(existsSync(join(base, path)), path).toBe(true);
  });
});

describe("manifests", () => {
  const manifests = [
    "harness/ai-insights/.claude-plugin/plugin.json",
    "harness/ai-insights/.codex-plugin/plugin.json",
    "harness/ai-insights/plugin.json",
    ".cursor-plugin/plugin.json",
  ];

  it("all name the plugin ai-insights and carry the package version", () => {
    for (const path of manifests) {
      expect(json(path).name, path).toBe("ai-insights");
      expect(json(path).version, path).toBe(pkg.version);
    }
  });

  it("launch the MCP server the same way in every harness, with no plugin-root variable", () => {
    for (const path of ["harness/ai-insights/.mcp.json", "harness/ai-insights/mcp.json", "mcp.json"]) {
      const server = json(path).mcpServers["ai-insights"];
      expect(server.command, path).toBe("npx");
      expect(server.args, path).toEqual(MCP_ARGS);
      expect(Object.keys(json(path).mcpServers), path).toEqual(["ai-insights"]);
    }
    expect(json("harness/ai-insights/mcp.json").$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  });

  it("Codex: the listing subtitle fits in 30 characters and points at skills and MCP config", () => {
    const codex = json("harness/ai-insights/.codex-plugin/plugin.json");
    expect(codex.interface.shortDescription.length).toBeLessThanOrEqual(30);
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers).toBe("./.mcp.json");
    expect(codex.interface.defaultPrompt.length).toBeLessThanOrEqual(3);
  });

  it("portable plugin.json follows Agent Plugins 1.0: schema declared, OpenAI fields under extensions", () => {
    const portable = json("harness/ai-insights/plugin.json");
    expect(portable.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    for (const key of ["skills", "mcpServers", "interface", "apps"]) expect(portable, key).not.toHaveProperty(key);
    const codex = json("harness/ai-insights/.codex-plugin/plugin.json");
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
    expect(claude.name).toBe("ai-insights");
    const [claudeEntry] = claude.plugins;
    expect(claudeEntry.name).toBe("ai-insights");
    expect(existsSync(join(ROOT, claudeEntry.source, ".claude-plugin", "plugin.json"))).toBe(true);

    const codex = json(".agents/plugins/marketplace.json");
    expect(codex.name).toBe("ai-insights");
    const [codexEntry] = codex.plugins;
    expect(codexEntry.name).toBe("ai-insights");
    expect(codexEntry.source.source).toBe("local");
    expect(codexEntry.policy).toEqual({ installation: "AVAILABLE", authentication: "ON_INSTALL" });
    expect(typeof codexEntry.category).toBe("string");
    expect(existsSync(join(ROOT, codexEntry.source.path, ".codex-plugin", "plugin.json"))).toBe(true);
  });
});
