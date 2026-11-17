import { describe, expect, it } from "vitest";
import { clerkHosts, contentSecurityPolicy } from "../../site/lib/auth-config.ts";
import { agentTokens, checkHandle, parsePage, rankAndPercentile, scoreIn, scoresFor, suggestHandle, MAX_PAGE } from "../../site/lib/leaderboard.ts";
import { createLimiter, ERRORS, handlePublish, handleRemove, MAX_BODY_BYTES, readLimited, type EntryRow, type PublishDeps } from "../../site/lib/publish.ts";
import type { SharedStats } from "../../site/lib/share.ts";
import { metadataPatch, NEW_ACCOUNT_MS } from "../../site/lib/signup-source.ts";

const STATS: SharedStats = { v: 1, name: "Test Person", from: "2026-01-01", to: "2026-02-01", sessions: 40, tokens: 1_000_000, usd: 12.5, activeDays: 20, streak: 6, agents: [{ k: "claude-code", p: 75 }, { k: "codex", p: 25 }], fact: "Forty invented sessions." };
const ORIGIN = "https://ai-insights.app";
const stream = (text: string) => new Blob([text]).stream();

function publishDeps(over: Partial<PublishDeps> = {}): PublishDeps & { saved: EntryRow[] } {
  const saved: EntryRow[] = [];
  return {
    saved,
    userId: "user_1",
    origin: ORIGIN,
    allowedOrigins: [ORIGIN],
    contentType: "application/json",
    body: stream(JSON.stringify({ handle: "test-person", stats: STATS })),
    allow: () => true,
    log: () => undefined,
    save: async (row) => {
      saved.push(row);
      return "saved";
    },
    ...over,
  };
}

describe("public handles", () => {
  it("accepts short lowercase handles and normalises case", () => {
    expect(checkHandle("Ada-Lovelace")).toEqual({ ok: true, handle: "ada-lovelace" });
    expect(checkHandle("a1b")).toEqual({ ok: true, handle: "a1b" });
  });
  it("rejects handles that could break a URL, impersonate the site or look like another person", () => {
    for (const bad of ["ab", "a".repeat(31), "-ada", "ada-", "ad--a", "ada lovelace", "ada/../x", "ädä", "<b>", "", 42, null]) expect(checkHandle(bad).ok, String(bad)).toBe(false);
    for (const reserved of ["admin", "leaderboard", "api", "matrix-os", "support"]) expect(checkHandle(reserved)).toEqual({ ok: false, problem: "reserved" });
  });
  it("suggests a valid handle from a name, or nothing", () => {
    expect(suggestHandle("Grace Hopper!")).toBe("grace-hopper");
    expect(suggestHandle("admin")).toBe("");
    expect(suggestHandle(null)).toBe("");
  });
});

describe("arena scores", () => {
  it("estimates each agent's tokens from its share of sessions, and ranks only positive scores", () => {
    expect(agentTokens(STATS, "claude-code")).toBe(750_000);
    expect(agentTokens(STATS, "codex")).toBe(250_000);
    const scores = scoresFor({ ...STATS, agents: [{ k: "claude-code", p: 100 }], usd: null });
    expect(scoreIn("codex", scores)).toBeNull();
    expect(scoreIn("spend", scores)).toBeNull();
    expect(scoreIn("claude-code", scores)).toBe(1_000_000);
    expect(scoreIn("streak", scores)).toBe(6);
  });
});

describe("rank and percentile", () => {
  it("uses competition ranking and rounds 'top X%' up, never below 1%", () => {
    expect(rankAndPercentile(0, 1000)).toEqual({ rank: 1, total: 1000, topPercent: 1 });
    expect(rankAndPercentile(9, 1000)).toEqual({ rank: 10, total: 1000, topPercent: 1 });
    expect(rankAndPercentile(10, 1000)).toEqual({ rank: 11, total: 1000, topPercent: 2 });
    expect(rankAndPercentile(0, 3)).toEqual({ rank: 1, total: 3, topPercent: 34 });
    expect(rankAndPercentile(2, 3)).toEqual({ rank: 3, total: 3, topPercent: 100 });
  });
  it("refuses impossible inputs instead of inventing a rank", () => {
    expect(rankAndPercentile(0, 0)).toBeNull();
    expect(rankAndPercentile(3, 3)).toBeNull();
    expect(rankAndPercentile(-1, 3)).toBeNull();
    expect(rankAndPercentile(0.5, 3)).toBeNull();
  });
  it("caps and sanitises page numbers from the query string", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(["2"])).toBe(1);
    expect(parsePage("9999")).toBe(MAX_PAGE);
  });
});

