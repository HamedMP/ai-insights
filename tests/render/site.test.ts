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

/** The data block the sample report's page renders from. */
function pageData(html: string): { hero: { sessions: number }; actions: Record<"top" | "rest", Array<{ anchor: string; instructionText: string | null; snippet: { text: string } | null }>> } {
  return JSON.parse(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!);
}

describe("the public site", () => {
  it("is a static export served from /ai-insights, kept out of the package build and tests", () => {
    const config = read("site/next.config.ts");
    expect(config).toContain('output: "export"');
    expect(config).toContain('"/ai-insights"');
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

  it("deploys the export from site/out with the /ai-insights base path", () => {
    const workflow = read(".github/workflows/pages.yml");
    expect(workflow).toContain("working-directory: site");
    expect(workflow).toContain("PAGES_BASE_PATH: /ai-insights");
    expect(workflow).toContain("path: site/out");
    expect(workflow).toContain("actions/deploy-pages");
  });

  it("keeps the README's pictures and the site's media in place", () => {
    expect(existsSync(join(ROOT, "site/public/demo/report.html"))).toBe(true);
    for (const file of ["assets/report.png", "assets/recap.gif", "site/public/og.png", "site/public/llms.txt", "site/app/icon.svg", "site/public/media/rabbit.svg"]) expect(existsSync(join(ROOT, file)), file).toBe(true);
    const media = JSON.parse(read("site/lib/media.json"));
    for (const file of [media.video.file, media.video.poster]) expect(existsSync(join(ROOT, "site/public", file)), file).toBe(true);
    for (const [style, cards] of Object.entries(media.wall as Record<string, string[]>)) for (const card of cards) expect(existsSync(join(ROOT, `site/public/media/card-${style}-${card}.webp`)), `${style} ${card}`).toBe(true);
    for (const [style, card] of media.trio as Array<[string, string]>) expect(existsSync(join(ROOT, `site/public/media/card-${style}-${card}.webp`)), `${style} ${card}`).toBe(true);
    const readme = read("README.md");
    for (const match of readme.matchAll(/raw\.githubusercontent\.com\/hamedmp\/ai-insights\/main\/([\w./-]+)/g)) expect(existsSync(join(ROOT, match[1]!)), match[1]).toBe(true);
  });

  it("shows live cards from the product's own engine, built from the sample report at build time", () => {
    const site = JSON.parse(read("site/package.json"));
    expect(site.scripts.build).toMatch(/^node scripts\/build-embed\.mjs && next build/);
    expect(site.scripts.dev).toContain("scripts/build-embed.mjs");
    const embed = read("site/scripts/build-embed.mjs");
    expect(embed).toContain("public/demo/report.html");
    expect(read("site/.gitignore")).toContain("/public/demo/cards.html");
    expect(read("site/components/site/live-card.tsx")).toContain("demo/cards.html");
    const media = JSON.parse(read("site/lib/media.json"));
    expect(media.styles.map((style: { id: string }) => style.id)).toEqual(["pop", "panel", "sticker"]);
  });

  it("gives the README's install commands and states each agent's status as the README does", () => {
    const install = read("site/components/site/install.tsx");
    const readme = read("README.md");
    for (const line of ["/plugin marketplace add hamedmp/ai-insights", "/plugin install ai-insights@ai-insights", "codex plugin marketplace add hamedmp/ai-insights", "codex plugin add ai-insights@ai-insights", "scripts/install.sh --harness cursor", "pi install git:github.com/hamedmp/ai-insights", "scripts/install.sh --harness opencode"]) {
      expect(install, line).toContain(line);
      expect(readme, line).toContain(line);
    }
    expect(read("site/lib/site.ts")).toContain('COMMAND = "npx ai-insights"');
    expect(readme).toContain("npx ai-insights");
    const page = read("site/app/page.tsx");
    for (const agent of ["Claude Code", "Codex", "OpenCode", "Pi", "Cursor", "Gemini CLI"]) expect(page, agent).toContain(`name: "${agent}"`);
    expect(page).toMatch(/name: "Cursor"[^}]*tokens: "No"/);
    expect(page).toMatch(/name: "Gemini CLI", history: "Untested"/);
    expect(readme).toMatch(/\| Gemini CLI \| untested/);
  });

  it("keeps the launch hashtag in one constant", () => {
    const uses = SITE_SOURCES.filter((path) => read(path).includes("#MyAIInsights"));
    expect(uses).toEqual(["site/lib/site.ts"]);
  });

  it("ships a sample report, site data and media built from invented sessions, with nothing from the machine that built them", () => {
    const name = userInfo().username;
    for (const path of ["site/public/demo/report.html", "site/lib/demo.json", "site/lib/media.json", "site/public/llms.txt"]) {
      const text = read(path);
      expect(text, path).not.toContain(homedir());
      if (name.length >= 3) expect(text, path).not.toMatch(new RegExp(`[/\\\\]${name}[/\\\\]`));
      expect(text, path).not.toMatch(/[\w.+-]+@[\w-]+\.(?:com|org|net|io|ai|dev)\b/i);
    }
    expect(read("site/public/demo/report.html")).toContain("acme-api");
    const data = JSON.parse(read("site/lib/demo.json"));
    expect(data.note).toMatch(/invented sessions/);
    expect(pageData(read("site/public/demo/report.html")).hero.sessions).toBe(data.numbers.sessions);
    // The caption shown on the site is the sample's share-safe caption: no project names from the invented history.
    const media = JSON.parse(read("site/lib/media.json"));
    expect(media.caption).not.toMatch(/acme-api|web-app/);
    expect(media.caption).toContain("npx ai-insights");
  });
});
