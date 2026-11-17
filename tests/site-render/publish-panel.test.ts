import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { publishedLines, storedNotes } from "../../site/lib/publish-lines.ts";
import { CARD_TITLES, EARNED_TITLES, type SharedStats } from "../../site/lib/share.ts";

// The site's own React, so the component and the renderer share one copy.
const siteRequire = createRequire(new URL("../../site/package.json", import.meta.url));
type Element = { readonly __element: unique symbol };
const React = siteRequire("react") as { createElement: (type: unknown, props: unknown) => Element };
const { renderToStaticMarkup } = siteRequire("react-dom/server") as { renderToStaticMarkup: (element: Element) => string };
// A .tsx module, loaded by Vitest; the root tsconfig does not compile site JSX, so the path is not a literal here.
const FORM = "../../site/components/site/publish-form.tsx";
const { PublishPanelView } = (await import(/* @vite-ignore */ FORM)) as { PublishPanelView: unknown };

const v3: SharedStats = {
  v: 3, name: "Ada", from: "2026-08-01", to: "2026-08-31", sessions: 321, tokens: 4_500_000, usd: 77, activeDays: 3, streak: 2,
  agents: [{ k: "claude-code", p: 70 }, { k: "codex", p: 30 }], fact: "Synthetic fact line.",
  cards: [{ k: "parallel", b: "5 at once", c: "sessions running side by side" }, { k: "clock", b: "Night owl", c: "most prompts after 10pm" }, { k: "tests", b: "88 runs", c: "" }],
  titles: [{ k: "conductor", v: 2.5 }], ratios: [{ k: "parallelism", v: 2.5, n: 40 }, { k: "toolErrorRate", v: 0.08, n: 900 }],
  device: { id: "0123456789abcdef0123456789abcdef", name: "Lab box" }, days: { from: "2026-08-01", bits: "Cw" },
};
const v1: SharedStats = { v: 1, name: "Ada", from: "2026-01-01", to: "2026-01-31", sessions: 12, tokens: 900, usd: null, activeDays: 4, streak: 2, agents: [], fact: "" };

const render = (stats: SharedStats, signedIn: boolean | null = true) =>
  renderToStaticMarkup(React.createElement(PublishPanelView, { stats, signedIn, user: signedIn ? { handleSource: "ada", hasImage: false, imageUrl: "" } : null, account: { devices: [], photo: false }, signInButton: (button: unknown) => button }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("the /share publish panel", () => {
  it("puts the Publish button before the preview and the disclosure, so it is on screen without scrolling", () => {
    const html = render(v3);
    const publish = html.search(/<button[^>]*type="submit"[^>]*>Publish<\/button>/);
    expect(publish).toBeGreaterThan(-1);
    expect(publish).toBeLessThan(html.indexOf('data-testid="publish-preview"'));
    expect(publish).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("Remove my entry")).toBeGreaterThan(html.indexOf("<details"));
  });

  it("draws the preview tiles from the payload: each card's title, headline and caption, and the totals", () => {
    const html = render(v3);
    const preview = text(html.slice(html.indexOf('data-testid="publish-preview"'), html.indexOf("<details")));
    for (const card of v3.cards!) {
      expect(preview).toContain(CARD_TITLES[card.k]);
      expect(preview).toContain(card.b);
      if (card.c) expect(preview).toContain(card.c);
    }
    for (const value of ["321", "4.5M", "$77", "@ada", EARNED_TITLES.conductor.title, "Synthetic fact line."]) expect(preview).toContain(value);
    expect(html.match(/<li[^>]*style="background:/g)).toHaveLength(v3.cards!.length);
  });

  it("keeps every published line and every stored-not-shown fact in the collapsed disclosure", () => {
    const html = render(v3);
    const details = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(details).not.toMatch(/<details[^>]*\bopen\b/);
    const lines = publishedLines(v3, { name: "Ada", handle: "ada", showAvatar: false, showDeviceName: false });
    expect(lines.map(([k]) => k)).toEqual(expect.arrayContaining(["Name", "This computer", "Photo", "Profile", "Period", "Sessions", "Tokens", "Estimated spend", "Active days", "Longest streak", "Agents", "Fun fact", "Title: The Conductor", "Ratios", "Card: Most agents at once", "Card: When they prompt", "Card: Test runs"]));
    for (const [k, v] of lines) {
      expect(details).toContain(`<dt class="text-muted-foreground">${escape(k)}</dt>`);
      expect(details).toContain(`<dd class="break-words">${escape(v)}</dd>`);
    }
    for (const note of storedNotes(v3, false)) expect(details).toContain(escape(note));
    expect(text(details)).toMatch(/random id/);
    expect(text(details)).toMatch(/which days this computer was active/);
    expect(text(html)).not.toMatch(/(?<!not )verified(?! )/i);
  });

  it("renders a v1 link: totals only, the older-report note, and no device facts", () => {
    const html = render(v1);
    expect(html.match(/<li[^>]*style="background:/g)).toBeNull();
    expect(text(html)).toContain("without recap cards");
    expect(text(html)).toContain("This link has no device id");
    expect(text(html)).not.toContain("random id");
  });

  it("signed out: offers sign-in at the top without the preview", () => {
    const html = render(v3, false);
    expect(html).toContain("Sign in to publish");
    expect(html).not.toContain("publish-preview");
    expect(text(html)).toContain("not verified");
  });
});
