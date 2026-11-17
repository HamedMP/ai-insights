import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { clientAssets } from "../../src/render/assets.js";
import { recapView } from "../../src/render/view.js";
import type { Recap } from "../../src/schema/types.js";
import { TITLE_RULES } from "../../src/analysis/recap/titles.js";
import { ratioText as reportRatioText } from "../../src/render/view.js";
import { activeDayNumbers, CARD_KEYS, CARD_TITLES, dayString, decodeStats, EARNED_TITLES, LIMITS, longestRun, RATIO_KEYS, ratioText, validateStats } from "../../site/lib/share.js";
import { makeReport } from "./fixtures.js";

const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const D = recapView({ ...makeReport(), recap: RECAP })!;

interface Card { k: string; b: string; c: string }
interface Payload { v: number; name: string; from: string; to: string; sessions: number; tokens: number; usd: number | null; activeDays: number; streak: number; agents: Array<{ k: string; p: number }>; fact: string; cards?: Card[]; titles?: Array<{ k: string; v: number }>; ratios?: Array<{ k: string; v: number; n?: number }>; device?: { id: string; name: string }; days?: { from: string; bits: string } | null }
interface ShareLinkApi {
  LIMITS: Record<string, number>;
  CARD_KEYS: string[];
  TITLES: Record<string, string>;
  payload(rc: unknown, name?: string, ratios?: unknown, device?: { id: string; name: string; days?: boolean } | null): Payload | null;
  RATIO_KEYS: string[];
  TITLE_RATIO: Record<string, string>;
  encode(p: unknown): string;
  url(p: unknown, base: string): string;
  describe(p: Payload, names?: Record<string, string>): string[];
}

/** The report-side encoder, loaded as the page loads it: a classic script in its own global scope. */
function shareLink(): ShareLinkApi {
  const context = createContext({ TextEncoder, btoa, atob, Date, Uint8Array, Math, Number, String, Array, JSON, Object, Set, console });
  new Script(readFileSync(new URL("../../src/render/client/sharelink.js", import.meta.url), "utf8")).runInContext(context);
  return new Script("ShareLink").runInContext(context) as ShareLinkApi;
}
const SL = shareLink();
const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const view = () => JSON.parse(JSON.stringify(D)) as Record<string, any>;
/** The report view's ratios (VIEW.ratios) and earned titles, as PR #8's analysis makes them. */
const RATIO_VIEW = [
  { key: "correctionsPerSession", value: 0.4, label: "Mid-run corrections", definition: "x", unit: "per_session", numerator: 40, denominator: 100 },
  { key: "contextResetShare", value: 0.12, label: "Sessions that hit a context reset", unit: "share", numerator: 18, denominator: 150 },
  { key: "toolErrorRate", value: 0.046, label: "Tool-call error rate", unit: "share", numerator: 46, denominator: 1000 },
  { key: "planFirstShare", value: 0.62, label: "Started with a plan", unit: "share", numerator: 31, denominator: 50 },
  { key: "parallelism", value: 2.345678, label: "Sessions running at once", unit: "times", numerator: 234.6, denominator: 100.04 },
];
const withTitles = () => {
  const rc = view();
  rc.persona.earned = [
    { key: "architect", title: "The Architect", rule: "62% of sessions that edited files started with a plan (half or more earns it)" },
    { key: "conductor", title: "The Conductor", rule: "2.3 sessions running at once on average (2 or more earns it)" },
  ];
  return rc;
};
const good = () => JSON.parse(JSON.stringify(SL.payload(withTitles(), "Ada", RATIO_VIEW)!)) as Payload;
const card = (p: Payload, k: string) => p.cards!.find((c) => c.k === k);
/** A v1 link exactly as AI Insights 0.3.x reports made it: these exist in people's chats and must keep opening. */
const V1: Payload = { v: 1, name: "Ada", from: "2026-09-24", to: "2026-11-13", sessions: 161, tokens: 921536169, usd: 595.96, activeDays: 42, streak: 7, agents: [{ k: "claude-code", p: 51 }, { k: "codex", p: 42 }], fact: "Ran 7 agents at once." };

