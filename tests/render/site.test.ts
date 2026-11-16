import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The website is its own Next app in site/. These checks read its sources and committed files;
// they do not build it. The Pages build runs site/scripts/check-export.mjs on the real export.
const ROOT = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...sources(path));
    else if (/\.(tsx?|css|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const SITE_SOURCES = ["site/app", "site/components", "site/hooks", "site/lib"].flatMap(sources);

describe("the public site", () => {
  it("is a static export served from /hindsight, kept out of the package build and tests", () => {
    const config = read("site/next.config.ts");
    expect(config).toContain('output: "export"');
    expect(config).toContain('"/hindsight"');
    const root = JSON.parse(read("package.json"));
    expect(root.files.some((entry: string) => entry.startsWith("site"))).toBe(false);
    expect(JSON.parse(read("tsconfig.json")).include).toEqual(["src", "tests"]);
    expect(Object.keys({ ...root.dependencies, ...root.devDependencies })).not.toContain("next");
  });

  it("loads nothing from other hosts: no remote scripts, styles, fonts or analytics", () => {
    const site = JSON.parse(read("site/package.json"));
    const deps = Object.keys({ ...site.dependencies, ...site.devDependencies });
    expect(deps.filter((name) => /analytics|posthog|plausible|segment|gtag|sentry|vercel\/speed/i.test(name))).toEqual([]);
    for (const path of SITE_SOURCES) {
      const text = read(path);
      expect(text, path).not.toMatch(/next\/font\/google|fetch\(\s*["'`]https?:|<script[^>]+src=["'`]https?:|@import\s+url\(\s*["']?https?:|url\(\s*["']?https?:/);
    }
    expect(read("site/package.json")).toContain("scripts/check-export.mjs");
  });

  it("deploys the export from site/out with the /hindsight base path", () => {
    const workflow = read(".github/workflows/pages.yml");
    expect(workflow).toContain("working-directory: site");
    expect(workflow).toContain("PAGES_BASE_PATH: /hindsight");
    expect(workflow).toContain("path: site/out");
    expect(workflow).toContain("actions/deploy-pages");
  });

  it("keeps the README's links working: the sample report, the screenshot and the light and dark shots", () => {
    expect(existsSync(join(ROOT, "site/public/demo/report.html"))).toBe(true);
    expect(existsSync(join(ROOT, "assets/report.png"))).toBe(true);
    for (const id of [...read("site/components/site/report-shots.tsx").matchAll(/id: "([a-z]+)"/g)].map((match) => match[1]!)) {
      for (const theme of ["light", "dark"]) expect(existsSync(join(ROOT, `site/public/assets/shot-${id}-${theme}.png`)), `${id} ${theme}`).toBe(true);
    }
    for (const file of ["site/public/og.png", "site/public/llms.txt", "site/app/icon.svg"]) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });

  it("gives the README's install commands and claims only the history Hindsight reads today", () => {
    const install = read("site/components/site/install.tsx");
    const readme = read("README.md");
    for (const line of ["/plugin marketplace add hamedmp/hindsight", "/plugin install hindsight@hindsight", "codex plugin marketplace add hamedmp/hindsight", "codex plugin add hindsight@hindsight", "scripts/install.sh --harness cursor", "pi install git:github.com/hamedmp/hindsight", "scripts/install.sh --harness opencode"]) {
      expect(install, line).toContain(line);
      expect(readme, line).toContain(line);
    }
    expect(install).toContain("does not read their own history yet");
    const page = read("site/app/page.tsx");
    expect(page).toContain("Claude Code, Codex");
    expect(page).not.toMatch(/Cursor|OpenCode/);
  });

  it("ships a sample report and site data built from invented sessions, with nothing from the machine that built them", () => {
    const name = userInfo().username;
    for (const path of ["site/public/demo/report.html", "site/lib/demo.json", "site/public/llms.txt"]) {
      const text = read(path);
      expect(text, path).not.toContain(homedir());
      if (name.length >= 3) expect(text, path).not.toMatch(new RegExp(`[/\\\\]${name}[/\\\\]`));
      expect(text, path).not.toMatch(/[\w.+-]+@[\w-]+\.(?:com|org|net|io|ai|dev)\b/i);
    }
    expect(read("site/public/demo/report.html")).toContain("acme-api");
    const data = JSON.parse(read("site/lib/demo.json"));
    expect(data.note).toMatch(/invented sessions/);
    expect(read("site/public/demo/report.html")).toContain(`<b>${data.numbers.sessions} sessions</b>`);
  });

  it("shows only changes the sample report gives, with the text to paste exactly as it appears there", () => {
    const report = read("site/public/demo/report.html");
    const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const { payoff } = JSON.parse(read("site/lib/demo.json"));
    expect(payoff.length).toBe(3);
    for (const tip of payoff) {
      expect(report, tip.title).toContain(`id="${tip.anchor}"`);
      expect(report, tip.title).toContain(escape(tip.paste.text));
    }
    expect(read("site/components/site/tips.tsx")).toContain("demo.payoff");
  });
});