describe("publishing", () => {
  it("stores exactly the validated payload numbers under the chosen handle", async () => {
    const deps = publishDeps();
    const reply = await handlePublish(deps);
    expect(reply).toEqual({ status: 200, body: { ok: true, handle: "test-person" } });
    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]).toMatchObject({ userId: "user_1", handle: "test-person", displayName: "Test Person", tokens: 1_000_000, claudeTokens: 750_000, codexTokens: 250_000, streak: 6 });
    expect(deps.saved[0]!.stats).toEqual(STATS);
  });

  it("refuses requests from another site, signed-out requests and rate-limited people before reading the body", async () => {
    for (const [over, status, error] of [
      [{ origin: "https://evil.example" }, 403, ERRORS.origin],
      [{ origin: null }, 403, ERRORS.origin],
      [{ userId: null }, 401, ERRORS.auth],
      [{ allow: () => false }, 429, ERRORS.rate],
    ] as const) {
      const deps = publishDeps(over);
      expect(await handlePublish(deps), JSON.stringify(over)).toEqual({ status, body: { ok: false, error } });
      expect(deps.saved).toHaveLength(0);
    }
  });

  it("refuses non-JSON, oversized, malformed and off-schema bodies with fixed messages", async () => {
    const cases: Array<[Partial<PublishDeps>, number, string]> = [
      [{ contentType: "text/plain" }, 415, ERRORS.type],
      [{ contentType: null }, 415, ERRORS.type],
      [{ body: stream("x".repeat(MAX_BODY_BYTES + 1)) }, 413, ERRORS.size],
      [{ body: stream("{not json") }, 400, ERRORS.body],
      [{ body: stream("[]") }, 400, ERRORS.body],
      [{ body: stream(JSON.stringify({ handle: "test-person", stats: STATS, extra: 1 })) }, 400, ERRORS.body],
      [{ body: stream(JSON.stringify({ handle: "test-person", stats: { ...STATS, v: 2 } })) }, 400, ERRORS.body],
      [{ body: stream(JSON.stringify({ handle: "test-person", stats: { ...STATS, project: "secret" } })) }, 400, ERRORS.body],
      [{ body: stream(JSON.stringify({ handle: "Not A Handle", stats: STATS })) }, 400, ERRORS.handle],
      [{ body: stream(JSON.stringify({ handle: "admin", stats: STATS })) }, 400, ERRORS.reserved],
      [{ body: new Blob([new Uint8Array([0xff, 0xfe])]).stream() }, 400, ERRORS.body],
    ];
    for (const [over, status, error] of cases) {
      const deps = publishDeps(over);
      expect(await handlePublish(deps)).toEqual({ status, body: { ok: false, error } });
      expect(deps.saved).toHaveLength(0);
    }
  });

  it("maps a taken handle and the database's 30-second limit to their messages", async () => {
    expect(await handlePublish(publishDeps({ save: async () => "handle_taken" }))).toEqual({ status: 409, body: { ok: false, error: ERRORS.taken } });
    expect(await handlePublish(publishDeps({ save: async () => "too_soon" }))).toEqual({ status: 429, body: { ok: false, error: ERRORS.rate } });
  });

  it("never sends a database error to the client, and logs it on the server", async () => {
    const logged: string[] = [];
    const reply = await handlePublish(publishDeps({ save: async () => Promise.reject(new Error('relation "leaderboard_entries" password=hunter2')), log: (m) => logged.push(m) }));
    expect(reply).toEqual({ status: 500, body: { ok: false, error: ERRORS.server } });
    expect(JSON.stringify(reply)).not.toMatch(/hunter2|relation/);
    expect(logged).toEqual(["leaderboard publish failed"]);
  });

  it("removes only the signed-in person's own entry, and applies the same gate", async () => {
    const removed: string[] = [];
    const base = { userId: "user_1", origin: ORIGIN, allowedOrigins: [ORIGIN], contentType: null, body: null, allow: () => true, log: () => undefined, remove: async (id: string) => (removed.push(id), true) };
    expect(await handleRemove(base)).toEqual({ status: 200, body: { ok: true, removed: true } });
    expect(removed).toEqual(["user_1"]);
    expect((await handleRemove({ ...base, userId: null })).status).toBe(401);
    expect((await handleRemove({ ...base, origin: "https://evil.example" })).status).toBe(403);
    expect((await handleRemove({ ...base, body: stream("x") })).status).toBe(413);
    expect(removed).toEqual(["user_1"]);
  });

  it("stops reading a body as soon as it passes the limit", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => { pulls += 1; c.enqueue(new Uint8Array(1024)); } });
    expect(await readLimited(endless, 4096)).toBeNull();
    expect(pulls).toBeLessThan(10);
  });
});