describe("share links: report side to site side", () => {
  it("a v2 link made in the report opens on the site with the same numbers and cards", () => {
    const p = good();
    const link = SL.url(p, "https://ai-insights.app/");
    expect(link.startsWith("https://ai-insights.app/share/#")).toBe(true);
    expect(p.v).toBe(2);
    expect(p.cards!.length).toBeGreaterThan(8);
    expect(decodeStats(new URL(link).hash)).toEqual(p);
  });

  it("an old v1 link still opens, unchanged and without cards", () => {
    expect(decodeStats(encodeJson(V1))).toEqual(V1);
    expect(decodeStats(encodeJson(V1))!.cards).toBeUndefined();
  });

  it("carries only aggregate numbers, one fun fact and the cards, small enough for a URL", () => {
    const p = good();
    expect(Object.keys(p).sort()).toEqual(["activeDays", "agents", "cards", "fact", "from", "name", "ratios", "sessions", "streak", "titles", "to", "tokens", "usd", "v"]);
    expect(p.titles).toEqual([{ k: "architect", v: 0.62 }, { k: "conductor", v: 2.3457 }]);
    expect(p.ratios!.map((r) => r.k)).toEqual(RATIO_KEYS);
    expect(p).toMatchObject({ v: 2, name: "Ada", from: "2026-09-24", to: "2026-11-13", sessions: D.totals.sessions, activeDays: 42, streak: 7 });
    expect(p.agents[0]).toEqual({ k: "claude-code", p: 51 });
    expect(p.fact.length).toBeGreaterThan(0);
    const strings = JSON.stringify(p).match(/"(?:[^"\\]|\\.)*"/g)!.map((s) => JSON.parse(s) as string);
    for (const s of strings) expect(/[/\\]/.test(s), s).toBe(false);
    expect(SL.encode(p).length).toBeLessThan(2500);
  });

  it("uses the same card keys and titles on both sides", () => {
    expect([...SL.CARD_KEYS]).toEqual(CARD_KEYS);
    expect({ ...SL.TITLES }).toEqual(CARD_TITLES);
    expect(SL.LIMITS.cards).toBe(LIMITS.cards);
    expect(SL.LIMITS.fragment).toBeLessThan(LIMITS.fragment);
  });

  it("publishes earned titles and ratios as keys and numbers only, and works for reports without them", () => {
    for (const t of good().titles!) expect(Object.keys(t).sort()).toEqual(["k", "v"]);
    const old = SL.payload(view(), "Ada")!;
    expect(old.titles).toEqual([]);
    expect(old.ratios).toEqual([]);
    expect(decodeStats(SL.encode(old))).toEqual(JSON.parse(JSON.stringify(old)));
    const rc = withTitles();
    rc.persona.earned = [{ key: "made_up", title: "The acme-secret-project", rule: "x" }];
    expect(JSON.stringify(SL.payload(rc, "", RATIO_VIEW))).not.toContain("acme");
  });

  it("rebuilds every title and rule on the site exactly as the report's analysis writes them", () => {
    expect(Object.keys(EARNED_TITLES).sort()).toEqual(TITLE_RULES.map((r) => r.key).sort());
    expect(Object.keys(SL.TITLE_RATIO).sort()).toEqual(TITLE_RULES.map((r) => r.key).sort());
    for (const rule of TITLE_RULES) {
      const site = EARNED_TITLES[rule.key as keyof typeof EARNED_TITLES];
      expect([site.title, site.ratio, SL.TITLE_RATIO[rule.key]]).toEqual([rule.title, rule.ratio, rule.ratio]);
      for (const v of [0, 0.03, 0.05, 0.1, 0.3, 0.5, 0.62, 1, 1.1, 2, 2.35, 7]) {
        expect(site.earns(v), `${rule.key} ${v}`).toBe(rule.earns(v));
        expect(site.rule(v)).toBe(rule.rule(v));
      }
    }
    const units: Record<string, string> = { correctionsPerSession: "per_session", contextResetShare: "share", toolErrorRate: "share", planFirstShare: "share", parallelism: "times" };
    for (const k of RATIO_KEYS) for (const v of [0, 0.004, 0.12, 0.5, 1, 2.3457]) expect(ratioText(k, v)).toBe(reportRatioText(v, units[k]!));
  });

  it("survives a name with emoji and non-Latin letters", () => {
    const p = JSON.parse(JSON.stringify(SL.payload(view(), "  Zoë 🚀 李  ")!)) as Payload;
    expect(p.name).toBe("Zoë 🚀 李");
    expect(decodeStats(SL.encode(p))).toEqual(p);
  });

  it("stays under the site's fragment limit even with the longest name and every card", () => {
    const rc = view();
    rc.shell.rmrf = 9_999_999;
    rc.shell.forcePush = 9_999_999;
    rc.history = { days: 99_999, firstDay: "2020-01-01", cachedOnly: 9_999_999 };
    const p = SL.payload(rc, "👩🏽‍💻".repeat(40))!;
    expect(SL.encode(p).length).toBeLessThanOrEqual(SL.LIMITS.fragment!);
    expect(decodeStats(SL.encode(p))).not.toBeNull();
  });

  it("tells the person exactly what the link holds, every card included, before they copy it", () => {
    const p = good();
    const lines = SL.describe(p, { "claude-code": "Claude Code" });
    expect(lines[0]).toBe("Name: Ada");
    expect(lines.join("\n")).toContain("Claude Code 51%");
    for (const c of p.cards!) expect(lines).toContain(`Card “${CARD_TITLES[c.k as keyof typeof CARD_TITLES]}”: ${c.b}${c.c ? `, ${c.c}` : ""}`);
  });

  it("is loaded into the report page", () => {
    expect(clientAssets().script).toContain("const ShareLink = (() =>");
  });
});

