import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const SITE = "https://ai-insights.app/";

describe("npm package", () => {
  it("points people at the site and the issue tracker", () => {
    expect(pkg.homepage).toBe(SITE);
    expect(pkg.bugs.url).toBe("https://github.com/HamedMP/ai-insights/issues");
  });

  it("cannot be published without passing every check and a fresh build", () => {
    expect(pkg.scripts.prepublishOnly).toBe("pnpm check && pnpm build");
  });

  it("starts the MCP server from the bin that `npx -y <package> mcp` runs", () => {
    // With more than one bin, npx runs the one named after the (unscoped) package.
    const bin = pkg.bin[pkg.name.split("/").pop()];
    expect(bin).toBe("dist/cli/main.js");
    // Installs from before the rename to AI Insights still type `hindsight`; it is the same file.
    expect(pkg.bin.hindsight).toBe(bin);
    const cli = readFileSync(join(ROOT, "src", "cli", "main.ts"), "utf8");
    expect(cli.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(cli).toMatch(/COMMANDS = new Set\(\[[^\]]*"mcp"/);
    const mcp = JSON.parse(readFileSync(join(ROOT, "harness", "ai-insights", ".mcp.json"), "utf8")).mcpServers["ai-insights"];
    expect([mcp.command, ...mcp.args]).toEqual(["npx", "-y", pkg.name, "mcp"]);
  });

  it("describes only the history sources that are parsed today", () => {
    expect(pkg.description).toContain("Claude Code and Codex");
    expect(pkg.description).not.toMatch(/Cursor|OpenCode|\bPi\b/);
  });

  it("ships the CLI, MCP server, skills and Pi extension, and no tests, briefs, images or source maps", () => {
    const env = { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].join(delimiter) };
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    // npm 11 prints an array of packages; npm 12 prints an object keyed by package name.
    const packed = JSON.parse(result.stdout);
    const entry: { files: { path: string }[] } = Array.isArray(packed) ? packed[0] : (packed[pkg.name] ?? Object.values(packed)[0]);
    const files: string[] = entry.files.map((file) => file.path);

    for (const path of ["package.json", "README.md", "LICENSE", "pi/extension.ts"]) expect(files).toContain(path);
    for (const skill of ["analyze-ai-usage", "ai-insights-coach", "ai-insights-setup"]) expect(files).toContain(`skills/${skill}/SKILL.md`);
    // CI runs the tests before the build, so the compiled files are only listed once dist/ exists.
    if (existsSync(join(ROOT, "dist", "cli", "main.js"))) {
      expect(files).toContain("dist/cli/main.js");
      expect(files).toContain("dist/index.d.ts");
    }
    const unwanted = files.filter((path) => /^(src|tests|docs|assets|site|harness|scripts|node_modules)\/|\.map$|\.(png|jpe?g|gif|webp)$/.test(path));
    expect(unwanted).toEqual([]);
  });
});

describe("README", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  it("shows the report screenshot near the top from an absolute URL, so it also renders on npm", () => {
    const top = readme.split("\n").slice(0, 12).join("\n");
    expect(top).toContain("https://raw.githubusercontent.com/hamedmp/ai-insights/main/assets/report.png");
    expect(readme).not.toMatch(/!\[[^\]]*\]\((?!https:\/\/)/);
  });

  it("links the site and the sample report", () => {
    expect(readme).toContain(SITE);
    expect(readme).toContain("https://ai-insights.app/demo/report.html");
  });

  it("tells people who know the old name where it went", () => {
    const top = readme.split("\n").slice(0, 12).join("\n");
    expect(top).toContain("AI Insights was called Hindsight until v0.2; `@matrix-os/hindsight` is deprecated in favour of `ai-insights`.");
  });

  it("says plainly which history is parsed and which installs are untested", () => {
    expect(readme).toMatch(/Claude Code and Codex/);
    for (const harness of ["Cursor", "Pi", "OpenCode"]) {
      const line = readme.split("\n").find((text) => text.startsWith(`**${harness}**`));
      expect(line, harness).toMatch(/untested/i);
    }
    expect(readme).not.toMatch(/placeholder|coming soon/i);
  });
});
