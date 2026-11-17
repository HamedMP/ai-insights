// Temporary: the Slush AI Breakfast Club prompts on /share and /leaderboard. Delete this file with
// site/components/site/breakfast.tsx once the breakfast has started (19 Nov 2026, 08:00 Helsinki).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const siteRequire = createRequire(new URL("../../site/package.json", import.meta.url));
type Element = { readonly __element: unique symbol };
const React = siteRequire("react") as { createElement: (type: unknown, props: unknown) => Element };
const { renderToStaticMarkup } = siteRequire("react-dom/server") as { renderToStaticMarkup: (element: Element) => string };
const MODULE = "../../site/components/site/breakfast.tsx";
type Prompt = (props: { now?: number }) => unknown;
const { BREAKFAST_UNTIL, BreakfastNote, BreakfastNextStep, BreakfastStrip } = (await import(/* @vite-ignore */ MODULE)) as { BREAKFAST_UNTIL: number; BreakfastNote: Prompt; BreakfastNextStep: Prompt; BreakfastStrip: Prompt };

const SITE = new URL("../../site/", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, SITE), "utf8");
const BEFORE = Date.UTC(2026, 10, 17, 12, 0, 0);
const LUMA = '<a href="https://luma.com/4yb5xhzs" target="_blank" rel="noopener noreferrer"';
const render = (prompt: Prompt, now?: number) => renderToStaticMarkup(React.createElement(prompt, now === undefined ? {} : { now }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([.,:?])/g, "$1").trim();
const ALL: Array<[string, Prompt]> = [["share note", BreakfastNote], ["next step after publishing", BreakfastNextStep], ["leaderboard strip", BreakfastStrip]];

describe("the breakfast prompts' cutoff", () => {
  it("is when the breakfast starts, 08:00 Helsinki (EET, UTC+2) on Thursday 19 November 2026", () => {
    expect(BREAKFAST_UNTIL).toBe(Date.UTC(2026, 10, 19, 6, 0, 0));
    expect(new Date(BREAKFAST_UNTIL).toLocaleString("en-GB", { timeZone: "Europe/Helsinki", weekday: "short", hour: "2-digit", minute: "2-digit" })).toBe("Thu 08:00");
  });

  it.each(ALL)("%s: shows before the breakfast and is gone from the moment it starts", (_name, prompt) => {
    expect(render(prompt, BEFORE)).toContain(LUMA);
    expect(render(prompt, BREAKFAST_UNTIL - 1)).toContain(LUMA);
    expect(render(prompt, BREAKFAST_UNTIL)).toBe("");
    expect(render(prompt, BREAKFAST_UNTIL + 86_400_000)).toBe("");
  });

  it.each(ALL)("%s: renders nothing on the server, so the cached page is the same for everyone and after the cutoff nothing moves", (_name, prompt) => {
    expect(render(prompt)).toBe("");
  });
});

describe("the copy", () => {
  it("before publishing: names the event and says invites go to people on the leaderboard", () => {
    expect(text(render(BreakfastNote, BEFORE))).toBe("Slush AI Breakfast Club · Thu 19 Nov, 8:00–10:00, Helsinki. Publish, then register: we’re sending breakfast invites to people on the leaderboard. Register for the breakfast");
  });

  it("after publishing: makes registering the next step, with Luma as the main button", () => {
    const html = render(BreakfastNextStep, BEFORE);
    expect(text(html)).toBe("You’re on the leaderboard. One more step: register for the breakfast. Register for the breakfast");
    expect(html).toMatch(/<a href="https:\/\/luma\.com\/4yb5xhzs"[^>]*class="[^"]*bg-primary/);
  });

  it("on the leaderboard: one line with the link", () => {
    expect(text(render(BreakfastStrip, BEFORE))).toBe("Slush AI Breakfast Club · Thu 19 Nov, Helsinki. On the leaderboard? Register for the breakfast.");
  });

  it.each(ALL)("%s: promises nothing and uses no em dash", (_name, prompt) => {
    expect(text(render(prompt, BEFORE))).not.toMatch(/guarantee|verified|—/i);
  });
});

describe("where the prompts sit", () => {
  const form = source("components/site/publish-form.tsx");

  it("the share note follows the Publish button (signed in) and the sign-in button (signed out), so neither moves down", () => {
    const signedOut = form.slice(form.indexOf("if (!signedIn) {"), form.indexOf("async function publish"));
    expect(signedOut.indexOf("<BreakfastNote />")).toBeGreaterThan(signedOut.indexOf("Sign in to publish"));
    const signedIn = form.slice(form.indexOf("<form onSubmit={publish}"));
    expect(signedIn.indexOf("<BreakfastNote />")).toBeGreaterThan(signedIn.indexOf("</form>"));
    expect(signedIn.indexOf("<BreakfastNote />")).toBeLessThan(signedIn.indexOf("<PublishPreview"));
  });

  it("the next step comes first in the Published state, right under its heading", () => {
    const done = form.slice(form.indexOf('if (state.kind === "done")'), form.indexOf('if (state.kind === "removed")'));
    expect(done.indexOf("<BreakfastNextStep />")).toBeGreaterThan(done.indexOf(">Published</h2>"));
    expect(done.indexOf("<BreakfastNextStep />")).toBeLessThan(done.indexOf("<p>Your profile is public now"));
  });

  it("the leaderboard strip is above the board", () => {
    const board = source("app/leaderboard/board-view.tsx");
    expect(board.indexOf("<BreakfastStrip />")).toBeGreaterThan(-1);
    expect(board.indexOf("<BreakfastStrip />")).toBeLessThan(board.indexOf("<YouStrip"));
  });
});

describe("analytics", () => {
  it("counts a Luma click once, with only where it was clicked: never a URL, fragment or handle", () => {
    const code = source("components/site/breakfast.tsx");
    const calls = [...code.matchAll(/track\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(calls).toEqual(["EVENTS.breakfastRegisterClicked, { placement }"]);
    expect([...code.matchAll(/placement="([a-z_]+)"/g)].map((m) => m[1]).sort()).toEqual(["leaderboard", "share_after_publish", "share_before"]);
    expect(source("lib/analytics-sanitize.ts")).toContain('breakfastRegisterClicked: "breakfast_register_clicked"');
  });
});