/**
 * What each published card may contain. Every headline and caption must match its pattern: numbers, dates, agent and
 * model-family names and fixed words. This is the list the pull request and README describe; a new card or a new
 * field needs a row here.
 */
const N = String.raw`[0-9][0-9,.]*`;
const PUBLISHED: Record<string, { b: RegExp; c: RegExp }> = {
  persona: { b: /^The (Night|Dawn|Golden-Hour|Afternoon|Morning) (Orchestrator|Shipper|Delegator)$/, c: new RegExp(`^${N} sessions? in ${N} days?$`) },
  parallel: { b: new RegExp(`^${N} at once$`), c: new RegExp(`^sessions (side by side, plus ${N} subagents?|running side by side)$`) },
  tokens: { b: new RegExp(`^${N}[KMBT]?$`), c: new RegExp(`^tokens(, about \\$${N} at API list prices| in ${N} model requests?)$`) },
  streak: { b: new RegExp(`^${N} days?$`), c: /^in a row, [A-Z][a-z]{2} \d{1,2} to [A-Z][a-z]{2} \d{1,2}$/ },
  marathon: { b: new RegExp(`^${N} hrs$`), c: /^of active work in one (Claude Code |Codex |Cursor |Pi |OpenCode |Gemini CLI )?session$/ },
  clock: { b: /^(Night owl|Early bird|Golden-hour builder|Afternoon engine|Morning mind)$/, c: /^busiest hour \d\d:00$/ },
  manners: { b: new RegExp(`^${N} pleases?$`), c: new RegExp(`^${N} thank-yous? and ${N} (sorry|sorries) in ${N} prompts?$`) },
  danger: { b: new RegExp(`^${N} × rm -rf$`), c: new RegExp(`^${N} force push(es)? and ${N} naps?\\. Nothing caught fire\\.$`) },
  hours: { b: new RegExp(`^${N} hrs$`), c: new RegExp(`^with an agent at work, ${N} agent-hours in all$`) },
  model: { b: /^(Claude|GPT|O[1-9]|Codex|Gemini|Grok|Deepseek|Qwen|Kimi|Glm|Mistral|Llama)[A-Za-z0-9 .-]*$/, c: new RegExp(`^answered ${N}% of ${N} model requests?$`) },
  weekday: { b: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/, c: new RegExp(`^the busiest day, ${N} prompts?$`) },
  tests: { b: new RegExp(`^${N} runs?$`), c: new RegExp(`^of the tests, ${N}% passed$`) },
  shell: { b: new RegExp(`^${N}$`), c: /^shell commands run by agents$/ },
  failures: { b: new RegExp(`^${N}$`), c: new RegExp(`^failed tool calls, ${N}% of ${N}$`) },
  words: { b: new RegExp(`^${N}[KMBT]?$`), c: new RegExp(`^words in prompts, ${N}% of them questions$`) },
  slash: { b: new RegExp(`^${N}$`), c: /^slash commands typed$/ },
  thinking: { b: new RegExp(`^${N}$`), c: new RegExp(`^thinking blocks(, the longest ${N} (s|min))?$`) },
  approvals: { b: new RegExp(`^${N}$`), c: new RegExp(`^actions approved automatically, ${N} by hand$`) },
  history: { b: new RegExp(`^${N} days?$`), c: new RegExp(`^of (agent history kept|history kept, ${N} sessions? saved from deletion)$`) },
};

