import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileBadges } from "../../site/lib/arena-format.ts";
import { SAVE_ENTRY_SQL } from "../../site/lib/entry-sql.ts";
import { handlePublish, type EntryRow, type PublishDeps } from "../../site/lib/publish.ts";
import { referralClaim, referralLink, referralToStore, REF_MAX_AGE_SECONDS } from "../../site/lib/referral.ts";
import { storedCards, type SharedStats } from "../../site/lib/share.ts";
import { referralPatch } from "../../site/lib/signup-source.ts";

const SITE = join(import.meta.dirname, "..", "..", "site");
const STATS: SharedStats = { v: 2, name: "Test Person", from: "2026-01-01", to: "2026-02-01", sessions: 40, tokens: 1_000_000, usd: 12.5, activeDays: 20, streak: 6, agents: [{ k: "codex", p: 100 }], fact: "", cards: [{ k: "streak", b: "6 days", c: "in a row, Jan 3 to Jan 8" }], titles: [], ratios: [] };
const arrive = (over: Partial<Parameters<typeof referralToStore>[0]>) => referralToStore({ pathname: "/", ref: null, existing: null, fetchSite: "cross-site", ...over });

describe("referral arrival: who gets remembered", () => {
  it("remembers ?ref=<handle> on any page, normalised", () => {
    expect(arrive({ ref: "Ada" })).toBe("ada");
    expect(arrive({ pathname: "/leaderboard", ref: "grace-h", fetchSite: "same-origin" })).toBe("grace-h");
  });

  it("counts arriving at a profile from outside the site, not clicking one inside it", () => {
    expect(arrive({ pathname: "/u/ada" })).toBe("ada");
    expect(arrive({ pathname: "/u/ada", fetchSite: "none" })).toBe("ada");
    expect(arrive({ pathname: "/u/ada", fetchSite: null })).toBe("ada");
    expect(arrive({ pathname: "/u/ada", fetchSite: "same-origin" })).toBeNull();
    expect(arrive({ pathname: "/u/ada/opengraph-image" })).toBeNull();
  });

  it("keeps the first referrer: a later link never replaces it", () => {
    expect(arrive({ ref: "grace", existing: "ada" })).toBeNull();
    expect(arrive({ pathname: "/u/grace", existing: "ada" })).toBeNull();
  });

  it("ignores anything that is not a valid public handle, and replaces a garbage cookie", () => {
    for (const bad of ["<script>", "a", "admin", "x".repeat(40), "ada--b", "", "%E0%A4%A"]) expect(arrive({ ref: bad }), bad).toBeNull();
    expect(arrive({ pathname: "/u/%E0%A4%A" })).toBeNull();
    expect(arrive({ pathname: "/u/..%2Fapi" })).toBeNull();
    expect(arrive({ ref: "ada", existing: "<b>junk</b>" })).toBe("ada");
  });

  it("is kept for 30 days", () => {
    expect(REF_MAX_AGE_SECONDS).toBe(30 * 24 * 3600);
  });

  it("builds share links that credit the person", () => {
    expect(referralLink("https://ai-insights.app/", "ada")).toBe("https://ai-insights.app/u/ada?ref=ada");
  });
});

describe("referral credit on publish", () => {
  function deps(over: Partial<PublishDeps> = {}) {
    const saved: EntryRow[] = [];
    const credited: Array<[string, string]> = [];
    const d: PublishDeps = {
      userId: "user_2",
      origin: "https://ai-insights.app",
      allowedOrigins: ["https://ai-insights.app"],
      contentType: "application/json",
      body: new Blob([JSON.stringify({ handle: "newcomer", stats: STATS })]).stream(),
      allow: () => true,
      log: () => undefined,
      referrer: "ada",
      save: async (row) => (saved.push(row), { result: "saved", credited: row.referrer }),
      onCredited: (userId, handle) => credited.push([userId, handle]),
      ...over,
    };
    return { d, saved, credited };
  }

  it("passes a valid claim to the save and mirrors a credited referral to Clerk", async () => {
    const { d, saved, credited } = deps();
    expect(await handlePublish(d)).toEqual({ status: 200, body: { ok: true, handle: "newcomer", referred: true } });
    expect(saved[0]!.referrer).toBe("ada");
    expect(saved[0]!.stats.cards).toEqual(STATS.cards);
    expect(credited).toEqual([["user_2", "ada"]]);
  });

  it("never claims a self-referral, an invalid handle or a missing cookie", async () => {
    for (const referrer of ["newcomer", "NEWCOMER", "<b>", "admin", null]) {
      const { d, saved } = deps({ referrer });
      await handlePublish(d);
      expect(saved[0]!.referrer, String(referrer)).toBeNull();
    }
    expect(referralClaim("Ada", "newcomer")).toBe("ada");
  });

  it("reports no referral when the database did not credit one (republish or unknown handle)", async () => {
    const { d, credited } = deps({ save: async () => ({ result: "saved", credited: null }) });
    expect(await handlePublish(d)).toEqual({ status: 200, body: { ok: true, handle: "newcomer" } });
    expect(credited).toEqual([]);
  });

  it("credits only on the insert branch of the publish statement, and checks the handle belongs to someone else", () => {
    const [insertPart, updatePart] = SAVE_ENTRY_SQL.split("ON CONFLICT");
    expect(insertPart).toContain("referred_by");
    expect(updatePart).not.toContain("referred_by =");
    expect(updatePart).toContain("cards = EXCLUDED.cards");
    expect(SAVE_ENTRY_SQL).toMatch(/WHERE handle = \$17 AND user_id <> \$1/);
  });

  it("clears the claim after a publish and reads it only from the HttpOnly cookie", () => {
    const route = readFileSync(join(SITE, "app/api/leaderboard/entry/route.ts"), "utf8");
    expect(route).toContain("request.cookies.get(REF_COOKIE)");
    expect(route).toContain("res.cookies.delete(REF_COOKIE)");
    const proxy = readFileSync(join(SITE, "proxy.ts"), "utf8");
    expect(proxy).toMatch(/httpOnly: true/);
    expect(proxy).toMatch(/sameSite: "lax"/);
  });
});

describe("referral in Clerk metadata", () => {
  it("records referredBy once and never replaces it", () => {
    expect(referralPatch({ plan: "pro" }, "ada")).toEqual({ referredBy: "ada" });
    expect(referralPatch(null, "ada")).toEqual({ referredBy: "ada" });
    expect(referralPatch({ referredBy: "grace" }, "ada")).toBeNull();
  });
});

describe("profile badges", () => {
  it("shows a place inside the top ten and a percentage below it, best first", () => {
    const badges = profileBadges({
      tokens: { rank: 3, total: 400, topPercent: 1 },
      codex: { rank: 41, total: 400, topPercent: 11 },
      streak: { rank: 1, total: 400, topPercent: 1 },
      spend: { rank: 30, total: 1000, topPercent: 3 },
    });
    expect(badges.map((b) => b.label)).toEqual(["#1 Longest streak", "#3 Most tokens", "Top 3% in spend", "Top 11% in Codex"]);
    expect(badges.map((b) => b.tone)).toEqual(["gold", "bronze", "hot", "plain"]);
    expect(profileBadges({})).toEqual([]);
  });
});

describe("stored cards", () => {
  it("drops odd rows read back from the database instead of failing the profile", () => {
    expect(storedCards(null)).toEqual([]);
    expect(storedCards([{ k: "streak", b: "6 days", c: "" }, { k: "nope", b: "x", c: "" }, { k: "streak", b: "dup", c: "" }, "junk"])).toEqual([{ k: "streak", b: "6 days", c: "" }]);
  });
});
