import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { clientAssets } from "../../src/render/assets.js";
import { recapView } from "../../src/render/view.js";
import type { Recap } from "../../src/schema/types.js";
import { decodeStats, LIMITS, validateStats } from "../../site/lib/share.js";
import { makeReport } from "./fixtures.js";

const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const D = recapView({ ...makeReport(), recap: RECAP })!;

interface Payload { v: number; name: string; from: string; to: string; sessions: number; tokens: number; usd: number | null; activeDays: number; streak: number; agents: Array<{ k: string; p: number }>; fact: string }
interface ShareLinkApi {
  payload(rc: unknown, name?: string): Payload | null;
  encode(p: unknown): string;
  url(p: unknown, base: string): string;
  describe(p: Payload, names?: Record<string, string>): string[];
}

/** The report-side encoder, loaded as the page loads it: a classic script in its own global scope. */
function shareLink(): ShareLinkApi {
  const context = createContext({ TextEncoder, btoa, Math, Number, String, Array, JSON, Object });
  new Script(readFileSync(new URL("../../src/render/client/sharelink.js", import.meta.url), "utf8")).runInContext(context);
  return new Script("ShareLink").runInContext(context) as ShareLinkApi;
}
const SL = shareLink();
const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const good = () => JSON.parse(JSON.stringify(SL.payload(JSON.parse(JSON.stringify(D)), "Ada")!)) as Payload;

describe("share links: report side to site side", () => {
  it("a link made in the report opens on the site with the same numbers", () => {
    const p = good();
    const link = SL.url(p, "https://hamedmp.github.io/ai-insights/");
    expect(link.startsWith("https://hamedmp.github.io/ai-insights/share/#")).toBe(true);
    expect(decodeStats(new URL(link).hash)).toEqual(p);
  });

  it("carries only aggregate numbers and one fun fact, small enough for a URL", () => {
    const p = good();
    expect(Object.keys(p).sort()).toEqual(["activeDays", "agents", "fact", "from", "name", "sessions", "streak", "to", "tokens", "usd", "v"]);
    expect(p).toMatchObject({ v: 1, name: "Ada", from: "2026-09-24", to: "2026-11-13", sessions: D.totals.sessions, activeDays: 42, streak: 7 });
    expect(p.agents[0]).toEqual({ k: "claude-code", p: 51 });
    expect(p.fact.length).toBeGreaterThan(0);
    // No project names, paths or prompt text from the recap: every string is the name, a date, a key or the fact.
    const strings = JSON.stringify(p).match(/"(?:[^"\\]|\\.)*"/g)!.map((s) => JSON.parse(s) as string);
    for (const s of strings) expect(/[/\\]/.test(s), s).toBe(false);
    expect(SL.encode(p).length).toBeLessThan(1500);
  });

  it("survives a name with emoji and non-Latin letters", () => {
    const p = JSON.parse(JSON.stringify(SL.payload(JSON.parse(JSON.stringify(D)), "  Zoë 🚀 李  ")!)) as Payload;
    expect(p.name).toBe("Zoë 🚀 李");
    expect(decodeStats(SL.encode(p))).toEqual(p);
  });

  it("tells the person exactly what the link holds before they copy it", () => {
    const lines = SL.describe(good(), { "claude-code": "Claude Code" });
    expect(lines[0]).toBe("Name: Ada");
    expect(lines.join("\n")).toContain("Claude Code 51%");
  });

  it("is loaded into the report page", () => {
    expect(clientAssets().script).toContain("const ShareLink = (() =>");
  });
});

describe("share links: hostile fragments", () => {
  it("rejects garbage, oversize, wrong versions and extra keys", () => {
    expect(decodeStats("")).toBeNull();
    expect(decodeStats("#")).toBeNull();
    expect(decodeStats("#not base64!")).toBeNull();
    expect(decodeStats("#" + "A".repeat(LIMITS.fragment + 1))).toBeNull();
    expect(decodeStats(Buffer.from("{not json").toString("base64url"))).toBeNull();
    expect(decodeStats(Buffer.from([0xff, 0xfe, 0x00]).toString("base64url"))).toBeNull();
    expect(decodeStats(encodeJson([1, 2]))).toBeNull();
    expect(decodeStats(encodeJson(null))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), v: 2 }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), project: "/home/someone/secret" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), agents: [{ k: "claude-code", p: 50, x: 1 }] }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), agents: [{ k: "<img src=x>", p: 50 }] }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), agents: Array.from({ length: 9 }, () => ({ k: "codex", p: 1 })) }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), from: "2026-13-40" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), from: "2026-12-01", to: "2026-01-01" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), sessions: "12" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), name: { toString: 1 } }))).toBeNull();
  });

  it("does not let __proto__ smuggle keys past the schema", () => {
    const json = JSON.stringify(good()).replace(/^\{/, '{"__proto__":{"admin":true},');
    expect(decodeStats(Buffer.from(json).toString("base64url"))).toBeNull();
  });

  it("clamps every number into range", () => {
    const out = validateStats({ ...good(), sessions: 1e30, tokens: -5, usd: 1e99, activeDays: 99999, streak: 99999, agents: [{ k: "codex", p: 400 }] })!;
    expect(out).toMatchObject({ sessions: LIMITS.sessions, tokens: 0, usd: LIMITS.usd, activeDays: LIMITS.days, streak: LIMITS.days, agents: [{ k: "codex", p: 100 }] });
    expect(validateStats({ ...good(), streak: 50, activeDays: 3 })!.streak).toBe(3);
  });

  it("caps strings and strips control and bidi characters", () => {
    const out = validateStats({ ...good(), name: "Eve‮\u0000\u0007" + "x".repeat(500), fact: "a\nb​" + "y".repeat(500) })!;
    expect(out.name.startsWith("Evex")).toBe(true);
    expect(Array.from(out.name).length).toBe(LIMITS.name);
    expect(out.fact.startsWith("a by")).toBe(true);
    expect(Array.from(out.fact).length).toBe(LIMITS.fact);
    expect(/[\u0000-\u001f‮​]/.test(out.name + out.fact)).toBe(false);
  });

  it("keeps markup as plain text for the page to render with text nodes", () => {
    const out = validateStats({ ...good(), name: "<script>alert(1)</script>" })!;
    expect(out.name).toBe("<script>alert(1)</script>");
  });
});