/** A recap view with planted text in every free-text field the report has: none of it may reach the payload. */
function lacedView() {
  const rc = view();
  const SECRET = "acme-secret-project";
  rc.voice.words = [{ key: SECRET, count: 99 }];
  rc.voice.openers = [{ key: `${SECRET} please`, count: 9 }];
  rc.slash = [{ key: `/${SECRET}`, count: 50 }];
  rc.slashTotal = 50;
  rc.shell.programs = [{ key: SECRET, count: 99 }];
  rc.shell.rmrf = 3;
  rc.failures.nemesis = [{ key: SECRET, count: 9, runs: 9 }];
  rc.failures.categories = [{ key: "other", label: SECRET, count: 9 }];
  rc.connectors = [{ key: SECRET, count: 9 }];
  rc.skills = [{ key: SECRET, count: 9 }];
  rc.tips = [{ title: `Stop typing ${SECRET}`, kind: "repeated_instruction", metric: null }];
  rc.persona = { ...rc.persona, reason: `Because ${SECRET}` };
  rc.rhythm.verdict = { key: rc.rhythm.verdict.key, label: rc.rhythm.verdict.label };
  rc.longestSession = { ...rc.longestSession, harness: SECRET };
  rc.history = { days: 30, firstDay: "2026-10-01", cachedOnly: 2 };
  return { rc, SECRET };
}

