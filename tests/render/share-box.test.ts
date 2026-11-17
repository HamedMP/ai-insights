import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { recapView } from "../../src/render/view.js";
import type { Recap } from "../../src/schema/types.js";
import { decodeStats } from "../../site/lib/share.js";
import { makeReport } from "./fixtures.js";

const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const D = recapView({ ...makeReport(), recap: RECAP })!;
const NAMES = { "claude-code": "Claude Code", codex: "Codex" };
const DEVICE = "0123456789abcdef0123456789abcdef";
const RATIOS = [
  { key: "correctionsPerSession", value: 0.4, label: "x", unit: "per_session", numerator: 40, denominator: 100 },
  { key: "planFirstShare", value: 0.62, label: "x", unit: "share", numerator: 31, denominator: 50 },
];

/** Just enough of an element for the share box: attributes, children in order, listeners, value and checked. */
class El {
  attrs: Record<string, string> = {};
  kids: Array<El | string> = [];
  on: Record<string, Array<(e: unknown) => void>> = {};
  value = "";
  checked = false;
  constructor(readonly tag: string) {}
  addEventListener(type: string, fn: (e: unknown) => void) { (this.on[type] ||= []).push(fn); }
  replaceChildren(...kids: Array<El | string>) { this.kids = kids; }
  append(...kids: Array<El | string>) { this.kids.push(...kids); }
  get textContent(): string { return this.kids.map((k) => (typeof k === "string" ? k : k.textContent)).join(""); }
  set textContent(v: string) { this.kids = [String(v)]; }
  fire(type: string) { for (const fn of this.on[type] || []) fn({ target: this }); }
}
function h(tag: string, attrs: Record<string, unknown> = {}, ...kids: unknown[]): El {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as (e: unknown) => void);
    else if (k === "value") el.value = String(v);
    else if (k === "checked") el.checked = true;
    else el.attrs[k] = v === true ? "" : String(v);
  }
  for (const k of (kids as unknown[]).flat(Infinity)) if (k != null && k !== false) el.kids.push(k instanceof El ? k : String(k));
  return el;
}
const walk = (el: El): El[] => [el, ...el.kids.flatMap((k) => (typeof k === "string" ? [] : walk(k)))];
const hasClass = (el: El, c: string) => (el.attrs.class || "").split(/\s+/).includes(c);

interface Box { el: El; copied: string[]; opened: string[]; saved: Record<string, unknown> }
/** The share box built by the real client scripts, loaded as the page loads them, with a stand-in for the DOM. */
function box(opts: { deviceId?: string | null; chatOnly?: boolean; stored?: Record<string, unknown> } = {}): Box {
  const context = createContext({ h, TextEncoder, btoa, atob, Date, Uint8Array, Math, Number, String, Array, JSON, Object, Set, console });
  for (const file of ["sharelink.js", "sharebox.js"]) new Script(readFileSync(new URL(`../../src/render/client/${file}`, import.meta.url), "utf8")).runInContext(context);
  const ShareBox = new Script("ShareBox").runInContext(context) as { build(env: unknown): El };
  const copied: string[] = [], opened: string[] = [], saved: Record<string, unknown> = { ...opts.stored };
  const el = ShareBox.build({
    rc: JSON.parse(JSON.stringify(D)),
    ratios: RATIOS,
    deviceId: opts.deviceId === undefined ? DEVICE : opts.deviceId,
    chatOnly: !!opts.chatOnly,
    names: NAMES,
    site: { siteUrl: "https://ai-insights.app/", command: "npx ai-insights@latest", hashtag: "#AIInsights" },
    intent: { x: (t: string) => `https://x.com/intent/post?text=${encodeURIComponent(t)}`, linkedin: (t: string) => `https://www.linkedin.com/feed/?text=${encodeURIComponent(t)}` },
    store: { get: (k: string, d: unknown) => (k in saved ? saved[k] : d), set: (k: string, v: unknown) => { saved[k] = v; } },
    copy: (text: string) => { copied.push(text); },
    open: (url: string) => { opened.push(url); return true; },
  });
  return { el, copied, opened, saved };
}
const all = (b: Box) => walk(b.el);
const button = (b: Box, label: string) => all(b).find((e) => e.tag === "button" && e.textContent === label)!;
/** The link the Copy button hands to the clipboard, decoded the way the site decodes it. */
function copiedPayload(b: Box) {
  button(b, "Copy link").fire("click");
  const link = b.copied.at(-1)!;
  return { link, payload: decodeStats(new URL(link).hash)! };
}
const tiles = (b: Box) => all(b).filter((e) => hasClass(e, "slink-tile"));
const part = (el: El, c: string) => walk(el).find((e) => hasClass(e, c))?.textContent ?? "";
const disclosure = (b: Box) => all(b).find((e) => hasClass(e, "slink-list"))!.kids.map((k) => (k as El).textContent);
const input = (b: Box, label: string) => all(b).find((e) => e.tag === "input" && e.attrs["aria-label"] === label)!;

