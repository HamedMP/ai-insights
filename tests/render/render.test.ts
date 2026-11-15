import { describe, expect, it } from "vitest";
import { renderReport } from "../../src/render/index.js";
import type { Report } from "../../src/schema/types.js";
import { makeDeterministicReport, makeEmptyReport, makeHostileReport, makeReport, makeYearReport } from "./fixtures.js";

const FULL_SECTIONS = ["overview", "coverage", "work", "activity", "usage", "wins", "friction", "suggestions", "features", "horizon", "matrix"];
const DETERMINISTIC_SECTIONS = ["overview", "coverage", "insights-prompt", "activity", "usage", "friction", "suggestions", "features", "matrix"];

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

  it("renders every section in order", () => {
    expect(sectionIds(html)).toEqual(FULL_SECTIONS);
  });

  it("does not show the run-the-insights-skill prompt once the analysis exists", () => {
    expect(html).not.toContain('id="insights-prompt"');
  });

  it("leads with the narrative headline and the date range", () => {
    const header = html.slice(html.indexOf('id="overview"'), html.indexOf('id="coverage"'));
    expect(header).toContain("You mostly ship product features");
    expect(header).toMatch(/<h1>[A-Z][a-z]{2} \d{1,2} – Nov \d{1,2}, 2026<\/h1>/);
  });

  it("shows narrative work areas, wins, frictions and horizon items", () => {
    for (const text of ["Storefront checkout", "Large refactors land cleanly", "Test loops", "Six-hour design-system session", "Parallel feature branches"]) {
      expect(html).toContain(text);
    }
  });

  it("draws the activity charts the brief asks for", () => {
    const activity = html.slice(html.indexOf('id="activity"'), html.indexOf('id="usage"'));
    for (const chart of ["heatmap", "hours", "daily-sessions", "harness", "languages", "tools", "response-times", "parallel", "projects"]) {
      expect(activity).toContain(`data-chart="${chart}"`);
    }
  });

  it("labels chart axes so a screenshot stands on its own", () => {
    expect(html).toContain("Hour of day");
    expect(html).toContain("Sessions");
  });

  it("states that costs are estimates at API list prices and counts unpriced requests", () => {
    const usage = html.slice(html.indexOf('id="usage"'), html.indexOf('id="wins"'));
    expect(usage).toContain("estimated at API list prices");
    expect(usage).toContain("local-experimental-model");
    expect(usage).toMatch(/unpriced|no known price/i);
    expect(usage).toContain('data-chart="daily-tokens"');
    expect(usage).toContain("Cache hit rate");
  });

  it("shows facet charts in the wins and friction sections", () => {
    expect(html).toContain('data-chart="outcomes"');
    expect(html).toContain('data-chart="frictions"');
    expect(html).toContain("Buggy code");
  });

  it("lists findings with their evidence, capped with a count of the rest", () => {
    const friction = html.slice(html.indexOf('id="friction"'), html.indexOf('id="suggestions"'));
    expect(friction).toContain("keeps failing in the same way");
    expect(friction).toContain("failed 6 times in a row");
    expect(friction).toContain("a1b2c3d4-0001");
    expect(friction).toMatch(/and 2 more/);
  });

  it("puts every instruction text in a copyable block with a copy button", () => {
    const blocks = [...html.matchAll(/<pre[^>]*id="(copy-\d+)"/g)].map((match) => match[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const id of blocks) expect(html).toContain(`data-copy="${id}"`);
    expect(html).toContain("Record project conventions once");
    expect(html).toContain("pnpm exec vitest run path/to/file.test.ts");
  });

  it("lists feature and plugin suggestions under features to try", () => {
    const features = html.slice(html.indexOf('id="features"'), html.indexOf('id="horizon"'));
    expect(features).toContain("Try plan mode for multi-step work");
    expect(features).toContain("Install a test-runner plugin");
  });

  it("shortens home directories in project paths so screenshots do not show usernames", () => {
    expect(html).toContain("~/code/storefront");
    expect(html).not.toContain("/home/dev/code/storefront");
    expect(html).not.toContain("/Users/dev/");
  });

  it("puts the disk-usage finding under features to try with its size, not among the problems", () => {
    const features = html.slice(html.indexOf('id="features"'), html.indexOf('id="horizon"'));
    const friction = html.slice(html.indexOf('id="friction"'), html.indexOf('id="suggestions"'));
    expect(features).toContain("Compress and save disk space");
    expect(features).toContain("2.4 GB");
    expect(features).toContain("agent history on disk");
    expect(friction).not.toContain("Compress and save disk space");
    expect(friction).not.toContain("Agent history takes");
  });

  it("shows how much disk each tool's history uses when the scan measured it", () => {
    const coverage = html.slice(html.indexOf('id="coverage"'), html.indexOf('id="work"'));
    expect(coverage).toContain("On disk");
    expect(coverage).toContain("2.1 GB");
  });

  it("closes with one Matrix OS section and no short-history numbers when history is long", () => {
    expect(html.match(/matrix-os\.com/g)?.length).toBe(1);
    const matrix = html.slice(html.indexOf('id="matrix"'));
    expect(matrix).toContain("30 days");
    expect(matrix).not.toContain("days of history");
  });
});

describe("first run: deterministic analysis only", () => {
  const html = renderReport(makeDeterministicReport());

  it("renders the deterministic sections and the insights prompt, in order", () => {
    expect(sectionIds(html)).toEqual(DETERMINISTIC_SECTIONS);
  });

  it("explains that running the insights skill in their own agent adds the qualitative analysis", () => {
    const prompt = html.slice(html.indexOf('id="insights-prompt"'), html.indexOf('id="activity"'));
    expect(prompt).toMatch(/insights/i);
    expect(prompt).toMatch(/your own agent|your agent/i);
    expect(html.match(/id="insights-prompt"/g)).toHaveLength(1);
  });

  it("leaves out narrative-only sections instead of rendering them empty", () => {
    for (const id of ["work", "wins", "horizon"]) expect(html).not.toContain(`id="${id}"`);
    expect(html).not.toContain('data-chart="outcomes"');
  });

  it("still shows finding suggestions without a narrative", () => {
    expect(html).toContain("Tell the agent how tests run here");
    expect(html).toContain("Try plan mode for multi-step work");
  });

  it("shows the short-history numbers in the Matrix OS section", () => {
    const matrix = html.slice(html.indexOf('id="matrix"'));
    expect(matrix).toContain("26");
    expect(matrix).toContain("days of history");
    expect(html.match(/matrix-os\.com/g)?.length).toBe(1);
  });

  it("does not repeat the short-history finding among the problems", () => {
    const friction = html.slice(html.indexOf('id="friction"'), html.indexOf('id="suggestions"'));
    expect(friction).not.toContain("Only 26 days of history");
  });

  it("marks harnesses that were not found", () => {
    const coverage = html.slice(html.indexOf('id="coverage"'), html.indexOf('id="insights-prompt"'));
    expect(coverage).toContain("Cursor");
    expect(coverage).toContain("Not found");
  });
});

describe("empty history", () => {
  const html = renderReport(makeEmptyReport());

  it("renders without broken charts when every array is empty", () => {
    expect(sectionIds(html)).toEqual(DETERMINISTIC_SECTIONS);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("undefined");
    expect(html).toContain("No activity yet");
    expect(html).not.toMatch(/<svg[^>]*data-chart="(?:hours|daily-sessions|daily-tokens)"/);
  });

  it("shows an unknown cost as a dash, never $0", () => {
    const usage = html.slice(html.indexOf('id="usage"'), html.indexOf('id="friction"'));
    expect(usage).not.toContain("$0");
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
