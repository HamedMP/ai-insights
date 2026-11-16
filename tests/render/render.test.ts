import { describe, expect, it } from "vitest";
import { renderReport } from "../../src/render/index.js";
import type { Report } from "../../src/schema/types.js";
import { makeDeterministicReport, makeEmptyReport, makeHostileReport, makeReport, makeYearReport } from "./fixtures.js";

const FULL_SECTIONS = ["overview", "rhythm", "delegation", "parallel", "coverage", "usage", "story", "friction", "improve", "closing"];
const DETERMINISTIC_SECTIONS = ["overview", "rhythm", "delegation", "parallel", "coverage", "usage", "insights-prompt", "friction", "improve", "closing"];
const EMPTY_SECTIONS = ["overview", "coverage", "insights-prompt", "closing"];

/** One section's markup; sections never nest. */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return "";
  return html.slice(start, html.indexOf("</section>", start));
}

function sectionIds(html: string): string[] {
  return [...html.matchAll(/<section[^>]*\bid="([^"]+)"/g)].map((match) => match[1]!);
}

/** Attribute names on real tags, with quoted values removed so escaped text inside them cannot match. */
function eventHandlerAttributes(html: string): string[] {
  const found: string[] = [];
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const bare = tag[0].replace(/"[^"]*"/g, '""');
    for (const attr of bare.matchAll(/\s(on[a-z]+)\s*=/gi)) found.push(attr[1]!);
  }
  return found;
}

function styleBlock(html: string): string {
  return html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
}

interface Reference {
  tag: string;
  attr: string;
  value: string;
  /** The whole opening tag, to check target and rel on links. */
  source: string;
}

function unescape(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Every place a document can pull in or point at another resource, except in-page anchors. */
function externalReferences(html: string): Reference[] {
  const refs: Reference[] = [];
  for (const tag of html.matchAll(/<([a-zA-Z][\w:-]*)\b[^>]*>/g)) {
    for (const attr of tag[0].matchAll(/\s(href|src|srcset|action|formaction|poster|data|xlink:href|background|cite|ping)\s*=\s*"([^"]*)"/gi)) {
      refs.push({ tag: tag[1]!.toLowerCase(), attr: attr[1]!.toLowerCase(), value: unescape(attr[2]!), source: tag[0] });
    }
  }
  const css = styleBlock(html);
  for (const match of css.matchAll(/url\(\s*([^)]*)\)/gi)) refs.push({ tag: "style", attr: "url", value: match[1]!, source: match[0] });
  for (const match of css.matchAll(/@import\s+([^;]+)/gi)) refs.push({ tag: "style", attr: "import", value: match[1]!, source: match[0] });
  return refs.filter((ref) => !ref.value.startsWith("#"));
}

/** Normalised http(s) URLs the report's suggestions carry: the only links allowed besides Matrix OS. */
function suggestionLinks(report: Report): Set<string> {
  const urls = [...(report.narrative?.suggestions ?? []), ...report.findings.map((finding) => finding.suggestion)]
    .map((suggestion) => suggestion?.url)
    .filter((url): url is string => typeof url === "string");
  const out = new Set<string>();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") out.add(parsed.href);
    } catch {
      // Not a URL at all, so it can never be a link.
    }
  }
  return out;
}

/** References that are neither the Matrix OS link nor a suggestion link rendered as a safe new-tab anchor. */
function forbiddenReferences(html: string, report: Report): Reference[] {
  const allowed = suggestionLinks(report);
  return externalReferences(html).filter((ref) => {
    if (ref.tag !== "a" || ref.attr !== "href") return true;
    if (ref.value === "https://matrix-os.com") return false;
    const safeTab = ref.source.includes('target="_blank"') && ref.source.includes('rel="noopener noreferrer"');
    return !(safeTab && /^https?:\/\//.test(ref.value) && allowed.has(ref.value));
  });
}

describe("renderReport output", () => {
  it("is one complete HTML document a person can open offline", () => {
    const html = renderReport(makeReport());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.match(/<html\b/g)).toHaveLength(1);
    expect(html.match(/<\/html>/g)).toHaveLength(1);
    expect(html.match(/<body\b/g)).toHaveLength(1);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toHaveLength(1);
  });

  it("loads nothing and links out only to Matrix OS and http(s) suggestion links, so it works offline and leaks nothing", () => {
    for (const report of [makeReport(), makeDeterministicReport(), makeHostileReport(), makeEmptyReport()]) {
      const html = renderReport(report);
      expect(forbiddenReferences(html, report)).toEqual([]);
      expect(externalReferences(html).map((ref) => ref.value)).toContain("https://matrix-os.com");
      expect(html).not.toMatch(/<(?:link|img|iframe|object|embed|video|audio|source|base|form)\b/i);
      expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\(/);
    }
  });

  it("locks the page down with a CSP so an escaping bug still cannot load anything", () => {
    const html = renderReport(makeReport());
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*script-src 'sha256-[^']+'/);
  });

  it("makes suggestion URLs real links that open in a new tab, labelled with the short URL", () => {
    const html = renderReport(makeReport());
    expect(html).toContain(
      '<a href="https://docs.claude.com/en/docs/claude-code/common-workflows" target="_blank" rel="noopener noreferrer">docs.claude.com/en/docs/claude-code/common-workflows</a>',
    );
    expect(html).toContain('<a href="https://example.org/plugins/test-runner" target="_blank" rel="noopener noreferrer">example.org/plugins/test-runner</a>');
  });

  it("keeps the CSP closed: links need no allowance and the page still loads nothing", () => {
    const html = renderReport(makeReport());
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/https?:|\*|connect-src|navigate-to/);
  });

  it("shows no learn-more line for a suggestion without a URL", () => {
    const html = renderReport(makeReport());
    const card = html.slice(html.indexOf("Compress and save disk space"));
    expect(card.slice(0, card.indexOf("</article>"))).not.toContain("Learn more");
  });

  it("stays well under 1 MB for a year of daily data with many models, findings and projects", () => {
    const html = renderReport(makeYearReport());
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(400_000);
  });

  it("is deterministic, so re-rendering the same report gives the same file", () => {
    expect(renderReport(makeReport())).toBe(renderReport(makeReport()));
  });
});

