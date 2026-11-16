import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderReport } from "../../src/render/index.js";
import type { Recap, Report } from "../../src/schema/types.js";
import { HOSTILE, makeDeterministicReport, makeEmptyReport, makeHostileReport, makeReport, makeYearReport } from "./fixtures.js";

const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const full = (report: Report = makeReport()): Report => ({ ...report, recap: RECAP });

/** The JSON data block the page reads. */
function data(html: string): Record<string, unknown> {
  const match = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(match![1]!);
}
/** Scripts that run: data blocks (JSON, a style's font CSS as text/plain) carry a type and never execute. */
const scripts = (html: string) => [...html.matchAll(/<script(?![^>]*\stype=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);

describe("one self-contained file", () => {
  const html = renderReport(full());

  it("is one complete HTML document with its fonts, styles, script and data inline", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toMatch(/@font-face\{font-family:"Brico";src:url\(data:font\/woff2;base64,/);
    expect(html).toContain('<script id="report-data" type="application/json">');
    expect(scripts(html)).toHaveLength(1);
  });

  it("loads nothing from the network: no src, href or url() pointing anywhere but data:", () => {
    expect(html).not.toMatch(/<(script|img|link|iframe|video|audio|source)[^>]+\ssrc=["']?https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join("");
    expect(css).not.toMatch(/url\(\s*(?!["']?data:)[^)]*\)/);
    expect(html).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    expect(html).not.toMatch(/@import/);
    const code = scripts(html)[0]!;
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource/);
  });

  it("locks the page down with a CSP that runs only its own script, by hash", () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)![1]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/connect-src/);
    const hash = createHash("sha256").update(scripts(html)[0]!).digest("base64");
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
  });

  it("says what to do when JavaScript is off", () => {
    expect(html).toMatch(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  });

  it("keeps the muxer's MPL licence notice and names the font licence", () => {
    expect(html).toContain("Mozilla Public");
    expect(html).toContain("SIL Open Font License");
  });

  it("is deterministic, so re-rendering the same report gives the same file", () => {
    expect(renderReport(full())).toBe(html);
  });

  it("stays well under 2 MB for a year of daily data with many models, findings and projects", () => {
    expect(Buffer.byteLength(renderReport(makeYearReport()))).toBeLessThan(2_000_000);
  });
});

describe("hostile report text", () => {
  const html = renderReport(full(makeHostileReport()));

  it("can never close the data block or become markup: every < in the data is escaped", () => {
    const block = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(block).not.toContain("<");
    expect(scripts(html)).toHaveLength(1);
    expect(html).not.toContain(HOSTILE.script);
    expect(html).not.toContain("<img src=x");
  });

  it("still carries the hostile text as data, so the page can show it escaped", () => {
    expect(JSON.stringify(data(html))).toContain(HOSTILE.script);
  });

  it("never links a non-http(s) suggestion URL", () => {
    const view = data(html) as { actions: { top: Array<{ url: string | null }>; rest: Array<{ url: string | null }> } };
    for (const action of [...view.actions.top, ...view.actions.rest]) if (action.url) expect(action.url).toMatch(/^https?:\/\//);
  });

  it("falls back to UTC when the time zone is not a real zone", () => {
    expect((data(html) as { timeZone: string }).timeZone).toBe("UTC");
  });
});

describe("other reports", () => {
  it("renders an empty history and a report without recap", () => {
    for (const report of [makeEmptyReport(), makeDeterministicReport(), makeReport()]) {
      const html = renderReport(report);
      expect((data(html) as { recap: unknown }).recap).toBeNull();
    }
  });

  it("puts the run snapshots it is given into the page, today last", () => {
    const report = full();
    const run = { snapshotVersion: 1 as const, id: "2026-10-01T10-00-00-000Z", generatedAt: "2026-10-01T10:00:00.000Z", timeZone: "UTC", versions: { report: 1, recap: 1, pricing: "x" }, window: { from: "2026-09-01", to: "2026-10-01", days: 31 }, metrics: { sessions: 3 } as never, findings: [], suggestionsShown: [], narrative: false };
    const runs = (data(renderReport(report, { runs: [run] })) as { runs: Array<{ id: string }> }).runs;
    expect(runs.map((r) => r.id)).toEqual([run.id, report.generatedAt]);
  });
});