describe("share links: what each card publishes", () => {
  it("every card matches its published-field allowlist", () => {
    const { rc } = lacedView();
    const p = SL.payload(rc, "")!;
    expect(p.cards!.length).toBeGreaterThan(10);
    for (const c of p.cards!) {
      const rule = PUBLISHED[c.k]!;
      expect(rule, `no allowlist row for card ${c.k}`).toBeDefined();
      expect(c.b, `${c.k} headline`).toMatch(rule.b);
      expect(c.c, `${c.k} caption`).toMatch(rule.c);
      expect(Object.keys(c).sort()).toEqual(["b", "c", "k"]);
    }
    expect(Object.keys(PUBLISHED).sort()).toEqual([...CARD_KEYS].sort());
  });

  it("never carries words, slash commands, program names, tips or labels from the history", () => {
    const { rc, SECRET } = lacedView();
    const json = JSON.stringify(SL.payload(rc, ""));
    expect(json).not.toContain(SECRET);
    expect(json.toLowerCase()).not.toContain("acme");
  });

  it("leaves out a persona or model the analysis did not name from its fixed tables", () => {
    const rc = view();
    rc.persona = { ...rc.persona, title: "The acme-secret-project Shipper" };
    rc.models = [{ key: "Claude Opus 4 Acme Internal", harness: "claude-code", requests: 9, share: 1 }];
    const p = SL.payload(rc, "")!;
    expect(card(p, "persona")).toBeUndefined();
    expect(card(p, "model")).toBeUndefined();
    rc.models = [{ key: "Claude Opus 4.6", harness: "claude-code", requests: 9, share: 1 }];
    expect(card(SL.payload(rc, "")!, "model")!.b).toBe("Claude Opus 4.6");
  });

  it("drops a card whose numbers are missing instead of guessing", () => {
    const rc = view();
    rc.streak = { days: 0, start: null, end: null };
    rc.parallel.max = 1;
    const p = SL.payload(rc, "")!;
    expect(card(p, "streak")).toBeUndefined();
    expect(card(p, "parallel")).toBeUndefined();
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
    expect(decodeStats(encodeJson({ ...good(), v: 3 }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), v: 4 }))).toBeNull();
    expect(decodeStats(encodeJson({ ...V1, cards: [] }))).toBeNull();
    const { cards: _drop, ...noCards } = good();
    expect(decodeStats(encodeJson(noCards))).toBeNull();
    const { titles: _t, ...noTitles } = good();
    expect(decodeStats(encodeJson(noTitles))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), project: "/home/someone/secret" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), agents: [{ k: "claude-code", p: 50, x: 1 }] }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), agents: [{ k: "<img src=x>", p: 50 }] }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), agents: Array.from({ length: 9 }, () => ({ k: "codex", p: 1 })) }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), from: "2026-13-40" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), from: "2026-12-01", to: "2026-01-01" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), sessions: "12" }))).toBeNull();
    expect(decodeStats(encodeJson({ ...good(), name: { toString: 1 } }))).toBeNull();
  });

  it("rejects cards that are not exactly the known shape", () => {
    const base = good();
    const bad: unknown[] = [
      "cards",
      {},
      Array.from({ length: LIMITS.cards + 1 }, (_, i) => ({ k: CARD_KEYS[i % CARD_KEYS.length], b: "1", c: "" })),
      [{ k: "streak", b: "1 day", c: "", project: "/home/x" }],
      [{ k: "streak", b: "1 day" }],
      [{ k: "projects", b: "acme", c: "" }],
      [{ k: "__proto__", b: "1", c: "" }],
      [{ k: "streak", b: "1", c: "" }, { k: "streak", b: "2", c: "" }],
      [{ k: "streak", b: 7, c: "" }],
      [{ k: "streak", b: "7", c: null }],
      [{ k: "streak", b: "   ", c: "" }],
      [null],
      [["streak", "7", ""]],
    ];
    for (const cards of bad) expect(validateStats({ ...base, cards }), JSON.stringify(cards).slice(0, 80)).toBeNull();
  });

  it("rejects titles that their own published ratio does not earn, and ratios that are not exact pairs", () => {
    const base = good();
    const bad: Array<Partial<Payload>> = [
      { titles: [{ k: "architect", v: 0.2 }], ratios: [{ k: "planFirstShare", v: 0.2 }] },
      { titles: [{ k: "architect", v: 0.9 }] },
      { titles: [{ k: "architect", v: 0.62 }, { k: "improviser", v: 0.62 }] },
      { titles: [{ k: "the_boss", v: 1 }] },
      { titles: [{ k: "architect", v: 0.62, rule: "I am the best" } as never] },
      { titles: [{ k: "architect", v: 0.62 }], ratios: [] },
      { ratios: [{ k: "planFirstShare", v: 0.62 }, { k: "planFirstShare", v: 0.62 }] },
      { ratios: [{ k: "linesOfCode", v: 1 }] },
      { ratios: [{ k: "parallelism", v: "2" } as never] },
    ];
    for (const over of bad) expect(validateStats({ ...base, ...over }), JSON.stringify(over)).toBeNull();
    const clamped = validateStats({ ...base, titles: [], ratios: [{ k: "toolErrorRate", v: 7 }, { k: "parallelism", v: 1e9 }] })!;
    expect(clamped.ratios).toEqual([{ k: "toolErrorRate", v: 1 }, { k: "parallelism", v: LIMITS.ratio }]);
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

  it("caps strings and strips control and bidi characters, in cards too", () => {
    const out = validateStats({ ...good(), name: "Eve‮\u0000\u0007" + "x".repeat(500), fact: "a\nb​" + "y".repeat(500), cards: [{ k: "streak", b: "7‮ days" + "9".repeat(99), c: "in⁦ a row\u0000" + "z".repeat(300) }] })!;
    expect(out.name.startsWith("Evex")).toBe(true);
    expect(Array.from(out.name).length).toBe(LIMITS.name);
    expect(out.fact.startsWith("a by")).toBe(true);
    expect(Array.from(out.fact).length).toBe(LIMITS.fact);
    const c0 = out.cards![0]!;
    expect(c0.b.startsWith("7 days")).toBe(true);
    expect(Array.from(c0.b).length).toBe(LIMITS.big);
    expect(c0.c.startsWith("in a row")).toBe(true);
    expect(Array.from(c0.c).length).toBe(LIMITS.caption);
    expect(/[\u0000-\u001f‮​⁦]/.test(out.name + out.fact + c0.b + c0.c)).toBe(false);
  });

  it("keeps markup as plain text for the page to render with text nodes", () => {
    const out = validateStats({ ...good(), name: "<script>alert(1)</script>", cards: [{ k: "tokens", b: "<img src=x onerror=alert(1)>", c: "</p><script>" }] })!;
    expect(out.name).toBe("<script>alert(1)</script>");
    expect(out.cards![0]).toEqual({ k: "tokens", b: "<img src=x onerror=alert(1)>", c: "</p><script>" });
  });
});

