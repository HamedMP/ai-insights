// Temporary: the Slush AI Breakfast Club banner. Delete this file with src/render/event-banner.ts,
// src/render/client/event-banner.js and src/render/client/event-banner.css once the event has started.
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_BANNER_UNTIL, eventBanner } from "../../src/render/event-banner.js";
import { renderReport } from "../../src/render/index.js";
import type { Recap, Report } from "../../src/schema/types.js";
import { makeReport } from "./fixtures.js";

const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const full = (): Report => ({ ...makeReport(), recap: RECAP });
const CLIENT = new URL("../../src/render/client/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, CLIENT), "utf8");
const BEFORE = Date.UTC(2026, 10, 17, 12, 0, 0);
const BANNER = /<aside id="event-banner"[\s\S]*?<\/aside>/;

/** Runs the banner's client script against one element, with the clock at `now`, and says whether it is shown. */
function openAt(now: number, el: { hidden: boolean; dataset: Record<string, string> } | null) {
  const document = { getElementById: (id: string) => (id === "event-banner" ? el : null) };
  const context = createContext({ document, Date: { now: () => now }, Number });
  new Script(read("event-banner.js")).runInContext(context);
  return el;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the breakfast banner's cutoff", () => {
  it("ends when the breakfast starts, 08:00 Helsinki (EET, UTC+2) on Thursday 19 November 2026", () => {
    expect(EVENT_BANNER_UNTIL).toBe(Date.UTC(2026, 10, 19, 6, 0, 0));
    expect(new Date(EVENT_BANNER_UNTIL).toLocaleString("en-GB", { timeZone: "Europe/Helsinki", weekday: "short", hour: "2-digit", minute: "2-digit" })).toBe("Thu 08:00");
  });
});

describe("the banner markup a report carries", () => {
  it("is emitted hidden, with the cutoff for the client to check, before the breakfast starts", () => {
    const html = eventBanner(true, BEFORE);
    expect(html).toMatch(/^<aside id="event-banner"[^>]*\shidden>/);
    expect(html).toContain(`data-until="${EVENT_BANNER_UNTIL}"`);
  });

  it("is left out of reports rendered at or after the cutoff, so nothing is there to reveal", () => {
    expect(eventBanner(true, EVENT_BANNER_UNTIL)).toBe("");
    expect(eventBanner(true, EVENT_BANNER_UNTIL + 86_400_000)).toBe("");
  });

  it("is left out of reports without a recap, which have no publish box to point at", () => {
    expect(eventBanner(false, BEFORE)).toBe("");
  });

  it("names the event and says invites go to people on the leaderboard, without promising one", () => {
    const html = eventBanner(true, BEFORE);
    expect(html).toContain("Slush AI Breakfast Club · Thu 19 Nov, 8:00–10:00, Helsinki");
    expect(html).toContain("Publish to the leaderboard and register. We&#39;re sending breakfast invites to people on the leaderboard.");
    expect(html).not.toMatch(/guarantee|verified|—/i);
  });

  it("links registration to Luma in a new tab that cannot reach back into the report", () => {
    const links = [...eventBanner(true, BEFORE).matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    const luma = links.filter((a) => a.includes("https://"));
    expect(luma).toEqual(['<a class="btn" href="https://luma.com/4yb5xhzs" target="_blank" rel="noopener noreferrer">']);
  });

  it("sends the publish button to the same place as the deck's own Publish button, the share box", () => {
    const deckHref = /h\("a", \{ class: "btn primary big", href: "(#[\w-]+)" \}, "Publish to the leaderboard"\)/.exec(read("page.js"))![1];
    expect(deckHref).toBe("#share-stats");
    expect(read("sharebox.js")).toContain('id: "share-stats"');
    expect(eventBanner(true, BEFORE)).toContain(`<a class="btn primary" href="${deckHref}">Publish to the leaderboard</a>`);
  });
});

describe("a rendered report", () => {
  it("carries the banner above the report when rendered before the cutoff", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BEFORE);
    const html = renderReport(full());
    expect(html).toMatch(/<body>\s*<noscript>[\s\S]*?<\/noscript>\s*<aside id="event-banner"[\s\S]*?<\/aside>\s*<div id="root">/);
  });

  it("carries no banner when rendered at the cutoff", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENT_BANNER_UNTIL);
    expect(renderReport(full())).not.toMatch(BANNER);
  });

  it("adds nothing to the data the page, its cards and its share link are built from", () => {
    const data = (html: string) => /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BEFORE);
    const shown = renderReport(full());
    vi.setSystemTime(EVENT_BANNER_UNTIL);
    const gone = renderReport(full());
    expect(data(shown)).toBe(data(gone));
    expect(shown.replace(/<aside id="event-banner"[\s\S]*?<\/aside>\n/, "")).toBe(gone);
  });
});

describe("opening a report", () => {
  const el = () => ({ hidden: true, dataset: { until: String(EVENT_BANNER_UNTIL) } });

  it("shows the banner while the breakfast is still ahead", () => {
    expect(openAt(BEFORE, el())!.hidden).toBe(false);
    expect(openAt(EVENT_BANNER_UNTIL - 1, el())!.hidden).toBe(false);
  });

  it("keeps it hidden from the moment the breakfast starts, so a report made earlier and opened later shows nothing", () => {
    expect(openAt(EVENT_BANNER_UNTIL, el())!.hidden).toBe(true);
    expect(openAt(EVENT_BANNER_UNTIL + 86_400_000, el())!.hidden).toBe(true);
  });

  it("keeps it hidden when the cutoff is missing or unreadable", () => {
    expect(openAt(BEFORE, { hidden: true, dataset: {} })!.hidden).toBe(true);
    expect(openAt(BEFORE, { hidden: true, dataset: { until: "soon" } })!.hidden).toBe(true);
  });

  it("does nothing in a report without the banner", () => {
    expect(() => openAt(BEFORE, null)).not.toThrow();
  });
});