describe("rate limiter", () => {
  it("allows a burst per person per window and stays bounded", () => {
    let now = 0;
    const allow = createLimiter({ limit: 2, windowMs: 1000, maxKeys: 3, now: () => now });
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
    now = 1000;
    expect(allow("a")).toBe(true);
    for (const k of ["b", "c", "d", "e"]) expect(allow(k)).toBe(true);
  });
});

describe("sign-up source in Clerk metadata", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  it("marks a brand-new account as signed up from AI Insights and records when it was first seen", () => {
    expect(metadataPatch({ createdAt: now - 60_000, publicMetadata: { plan: "pro" } }, now)).toEqual({ aiInsights: { firstSeenAt: "2026-11-17T12:00:00.000Z" }, signupSource: "ai-insights" });
  });
  it("records first-seen for an older account without claiming its sign-up", () => {
    expect(metadataPatch({ createdAt: now - NEW_ACCOUNT_MS - 1, publicMetadata: {} }, now)).toEqual({ aiInsights: { firstSeenAt: "2026-11-17T12:00:00.000Z" } });
  });
  it("never overwrites an existing source or first-seen time, and keeps other aiInsights keys", () => {
    expect(metadataPatch({ createdAt: now, publicMetadata: { signupSource: "matrix-os", aiInsights: { firstSeenAt: "2026-01-01T00:00:00.000Z" } } }, now)).toBeNull();
    expect(metadataPatch({ createdAt: now, publicMetadata: { signupSource: "matrix-os", aiInsights: { other: 1 } } }, now)).toEqual({ aiInsights: { other: 1, firstSeenAt: "2026-11-17T12:00:00.000Z" } });
  });
});

describe("Clerk hosts and the content security policy", () => {
  const key = `pk_live_${Buffer.from("clerk.matrix.example$").toString("base64")}`;
  it("allows only the Clerk Frontend API hosts for this app, decoded from the publishable key and the satellite domain", () => {
    expect(clerkHosts(key, "ai-insights.app")).toEqual(["clerk.matrix.example", "clerk.ai-insights.app"]);
    expect(clerkHosts("", "")).toEqual([]);
    expect(clerkHosts("pk_live_bm90IGEgaG9zdA==", "")).toEqual([]);
  });
  it("is same-origin only without Clerk, and adds exactly the Clerk hosts with it", () => {
    const off = contentSecurityPolicy([]);
    expect(off).not.toMatch(/https:/);
    expect(off).toContain("default-src 'self'");
    const on = contentSecurityPolicy(["clerk.ai-insights.app"]);
    expect(on.match(/https:\/\/[^\s;]+/g)!.sort()).toEqual(["https://clerk.ai-insights.app", "https://clerk.ai-insights.app", "https://clerk.ai-insights.app", "https://img.clerk.com"]);
    expect(on).not.toMatch(/telemetry|stripe|googleapis|cloudflare/);
  });
});
