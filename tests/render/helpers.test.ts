import { describe, expect, it } from "vitest";
import { safeLink } from "../../src/render/links.js";
import { bytesFor, dayNumber, formatBytes, formatCompact, formatHours, formatPercent, formatUsd, safeTimeZone, shortenPath } from "../../src/render/format.js";
import { HOSTILE_URLS } from "./fixtures.js";
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
