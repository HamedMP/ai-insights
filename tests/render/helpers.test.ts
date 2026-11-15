import { describe, expect, it } from "vitest";
import { barList, calendarHeatmap, columnChart, monthTicks, niceScale, weekday } from "../../src/render/charts.js";
import { createContext, rich } from "../../src/render/components.js";
import { safeLink } from "../../src/render/links.js";
import { HOSTILE_URLS } from "./fixtures.js";
import { bytesFor, dayNumber, formatBytes, formatCompact, formatHours, formatPercent, formatUsd, safeTimeZone, shortenPath } from "../../src/render/format.js";
import { html, raw } from "../../src/render/html.js";
import { makeReport } from "./fixtures.js";

describe("html tag", () => {
  it("escapes every interpolated value so report text cannot become markup", () => {
    expect(html`<p title="${'"><x>'}">${"<b>&'"}</p>`.value).toBe('<p title="&quot;&gt;&lt;x&gt;">&lt;b&gt;&amp;&#39;</p>');
  });

  it("passes nested safe fragments through once, without double escaping", () => {
    const inner = html`<i>${"a<b"}</i>`;
    expect(html`<p>${inner}${[inner, "<"]}</p>`.value).toBe("<p><i>a&lt;b</i><i>a&lt;b</i>&lt;</p>");
  });

  it("drops null, booleans and non-finite numbers instead of printing them", () => {
    expect(html`${null}${undefined}${false}${true}${Number.NaN}${Infinity}${3}`.value).toBe("3");
  });

  it("only trusts raw() markup the renderer wrote itself", () => {
    expect(html`${raw("<br>")}`.value).toBe("<br>");
  });
});

describe("inline code in report text", () => {
  it("shows backticked commands as code while still escaping them", () => {
    expect(rich("run `<pnpm test>` now", 100).value).toBe("run <code>&lt;pnpm test&gt;</code> now");
  });

  it("leaves an unmatched backtick as plain text", () => {
    expect(rich("a ` b", 100).value).toBe("a ` b");
  });
});

describe("formatting", () => {
  it("never shows an unpriced cost as $0", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(Number.NaN)).toBe("—");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(1234.5)).toBe("$1,235");
  });

  it("keeps big token counts short", () => {
    expect(formatCompact(1_610_000_000)).toBe("1.61B");
    expect(formatCompact(25_600_000)).toBe("25.6M");
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(Number.NaN)).toBe("0");
  });

  it("formats durations and percentages", () => {
    expect(formatHours(45)).toBe("45 min");
    expect(formatHours(90)).toBe("1.5 h");
    expect(formatPercent(0.923, 1)).toBe("92.3%");
    expect(formatPercent(null)).toBe("—");
  });

  it("hides the username in home-directory paths", () => {
    expect(shortenPath("/home/alex/code/app")).toBe("~/code/app");
    expect(shortenPath("/Users/alex")).toBe("~");
    expect(shortenPath("C:\\Users\\alex\\code")).toBe("~\\code");
    expect(shortenPath("/srv/app")).toBe("/srv/app");
  });

  it("falls back to UTC for an unknown time zone", () => {
    expect(safeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
  });

  it("rejects malformed day buckets", () => {
    expect(dayNumber("2026-11-14")).not.toBeNull();
    expect(dayNumber("14/11/2026")).toBeNull();
  });
});

describe("suggestion links", () => {
  it("accepts only http(s) URLs, so a hostile report cannot plant a script link", () => {
    const accepted = HOSTILE_URLS.filter((url) => safeLink(url) !== null).map((url) => safeLink(url)!.href);
    expect(accepted).toEqual(["https://ok.example/a%22%20onmouseover=%22alert(1)", "http://plain.example/docs"]);
  });

  it("rejects links with embedded credentials and absurdly long URLs", () => {
    expect(safeLink("https://user:pass@example.org/")).toBeNull();
    expect(safeLink(`https://example.org/${"a".repeat(3000)}`)).toBeNull();
    expect(safeLink(undefined)).toBeNull();
  });
});

describe("sizes", () => {
  it("reads size metrics in any byte unit and shows them in decimal units", () => {
    expect(formatBytes(bytesFor(2400, "MB")!)).toBe("2.4 GB");
    expect(formatBytes(512_000_000)).toBe("512 MB");
    expect(formatBytes(900)).toBe("900 B");
    expect(bytesFor(3, "failures")).toBeNull();
  });
});

describe("charts", () => {
  it("picks round axis steps", () => {
    expect(niceScale(46)).toEqual({ top: 60, ticks: [0, 20, 40, 60] });
    expect(niceScale(10)).toEqual({ top: 10, ticks: [0, 5, 10] });
    expect(niceScale(0).top).toBeGreaterThan(0);
  });

  it("starts weeks on Monday", () => {
    expect(weekday(dayNumber("2026-11-16")!)).toBe(0);
    expect(weekday(dayNumber("2026-11-15")!)).toBe(6);
  });

  it("labels month starts without crowding the axis", () => {
    const first = dayNumber("2025-11-15")!;
    const ticks = monthTicks(first, 366);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[0]!.text).toBe("Dec");
  });

  it("shows an empty state instead of a blank chart when there is no data", () => {
    const empty = columnChart({ id: "x", series: [{ className: "s3", label: "", values: [0, 0] }], xTicks: [], yTitle: "", xTitle: "", ariaLabel: "", emptyMessage: "Nothing yet" });
    expect(empty.value).toContain("Nothing yet");
    expect(empty.value).not.toContain("<svg");
    expect(barList("y", [], { limit: 5, emptyMessage: "None" }).value).toContain("None");
    expect(calendarHeatmap("z", [], { emptyMessage: "Quiet", unit: "sessions" }).value).toContain("Quiet");
  });

  it("caps a multi-year calendar at about one year of weeks", () => {
    const start = dayNumber("2023-01-01")!;
    const days = Array.from({ length: 1400 }, (_, index) => ({ day: start + index, value: 1, tooltip: "t" }));
    const svg = calendarHeatmap("heatmap", days, { emptyMessage: "", unit: "sessions" }).value;
    expect(svg.match(/<rect /g)!.length).toBeLessThanOrEqual(53 * 7);
  });
});

describe("render context", () => {
  it("hands out unique, deterministic ids", () => {
    const context = createContext(makeReport(), "UTC");
    expect([context.nextId("copy"), context.nextId("copy"), context.nextId("x")]).toEqual(["copy-1", "copy-2", "x-1"]);
  });
});