describe("the publish box", () => {
  it("puts the publish, copy and post buttons before the preview and the collapsed details, so they show without scrolling", () => {
    const b = box();
    const order = all(b);
    const at = (pred: (e: El) => boolean) => order.findIndex(pred);
    const buttons = ["Publish to the leaderboard", "Copy link", "X", "LinkedIn"].map((label) => order.indexOf(button(b, label)));
    expect(buttons.every((i) => i >= 0)).toBe(true);
    expect([...buttons].sort((x, y) => x - y)).toEqual(buttons);
    const preview = at((e) => hasClass(e, "slink-preview"));
    const firstDetails = at((e) => e.tag === "details");
    expect(buttons[3]!).toBeLessThan(preview);
    expect(preview).toBeLessThan(firstDetails);
    expect(hasClass(button(b, "Publish to the leaderboard"), "primary")).toBe(true);
    expect(b.el.attrs.id).toBe("share-stats");
  });

  it("keeps the device options and the exact line list collapsed, each behind a summary", () => {
    const b = box();
    const details = all(b).filter((e) => e.tag === "details");
    expect(details.map((d) => (d.kids[0] as El).tag)).toEqual(["summary", "summary"]);
    expect(details.every((d) => !("open" in d.attrs))).toBe(true);
    const [device, exact] = details as [El, El];
    expect(walk(device).some((e) => e.attrs["aria-label"] === "Name for this computer")).toBe(true);
    expect(walk(device).some((e) => e.tag === "input" && e.attrs.type === "checkbox")).toBe(true);
    expect(walk(exact).some((e) => hasClass(e, "slink-list"))).toBe(true);
    expect(walk(exact).some((e) => hasClass(e, "slink-url"))).toBe(true);
  });

  it("shows one tile per card in the link, in the link's order, with the same headline and caption", () => {
    const b = box();
    const { payload } = copiedPayload(b);
    expect(payload.cards!.length).toBeGreaterThan(8);
    expect(tiles(b).map((t) => [part(t, "slink-tile-big"), part(t, "slink-tile-cap")])).toEqual(payload.cards!.map((c) => [c.b, c.c]));
  });

  it("lists every line of the link in the disclosure, and the raw link beside it", () => {
    const b = box();
    const { link, payload } = copiedPayload(b);
    const context = createContext({ TextEncoder, btoa, atob, Date, Uint8Array, Math, Number, String, Array, JSON, Object, Set, console });
    new Script(readFileSync(new URL("../../src/render/client/sharelink.js", import.meta.url), "utf8")).runInContext(context);
    const SL = new Script("ShareLink").runInContext(context) as { describe(p: unknown, n: unknown): string[] };
    expect(disclosure(b)).toEqual(SL.describe(payload, NAMES));
    expect(disclosure(b).filter((l) => l.startsWith("Card "))).toHaveLength(payload.cards!.length);
    expect(all(b).find((e) => hasClass(e, "slink-url"))!.textContent).toBe(link);
  });

  it("updates the link, the preview and the disclosure as the person types a name", () => {
    const b = box();
    expect(copiedPayload(b).payload.name).toBe("");
    expect(part(b.el, "slink-who")).toContain("Someone");
    const name = input(b, "Display name for the link");
    name.value = "Ada";
    name.fire("input");
    expect(copiedPayload(b).payload.name).toBe("Ada");
    expect(part(b.el, "slink-who")).toContain("Ada");
    expect(disclosure(b)[0]).toBe("Name: Ada");
  });

  it("updates the link and the disclosure from the device name and the days switch, and remembers both", () => {
    const b = box();
    expect(copiedPayload(b).payload.device).toEqual({ id: DEVICE, name: "" });
    expect(copiedPayload(b).payload.days).not.toBeNull();
    const device = input(b, "Name for this computer");
    device.value = "Work laptop";
    device.fire("input");
    const days = all(b).find((e) => e.tag === "input" && e.attrs.type === "checkbox")!;
    days.checked = false;
    days.fire("change");
    const { payload } = copiedPayload(b);
    expect(payload.device).toEqual({ id: DEVICE, name: "Work laptop" });
    expect(payload.days).toBeNull();
    expect(disclosure(b).join("\n")).toContain("“Work laptop”");
    expect(disclosure(b).join("\n")).toContain("Which days you were active: not included");
    expect(b.saved).toMatchObject({ deviceName: "Work laptop", shareDays: false });
  });

  it("leaves the device section out when the store could not make a device id", () => {
    const b = box({ deviceId: null });
    expect(all(b).filter((e) => e.tag === "details")).toHaveLength(1);
    expect(copiedPayload(b).payload.v).toBe(2);
  });

  it("tells a chat-export-only history it will not rank, next to the buttons and before the preview", () => {
    const note = (b: Box) => all(b).find((e) => hasClass(e, "slink-chat"));
    expect(note(box())).toBeUndefined();
    const b = box({ chatOnly: true });
    expect(note(b)!.textContent).toMatch(/not measured.*will not rank/);
    expect(all(b).indexOf(note(b)!)).toBeLessThan(all(b).findIndex((e) => hasClass(e, "slink-preview")));
  });

  it("publishes and posts the same link it previews", () => {
    const b = box();
    const { link } = copiedPayload(b);
    button(b, "Publish to the leaderboard").fire("click");
    button(b, "X").fire("click");
    expect(b.opened[0]).toBe(link);
    expect(decodeURIComponent(b.opened[1]!)).toContain(link);
  });
});