const DEVICE = "0123456789abcdef0123456789abcdef";
const v3 = (device: { id: string; name: string; days?: boolean } = { id: DEVICE, name: "Work laptop" }) => JSON.parse(JSON.stringify(SL.payload(withTitles(), "Ada", RATIO_VIEW, device)!)) as Payload;
/** A v2 link exactly as AI Insights 0.4 made it, cards and titles included. */
const V2_FROM_04 = good();

describe("share links v3: one entry per computer", () => {
  it("a v3 link carries the random device id, the typed name, ratio counts and active days, and opens on the site unchanged", () => {
    const p = v3();
    expect(p.v).toBe(3);
    expect(p.device).toEqual({ id: DEVICE, name: "Work laptop" });
    expect(p.ratios!.find((r) => r.k === "toolErrorRate")).toEqual({ k: "toolErrorRate", v: 0.046, n: 1000 });
    expect(p.ratios!.find((r) => r.k === "parallelism")!.n).toBe(100);
    expect(Object.keys(p).sort()).toEqual(["activeDays", "agents", "cards", "days", "device", "fact", "from", "name", "ratios", "sessions", "streak", "titles", "to", "tokens", "usd", "v"]);
    expect(decodeStats(SL.encode(p))).toEqual(p);
    expect(SL.encode(p).length).toBeLessThanOrEqual(SL.LIMITS.fragment!);
  });

  it("marks exactly the recap's active days, dates only, and the site reads the same days and streak back", () => {
    const p = v3();
    const marked = activeDayNumbers(p.days!)!;
    const expected = D.daily.filter((d) => d.prompts > 0 || d.minutes > 0).map((d) => d.day);
    expect(marked.map(dayString)).toEqual(expected);
    expect(p.days!.from).toBe(expected[0]);
    expect(longestRun(marked).days).toBe(p.streak);
    expect(Object.keys(p.days!).sort()).toEqual(["bits", "from"]);
    expect(p.days!.bits.length).toBeLessThan(20);
  });

  it("leaves the active days out when the person unticks them", () => {
    const p = v3({ id: DEVICE, name: "", days: false });
    expect(p.days).toBeNull();
    expect(decodeStats(SL.encode(p))!.days).toBeNull();
    expect(SL.describe(p).join("\n")).toContain("Which days you were active: not included");
  });

  it("without a device id (an unwritable store) the link is the v2 link 0.4 made", () => {
    const p = JSON.parse(JSON.stringify(SL.payload(withTitles(), "Ada", RATIO_VIEW, null)!)) as Payload;
    expect(p.v).toBe(2);
    expect(p).toEqual(good());
    expect(p.device).toBeUndefined();
    expect(p.ratios!.every((r) => r.n === undefined)).toBe(true);
    expect(SL.payload(withTitles(), "Ada", RATIO_VIEW, { id: "MY-LAPTOP", name: "x" })!.v).toBe(2);
  });

  it("old v1 and v2 links keep opening on the v3 site", () => {
    expect(decodeStats(encodeJson(V1))).toEqual(V1);
    expect(decodeStats(SL.encode(V2_FROM_04))).toEqual(V2_FROM_04);
    expect(decodeStats(SL.encode(V2_FROM_04))!.device).toBeUndefined();
  });

  it("tells the person the device name, that the id is random, and which days are included", () => {
    const lines = SL.describe(v3());
    const text = lines.join("\n");
    expect(text).toContain("Device: “Work laptop”, random id 0123456789abcdef0123456789abcdef made by AI Insights, not from this computer's name or hardware");
    expect(text).toContain("Which days you were active: 42 dates from 2026-09-24 on (dates only, no counts or times)");
    expect(text).toContain("tool-call error rate 5% of 1,000 tool calls");
    expect(SL.describe(v3({ id: DEVICE, name: "" })).join("\n")).toContain("Device: no name");
  });

  it("cleans the device name like the display name: control and bidi characters out, 32 characters at most", () => {
    const p = v3({ id: DEVICE, name: "Lap‮top\u0000 " + "x".repeat(80) });
    expect(p.device!.name.startsWith("Laptop x")).toBe(true);
    expect(Array.from(p.device!.name).length).toBe(32);
  });
});