describe("escaping untrusted report text", () => {
  const html = renderReport(makeHostileReport());

  it("never lets prompt, path or tool text become markup", () => {
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<svg onload");
    expect(eventHandlerAttributes(html)).toEqual([]);
    expect(html).not.toMatch(/<a href="https:\/\/evil/);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(styleBlock(html)).not.toContain("evil");
  });

  it("still shows the hostile text, escaped, so the person sees what was there", () => {
    expect(html).toContain("&lt;script&gt;alert(&#39;pwned&#39;)&lt;/script&gt;");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("never links a non-http(s) suggestion URL: javascript:, data:, vbscript:, protocol-relative or padded", () => {
    const hrefs = [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((match) => match[1]!);
    for (const href of hrefs) expect(href).toMatch(/^(#|https?:\/\/)/);
    expect(html).not.toMatch(/href="\s*(?:javascript|data|vbscript):/i);
    expect(html).not.toContain('href="//');
  });

  it("links a hostile http(s) URL only in normalised form, so quotes cannot break out of the attribute", () => {
    expect(html).toContain('href="https://ok.example/a%22%20onmouseover=%22alert(1)"');
    expect(html).toContain('href="http://plain.example/docs"');
    expect(eventHandlerAttributes(html)).toEqual([]);
  });

  it("falls back to UTC when the time zone is not a real zone", () => {
    expect(html).toContain("UTC");
  });

  it("closes every section it opens", () => {
    expect(html.match(/<section\b/g)?.length).toBe(html.match(/<\/section>/g)?.length);
    expect(html.match(/<svg\b/g)?.length).toBe(html.match(/<\/svg>/g)?.length);
  });
});

describe("full report with facets and narrative", () => {
  const report = makeReport();
  const html = renderReport(report);

  it("tells the story in chapters, in order, ending with what to improve and the closing pair", () => {
    expect(sectionIds(html)).toEqual(FULL_SECTIONS);
  });

  it("does not show the run-the-insights-skill prompt once the analysis exists", () => {
    expect(html).not.toContain('id="insights-prompt"');
  });

  it("opens with a headline finding about the person, its numbers and the agent's read", () => {
    const hook = section(html, "overview");
    expect(hook).toMatch(/<h1 class="headline[^"]*"[^>]*>Your agents put in <em>[\d.,]+ h of work<\/em> in <em>[\d.,]+ h<\/em> of yours\.<\/h1>/);
    expect(hook.match(/class="number"/g)).toHaveLength(4);
    expect(hook).toContain("Hours with AI at work");
    expect(hook).toContain("agent-hours across sessions");
    expect(hook).toContain("You mostly ship product features");
    expect(hook).toContain('class="px-hero"');
  });

  it("opens every chapter with one plain sentence that emphasises its number", () => {
    for (const id of FULL_SECTIONS.filter((id) => !["overview", "closing"].includes(id))) {
      expect(section(html, id)).toMatch(/<p class="statement"><?[^<]*(?:<em>[^<]*\d[^<]*<\/em>)/);
    }
  });

  it("shows narrative work areas, wins, frictions and horizon items", () => {
    for (const text of ["Storefront checkout", "Large refactors land cleanly", "Test loops", "Six-hour design-system session", "Parallel feature branches"]) {
      expect(html).toContain(text);
    }
  });

  it("draws a visual made for each chapter's message", () => {
    expect(section(html, "rhythm")).toContain('data-chart="hours"');
    expect(section(html, "rhythm")).toContain('data-chart="weekdays"');
    expect(section(html, "rhythm")).toContain('data-chart="calendar"');
    for (const chart of ["delegation", "tool-mix", "response-times"]) expect(section(html, "delegation")).toContain(`data-chart="${chart}"`);
    expect(section(html, "parallel")).toContain('data-chart="timeline"');
    for (const chart of ["harness", "projects", "languages"]) expect(section(html, "coverage")).toContain(`data-chart="${chart}"`);
    for (const chart of ["token-flow", "daily-tokens", "models"]) expect(section(html, "usage")).toContain(`data-chart="${chart}"`);
    expect(section(html, "friction")).toContain('data-chart="friction-map"');
  });

  it("labels its visuals so a screenshot stands on its own", () => {
    expect(html).toContain("Hour of day");
    expect(html).toContain("Sessions started, by weekday");
    expect(html).toContain("Calendar of sessions started per day");
    expect(html).toContain("One square per");
  });

  it("contrasts the person's hours with summed agent-hours", () => {
    const parallel = section(html, "parallel");
    expect(parallel).toContain("your hours with AI at work");
    expect(parallel).toContain("agent-hours, summed across sessions");
  });

  it("states that costs are estimates at API list prices and names the unpriced share and models", () => {
    const usage = section(html, "usage");
    expect(usage).toContain("estimated at API list prices");
    expect(usage).toMatch(/\d+% of requests \([\d,]+\) have no known price/);
    expect(usage).toContain("local-experimental-model");
    expect(usage).toContain("Read from cache");
    expect(section(html, "overview")).toMatch(/\d+% of requests unpriced: local-experimental-model/);
  });

  it("shows facet charts in the story and friction chapters", () => {
    expect(section(html, "story")).toContain('data-chart="outcomes"');
    expect(section(html, "friction")).toContain('data-chart="frictions"');
    expect(html).toContain("Buggy code");
  });

  it("lists findings with their evidence, capped with a count of the rest", () => {
    const friction = section(html, "friction");
    expect(friction).toContain("keeps failing in the same way");
    expect(friction).toContain("failed 6 times in a row");
    expect(friction).toContain("a1b2c3d4-0001");
    expect(friction).toMatch(/and 2 more/);
  });

  it("ends a chapter with one concrete thing to try, pointing at its rank", () => {
    const friction = section(html, "friction");
    expect(friction).toContain('class="tip reveal"');
    expect(friction).toContain("Tell the agent how tests run here");
    expect(friction).toContain('href="#action-1"');
  });

  it("ranks the top three actions with why and the exact text to act on", () => {
    const improve = section(html, "improve");
    for (const rank of [1, 2, 3]) expect(improve).toContain(`id="action-${rank}"`);
    const first = improve.slice(improve.indexOf('id="action-1"'), improve.indexOf('id="action-2"'));
    expect(first).toContain("Tell the agent how tests run here");
    expect(first).toContain("Why");
    expect(first).toContain("pnpm exec vitest run path/to/file.test.ts");
    expect(first).toMatch(/data-copy="copy-\d+"/);
  });

  it("puts every instruction text in a copyable block with a copy button", () => {
    const blocks = [...html.matchAll(/<pre[^>]*id="(copy-\d+)"/g)].map((match) => match[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const id of blocks) expect(html).toContain(`data-copy="${id}"`);
    expect(html).toContain("Record project conventions once");
  });

  it("keeps feature and plugin suggestions in the ranked list with their links", () => {
    const improve = section(html, "improve");
    expect(improve).toContain("Try plan mode for multi-step work");
    expect(improve).toContain("Install a test-runner plugin");
    expect(improve).toContain('href="https://example.org/plugins/test-runner"');
  });

  it("shortens home directories in project paths so screenshots do not show usernames", () => {
    expect(html).toContain("~/code/storefront");
    expect(html).not.toContain("/home/dev/code/storefront");
    expect(html).not.toContain("/Users/dev/");
  });

  it("closes with the disk-space card, its size shown, and not among the problems or the ranked actions", () => {
    const closing = section(html, "closing");
    expect(closing).toContain('id="packmem"');
    expect(closing).toContain("Compress and save disk space");
    expect(closing).toContain("2.4 GB");
    expect(section(html, "friction")).not.toContain("Agent history takes");
    expect(section(html, "improve")).not.toContain("Compress and save disk space");
  });

  it("shows how much disk each tool's history uses when the scan measured it", () => {
    const coverage = section(html, "coverage");
    expect(coverage).toContain("On disk");
    expect(coverage).toContain("2.1 GB");
  });

  it("closes with one Matrix OS card and no short-history numbers when history is long", () => {
    expect(html.match(/matrix-os\.com/g)?.length).toBe(1);
    const matrix = section(html, "closing").slice(section(html, "closing").indexOf('id="matrix"'));
    expect(matrix).toContain("Store your conversations long term");
    expect(matrix).toContain("30 days");
    expect(matrix).not.toContain("days of history");
  });
});

describe("first run: deterministic analysis only", () => {
  const report = makeDeterministicReport();
  const html = renderReport(report);

  it("still reads as a complete story, with the insights prompt as one chapter", () => {
    expect(sectionIds(html)).toEqual(DETERMINISTIC_SECTIONS);
  });

  it("explains that running the insights skill in their own agent adds the qualitative analysis", () => {
    const prompt = section(html, "insights-prompt");
    expect(prompt).toMatch(/insights/i);
    expect(prompt).toMatch(/your own agent/i);
    expect(html.match(/id="insights-prompt"/g)).toHaveLength(1);
  });

  it("leaves out narrative-only content instead of rendering it empty", () => {
    expect(html).not.toContain('id="story"');
    expect(html).not.toContain('data-chart="outcomes"');
    expect(html).not.toContain("Bigger moves");
  });

  it("labels summed time as agent-hours when wall-clock time was not measured", () => {
    expect(section(html, "overview")).toContain("Agent-hours");
    expect(section(html, "overview")).not.toContain("Hours with AI at work");
  });

  it("still shows finding suggestions without a narrative", () => {
    expect(html).toContain("Tell the agent how tests run here");
    expect(html).toContain("Try plan mode for multi-step work");
  });

  it("shows the short-history numbers in the Matrix OS card", () => {
    const closing = section(html, "closing");
    const matrix = closing.slice(closing.indexOf('id="matrix"'));
    expect(matrix).toContain("26");
    expect(matrix).toContain("days of history");
    expect(html.match(/matrix-os\.com/g)?.length).toBe(1);
  });

  it("does not repeat the short-history finding among the problems", () => {
    expect(section(html, "friction")).not.toContain("Only 26 days of history");
  });

  it("marks harnesses that were not found", () => {
    const coverage = section(html, "coverage");
    expect(coverage).toContain("Cursor");
    expect(coverage).toContain("Not found");
  });

  it("drops the disk-space card when there is no disk-usage finding", () => {
    const lean = { ...report, findings: report.findings.filter((finding) => finding.kind !== "history_disk_usage") };
    const out = renderReport(lean);
    expect(out).not.toContain('id="packmem"');
    expect(section(out, "closing")).toContain('id="matrix"');
  });
});

describe("empty history", () => {
  const html = renderReport(makeEmptyReport());

  it("renders a short, honest page without broken charts when every array is empty", () => {
    expect(sectionIds(html)).toEqual(EMPTY_SECTIONS);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("undefined");
    expect(html).toContain("did not find any coding-agent history");
    expect(html).not.toMatch(/<svg[^>]*data-chart="(?:hours|calendar|daily-tokens)"/);
  });

  it("shows no cost at all rather than $0", () => {
    expect(html).not.toContain("$0");
  });
});

describe("motion, themes and print", () => {
  const html = renderReport(makeReport());
  const css = styleBlock(html);

  it("animates only when the person has not asked for reduced motion, so content is visible by default", () => {
    const gate = css.indexOf("@media (prefers-reduced-motion:no-preference)");
    expect(gate).toBeGreaterThan(0);
    expect(css.slice(0, gate)).not.toMatch(/animation:/);
    expect(html).not.toMatch(/style="[^"]*opacity:\s*0/);
  });

  it("designs both themes and prints in the light one with motion off", () => {
    expect(css).toContain("@media (prefers-color-scheme:light)");
    expect(css).toMatch(/--bg:#0b0b0c/);
    expect(css).toMatch(/--bg:#f3f0e8/);
    expect(css).toMatch(/@media print\{\s*:root\{[^}]*--bg:#f3f0e8/);
    expect(css).toMatch(/@media print\{[\s\S]*animation:none!important/);
  });
});

describe("bad numbers in the report", () => {
  it("never prints NaN or Infinity when counters are corrupt", () => {
    const report = makeReport();
    report.activity.hourHistogram = [Number.NaN, Infinity, -4, ...new Array(21).fill(1)];
    report.activity.daily = [...report.activity.daily, { day: "not-a-day", sessions: Number.NaN, userMessages: 1, activeMinutes: 1 }];
    report.usage.cacheHitRate = Number.NaN;
    report.usage.estimatedUsd = Infinity;
    const html = renderReport(report);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("does not throw when the narrative arrays are missing entries", () => {
    const report = makeReport();
    report.narrative = { ...report.narrative!, workAreas: [], wins: [], frictions: [], suggestions: [], horizon: [] };
    expect(() => renderReport(report)).not.toThrow();
  });
});