describe("the share preview", () => {
  const SL = (() => {
    const context = createContext({ TextEncoder, btoa, atob, Date, Uint8Array, Math, Number, String, Array, JSON, Object, Set, console });
    new Script(readFileSync(new URL("../../src/render/client/sharelink.js", import.meta.url), "utf8")).runInContext(context);
    return new Script("ShareLink").runInContext(context) as { payload(...a: unknown[]): any; preview(p: unknown, n: unknown): any };
  })();

  it("is built from the payload alone: the totals, the cards and a note for what only the disclosure spells out", () => {
    const p = SL.payload(JSON.parse(JSON.stringify(D)), "Ada", RATIOS, { id: DEVICE, name: "", days: true });
    const v = SL.preview(p, NAMES);
    expect(v.name).toBe("Ada");
    const stats = Object.fromEntries(v.stats.map((s: { label: string; value: string }) => [s.label, s.value]));
    expect(stats.Sessions).toBe(p.sessions.toLocaleString("en-US"));
    expect(stats["Active days"]).toBe(String(p.activeDays));
    expect(stats["Longest streak"]).toBe(`${p.streak} days`);
    expect(stats.Agents).toContain("Claude Code 51%");
    expect(v.cards.map((c: { big: string; caption: string }) => [c.big, c.caption])).toEqual(p.cards.map((c: { b: string; c: string }) => [c.b, c.c]));
    expect(v.also.join(" ")).toMatch(/work ratio/);
    expect(v.also.join(" ")).toMatch(/random id/);
    expect(v.also.join(" ")).toMatch(/which days/);
  });

  it("says tokens are not measured for a chat-export-only history instead of showing 0", () => {
    const p = { v: 2, name: "", from: "2026-01-01", to: "2026-01-31", sessions: 3, tokens: 0, usd: null, activeDays: 2, streak: 1, agents: [], fact: "", cards: [], titles: [], ratios: [] };
    const stats = Object.fromEntries(SL.preview(p, NAMES).stats.map((s: { label: string; value: string }) => [s.label, s.value]));
    expect(stats.Tokens).toBe("not measured");
    expect(stats["Est. spend"]).toBeUndefined();
    expect(stats["Longest streak"]).toBe("1 day");
  });
});
