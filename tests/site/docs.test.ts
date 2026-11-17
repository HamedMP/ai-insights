import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TITLE_RULES } from "../../src/analysis/recap/titles.ts";
import { noHistoryText } from "../../src/cli/screen.ts";
import { HARNESSES } from "../../src/schema/types.ts";
import { mountsClerk } from "../../site/lib/auth-config.ts";
import { DOCS, docSource, neighbours } from "../../site/lib/docs.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const page = (slug: string) => read(docSource(slug));

describe("the docs", () => {
  it("has a page for every sidebar entry, and every 'On this page' link lands on a heading", () => {
    for (const doc of DOCS) {
      expect(existsSync(join(ROOT, docSource(doc.slug))), doc.slug).toBe(true);
      const source = page(doc.slug);
      expect(source, doc.slug).toContain(`<DocShell slug="${doc.slug}">`);
      for (const section of doc.sections) expect(source, `${doc.slug}#${section.id}`).toContain(`<H2 id="${section.id}">`);
    }
  });

  it("has no page the sidebar does not list", () => {
    const dirs = readdirSync(join(ROOT, "site/app/docs"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(dirs.sort()).toEqual(DOCS.filter((doc) => doc.slug).map((doc) => doc.slug).sort());
  });

  it("walks from the first page to the last with previous and next links", () => {
    expect(neighbours(DOCS[0]!.slug).prev).toBeNull();
    expect(neighbours(DOCS.at(-1)!.slug).next).toBeNull();
    for (let i = 1; i < DOCS.length; i += 1) expect(neighbours(DOCS[i]!.slug).prev?.slug).toBe(DOCS[i - 1]!.slug);
  });

  it("links to other pages of the site through DocLink, so docs pages switch in place and Clerk pages still load in full", () => {
    for (const doc of DOCS) expect(page(doc.slug), doc.slug).not.toMatch(/<a href="\/(?!\/)/);
  });

  it("stays a page without Clerk, so the docs load nothing from a sign-in host", () => {
    for (const doc of DOCS) expect(mountsClerk(`/docs${doc.slug ? `/${doc.slug}` : ""}`)).toBe(false);
    const files = ["site/app/docs/layout.tsx", "site/components/docs/doc-shell.tsx", "site/components/docs/prose.tsx", "site/components/docs/docs-search.tsx", "site/components/docs/docs-nav.tsx", "site/components/docs/docs-header.tsx", "site/components/site/site-link.tsx", "site/lib/navigation.ts", ...DOCS.map((doc) => docSource(doc.slug))];
    for (const file of files) expect(read(file), file).not.toMatch(/@clerk\/|auth-provider|account-menu/);
  });
});

describe("the reference pages match the code", () => {
  it("lists every earned title with its threshold", () => {
    const source = page("report");
    for (const rule of TITLE_RULES) expect(source, rule.title).toContain(`"${rule.title}"`);
  });

  it("documents every MCP tool the server registers", () => {
    const tools = [...read("src/mcp/server.ts").matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((match) => match[1]!);
    expect(tools.length).toBeGreaterThan(0);
    const listed = DOCS.find((doc) => doc.slug === "mcp")!.sections.map((section) => section.id);
    for (const tool of tools) expect(listed, tool).toContain(tool);
  });

  it("quotes the message the CLI prints when it finds no history, word for word", () => {
    expect(page("troubleshooting")).toContain(noHistoryText([]).trimEnd().replaceAll("`", "\\`"));
  });

  it("documents every CLI command and option in the help text", () => {
    const help = /const HELP = `([\s\S]*?)`;/.exec(read("src/cli/args.ts"))?.[1] ?? "";
    expect(help).toContain("Options");
    const source = page("cli");
    for (const flag of new Set(help.match(/--[a-z][a-z-]*/g) ?? [])) expect(source, flag).toContain(flag);
    for (const command of ["scan", "report", "doctor", "mcp"]) expect(source, command).toContain(`ai-insights ${command}`);
    for (const harness of HARNESSES) expect(source, harness).toContain(`<code>${harness}</code>`);
  });
});
