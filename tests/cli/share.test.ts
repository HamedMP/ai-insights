import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import { osc52, reportData } from "../../src/cli/share.js";
import { renderReport } from "../../src/render/index.js";
import type { Harness, Session } from "../../src/schema/types.js";
import { DEVICE_ID } from "../../src/store/device.js";
import { decodeStats } from "../../site/lib/share.js";
import { fakeSource, makeSession, tempHome } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;

/** Two weeks of synthetic sessions across two coding agents and an imported chat, enough for a recap with cards. */
function history(): Session[] {
  const sessions: Session[] = [];
  for (let day = 1; day <= 14; day += 1) {
    const date = `2026-11-${String(day).padStart(2, "0")}`;
    const harness: Harness = day % 3 === 0 ? "codex" : "claude-code";
    for (const hour of [9, 14]) {
      const at = `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;
      sessions.push(
        makeSession({
          id: `${harness}-${date}-${hour}`,
          harness,
          startTime: at,
          endTime: `${date}T${String(hour).padStart(2, "0")}:40:00.000Z`,
          sourceMtimeMs: Date.parse(at),
          prompts: Array.from({ length: 4 }, (_, i) => ({ timestamp: at, text: `please add test ${i}` })),
          userMessageCount: 4,
        }),
      );
    }
  }
  sessions.push(makeSession({ id: "chat-1", harness: "claude-chat", startTime: "2026-11-05T10:00:00.000Z", endTime: "2026-11-05T10:10:00.000Z", requests: [], toolCalls: [], models: [] }));
  return sessions;
}

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  const sessions = history();
  const byHarness = (h: Harness) => sessions.filter((s) => s.harness === h);
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { AI_INSIGHTS_HOME: home },
    sources: (["claude-code", "codex", "claude-chat"] as const).map((h) => fakeSource(h, byHarness(h))),
    buildReport,
    renderReport,
    now: () => new Date("2026-11-15T12:00:00Z"),
    timeZone: "UTC",
    openFile: async () => {},
    startMcp: async () => {},
    retentionPolicies: async () => new Map(),
    platform: "darwin",
    ...overrides,
  };
}

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  err = "";
});
afterEach(async () => cleanup());

const linkIn = (text: string) => {
  const lines = text.split("\n").filter((line) => line.startsWith("https://"));
  expect(lines).toHaveLength(1);
  return lines[0]!;
};

// -- the report's own share box, built by the real client scripts with a stand-in for the DOM ---------------------

class El {
  attrs: Record<string, string> = {};
  kids: Array<El | string> = [];
  on: Record<string, Array<(e: unknown) => void>> = {};
  value = "";
  checked = false;
  constructor(readonly tag: string) {}
  addEventListener(type: string, fn: (e: unknown) => void) { (this.on[type] ||= []).push(fn); }
  replaceChildren(...kids: Array<El | string>) { this.kids = kids; }
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
const HARNESS_NAMES = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", pi: "Pi", opencode: "OpenCode", gemini: "Gemini CLI", "claude-chat": "Claude chat", chatgpt: "ChatGPT" };

/** What the report's share box shows as its raw link and line list, after the person types and ticks as given. */
function reportBox(view: Record<string, any>, choices: { name?: string; device?: string; days?: boolean }) {
  const context = createContext({ h, TextEncoder, btoa, atob, console });
  for (const file of ["sharelink.js", "sharebox.js"]) new Script(readFileSync(new URL(`../../src/render/client/${file}`, import.meta.url), "utf8")).runInContext(context);
  const ShareBox = new Script("ShareBox").runInContext(context) as { build(env: unknown): El };
  const saved: Record<string, unknown> = {};
  const el = ShareBox.build({
    rc: view.recap, ratios: view.ratios, deviceId: view.deviceId, chatOnly: false, names: HARNESS_NAMES,
    site: { siteUrl: "https://ai-insights.app/", command: "npx ai-insights@latest", hashtag: "#MyAIInsights" },
    intent: { x: (t: string) => t, linkedin: (t: string) => t },
    store: { get: (k: string, d: unknown) => (k in saved ? saved[k] : d), set: (k: string, v: unknown) => { saved[k] = v; } },
    copy: () => {}, open: () => true,
  });
  const all = walk(el);
  const input = (label: string) => all.find((e) => e.tag === "input" && e.attrs["aria-label"] === label)!;
  if (choices.name !== undefined) { input("Display name for the link").value = choices.name; input("Display name for the link").fire("input"); }
  if (choices.device !== undefined) { input("Name for this computer").value = choices.device; input("Name for this computer").fire("input"); }
  if (choices.days === false) { const box = all.find((e) => e.tag === "input" && e.attrs.type === "checkbox")!; box.checked = false; box.fire("change"); }
  const has = (e: El, c: string) => (e.attrs.class || "").split(/\s+/).includes(c);
  return { link: all.find((e) => has(e, "slink-url"))!.textContent, lines: all.find((e) => has(e, "slink-list"))!.kids.map((k) => (k as El).textContent) };
}

const writtenView = async () => reportData(await readFile(join(home, "reports", "report.html"), "utf8"))!;

describe("ai-insights share", () => {
  it("prints the same link the report's Publish button makes for the same store, byte for byte", async () => {
    expect(await run(["share"], deps())).toBe(0);
    const view = await writtenView();
    expect(view.deviceId).toMatch(DEVICE_ID);
    expect(linkIn(out)).toBe(reportBox(view, {}).link);
  });

  it("matches the report for a typed name, a device name and the days switch turned off", async () => {
    for (const [args, choices] of [
      [["--name", "Ada"], { name: "Ada" }],
      [["--device", "Work laptop"], { device: "Work laptop" }],
      [["--no-days"], { days: false }],
      [["--name", "Ada", "--device", "VPS", "--no-days"], { name: "Ada", device: "VPS", days: false }],
    ] as const) {
      out = "";
      expect(await run(["share", ...args], deps())).toBe(0);
      const box = reportBox(await writtenView(), choices);
      expect(linkIn(out)).toBe(box.link);
      // The disclosure is the share box's own "exactly these lines" list, in the same words.
      for (const line of box.lines) expect(out).toContain(`  ${line}\n`);
    }
  });

  it("opens on the site's /share page as a v3 payload with this store's device id, days by default, and no chat export in the agent split", async () => {
    expect(await run(["share", "--name", "Ada", "--device", "VPS"], deps())).toBe(0);
    const link = linkIn(out);
    expect(link.startsWith("https://ai-insights.app/share/#")).toBe(true);
    const payload = decodeStats(new URL(link).hash)!;
    expect(payload).not.toBeNull();
    const device = JSON.parse(await readFile(join(home, "device.json"), "utf8")) as { id: string };
    expect(payload).toMatchObject({ v: 3, name: "Ada", device: { id: device.id, name: "VPS" } });
    expect(payload.days?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.agents.map((a) => a.k).sort()).toEqual(["claude-code", "codex"]);
    expect(payload.sessions).toBe(29);

    out = "";
    expect(await run(["share", "--no-days"], deps())).toBe(0);
    expect(decodeStats(new URL(linkIn(out)).hash)!.days).toBeNull();
    expect(out).toContain("Which days you were active: not included");
  });

  it("says what the link holds and that the numbers travel in the fragment before the link, then prints the link alone on its line", async () => {
    expect(await run(["share"], deps())).toBe(0);
    const lines = out.split("\n");
    const at = lines.findIndex((line) => line.startsWith("https://"));
    expect(lines[0]).toBe("Your stats share link. It holds exactly these lines:");
    expect(lines.slice(0, at).join("\n")).toContain("#fragment");
    expect(lines.slice(0, at).join("\n")).toContain("press Publish");
    expect(lines[at - 1]).toBe("");
    expect(lines[at + 1]).toBe("");
    expect(out).not.toContain("\u001b");
  });

  it("saves the link to a file in the store, for terminals that wrap long lines", async () => {
    expect(await run(["share"], deps())).toBe(0);
    const file = join(home, "share-link.txt");
    expect(out).toContain(`Also saved to ${file}`);
    expect(await readFile(file, "utf8")).toBe(`${linkIn(out)}\n`);
  });

  it("asks the terminal to copy the link with --copy, and only at a terminal", async () => {
    expect(await run(["share", "--copy"], deps({ terminal: { isTTY: true, stdin: true, stderr: true } }))).toBe(0);
    const link = linkIn(out.replace(/\u001b\]52;c;[A-Za-z0-9+/=]+\u0007/, ""));
    expect(out).toContain(osc52(link));
    expect(out).toContain("OSC 52");

    out = "";
    expect(await run(["share", "--copy"], deps())).toBe(0);
    expect(out).not.toContain("\u001b");
    expect(out).toContain("--copy needs a terminal");
  });

  it("never puts anything but the link's printable characters in the copy sequence", () => {
    expect(osc52("https://ai-insights.app/share/#abc")).toBe(`\u001b]52;c;${Buffer.from("https://ai-insights.app/share/#abc").toString("base64")}\u0007`);
    expect(() => osc52("https://x/\u0007\u001b]0;pwned")).toThrow();
    expect(() => osc52("a b")).toThrow();
  });

  it("says so and exits 1 when there is no history to share", async () => {
    expect(await run(["share"], deps({ sources: [fakeSource("claude-code", [])] }))).toBe(1);
    expect(out).toBe("");
  });

  it("rejects share options on other commands instead of ignoring them", async () => {
    expect(await run(["--name", "Ada"], deps())).toBe(2);
    expect(err).toContain("--name only works with `ai-insights share`");
    err = "";
    expect(await run(["report", "--copy"], deps())).toBe(2);
    expect(err).toContain("--copy only works with `ai-insights share`");
  });
});

describe("reading the report's data block", () => {
  it("reads it the way the page does and refuses anything that is not a report", () => {
    expect(reportData('<p>x</p><script id="report-data" type="application/json">{"a":"\\u003c/script>"}</script>')).toEqual({ a: "</script>" });
    expect(reportData("<html></html>")).toBeNull();
    expect(reportData('<script id="report-data" type="application/json">not json</script>')).toBeNull();
    expect(reportData('<script id="report-data" type="application/json">[1]</script>')).toBeNull();
  });
});