describe("share links v3: hostile device ids, names and days", () => {
  it("rejects a device id that is not 32 lowercase hex characters, and a device with extra or missing keys", () => {
    const base = v3();
    const bad: unknown[] = [
      { id: "my-laptop.local", name: "" },
      { id: DEVICE.toUpperCase(), name: "" },
      { id: DEVICE.slice(1), name: "" },
      { id: `${DEVICE}0`, name: "" },
      { id: "00:1a:2b:3c:4d:5e", name: "" },
      { id: DEVICE, name: "", hostname: "box" },
      { id: DEVICE },
      { id: DEVICE, name: 7 },
      { id: 12345, name: "" },
      null,
      "0123456789abcdef0123456789abcdef",
    ];
    for (const device of bad) expect(validateStats({ ...base, device }), JSON.stringify(device)).toBeNull();
    const { device: _d, ...noDevice } = base;
    expect(validateStats(noDevice)).toBeNull();
  });

  it("strips control and bidi characters from a hostile device name and caps it", () => {
    const out = validateStats({ ...v3(), device: { id: DEVICE, name: "<b>‮evil\u0007</b>" + "y".repeat(100) } })!;
    expect(out.device!.name.startsWith("<b>evil</b>")).toBe(true);
    expect(Array.from(out.device!.name).length).toBe(LIMITS.deviceName);
  });

  it("rejects days that disagree with their own totals or are not a bitmap", () => {
    const base = v3();
    const bits = (days: number[]) => { const b = new Uint8Array(Math.ceil((Math.max(...days) + 1) / 8)); for (const d of days) b[d >> 3]! |= 1 << (d & 7); return Buffer.from(b).toString("base64url"); };
    const bad: unknown[] = [
      { from: "2026-09-24", bits: "not base64!" },
      { from: "2026-09-24", bits: "" },
      { from: "2026-09-24", bits: bits([1, 2]) },
      { from: "2026-11-13", bits: bits([0, 1]) },
      { from: "2026-09-24", bits: bits(Array.from({ length: 43 }, (_, i) => i * 1)) },
      { from: "2026-09-24", bits: bits([0, 1, 2, 3, 4, 5, 6, 7]) },
      { from: "2026-02-30", bits: bits([0]) },
      { from: "2026-09-24", bits: "A".repeat(700) },
      { from: "2026-09-24", bits: bits([0]), extra: 1 },
      { from: "2026-09-24" },
      "2026-09-24",
    ];
    for (const days of bad) expect(validateStats({ ...base, days }), JSON.stringify(days).slice(0, 60)).toBeNull();
    expect(validateStats({ ...base, days: { from: "2026-09-24", bits: bits([0, 2, 4]) } })!.days).toEqual({ from: "2026-09-24", bits: bits([0, 2, 4]) });
  });

  it("rejects v3 ratios without their counts, and v2 ratios with them", () => {
    const base = v3();
    expect(validateStats({ ...base, ratios: base.ratios!.map(({ k, v }) => ({ k, v })) })).toBeNull();
    expect(validateStats({ ...good(), ratios: good().ratios!.map((r) => ({ ...r, n: 3 })) })).toBeNull();
    expect(validateStats({ ...base, ratios: [{ k: "toolErrorRate", v: 0.1, n: "9" }], titles: [] })).toBeNull();
    expect(validateStats({ ...base, ratios: [{ k: "toolErrorRate", v: 0.1, n: 1e30 }], titles: [] })!.ratios).toEqual([{ k: "toolErrorRate", v: 0.1, n: LIMITS.base }]);
  });
});
