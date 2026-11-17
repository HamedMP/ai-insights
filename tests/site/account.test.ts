import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mountsClerk, needsAuthSync } from "../../site/lib/auth-config.ts";
import { avatarFromClerkUser, initials, safeAvatarUrl } from "../../site/lib/avatar.ts";
import { SAVE_ENTRY_SQL } from "../../site/lib/entry-sql.ts";
import { ERRORS, handlePublish, type EntryRow, type PublishDeps } from "../../site/lib/publish.ts";
import type { SharedStats } from "../../site/lib/share.ts";

const SITE = join(import.meta.dirname, "..", "..", "site");
const STATS: SharedStats = { v: 2, name: "Test Person", from: "2026-01-01", to: "2026-02-01", sessions: 40, tokens: 1_000_000, usd: null, activeDays: 20, streak: 6, agents: [{ k: "codex", p: 100 }], fact: "", cards: [] };
const PHOTO = "https://img.clerk.com/eyJ0eXBlIjoicHJveHkifQ";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

describe("where Clerk runs", () => {
  it("mounts Clerk on share, leaderboard, profiles and the API, never on the landing page", () => {
    for (const path of ["/share", "/leaderboard", "/u/ada", "/api/leaderboard/me"]) expect(mountsClerk(path), path).toBe(true);
    for (const path of ["/", "/demo/report.html", "/user", "/uploads", "/sharex"]) expect(mountsClerk(path), path).toBe(false);
  });

  it("syncs the satellite session when a browser opens a profile, so the owner sees it as the owner", () => {
    expect(needsAuthSync("/u/ada", CHROME, "document")).toBe(true);
    expect(needsAuthSync("/leaderboard", CHROME, null)).toBe(true);
    expect(needsAuthSync("/api/leaderboard/entry", CHROME, "empty")).toBe(true);
  });

  it("never sends link-preview crawlers, OG image fetches or the landing page through the sync redirect", () => {
    for (const bot of ["Twitterbot/1.0", "LinkedInBot/1.0", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "WhatsApp/2.23", "Discordbot/2.0", "TelegramBot (like TwitterBot)", "curl/8.4.0", ""]) expect(needsAuthSync("/u/ada", bot, null), bot).toBe(false);
    expect(needsAuthSync("/u/ada/opengraph-image", CHROME, "image")).toBe(false);
    expect(needsAuthSync("/u/ada", CHROME, "empty")).toBe(false);
    expect(needsAuthSync("/", CHROME, "document")).toBe(false);
  });

  it("gives Clerk hosts only to the pages that mount Clerk, and keeps the landing header free of Clerk imports", () => {
    const proxy = readFileSync(join(SITE, "proxy.ts"), "utf8");
    expect(proxy).toContain("mountsClerk(request.nextUrl.pathname) ? cspWithClerk : cspPlain");
    expect(proxy).toContain("const cspPlain = contentSecurityPolicy([], dev)");
    expect(readFileSync(join(SITE, "components/site/header.tsx"), "utf8")).not.toMatch(/from "(?:@clerk\/|@\/components\/site\/(?:account-menu|auth-provider))/);
    expect(readFileSync(join(SITE, "app/page.tsx"), "utf8")).not.toMatch(/@clerk|AccountMenu|AuthProvider/);
    expect(readFileSync(join(SITE, "app/u/layout.tsx"), "utf8")).toContain("<AuthProvider>");
    expect(readFileSync(join(SITE, "scripts/check-build.mjs"), "utf8")).toContain("only pages that mount Clerk may");
  });

  it("builds the signed-out link with buildSignInUrl, so the satellite sync parameter is kept", () => {
    const menu = readFileSync(join(SITE, "components/site/account-menu.tsx"), "utf8");
    expect(menu).toContain("clerk.buildSignInUrl(");
    for (const label of ["My profile", "Leaderboard", "People I referred", "Open Matrix OS"]) expect(menu).toContain(label);
  });
});

describe("profile photos", () => {
  it("accepts only plain https URLs on img.clerk.com", () => {
    expect(safeAvatarUrl(PHOTO)).toBe(PHOTO);
    for (const bad of ["http://img.clerk.com/x", "https://img.clerk.com.evil.example/x", "https://evil.example/img.clerk.com/x", "https://user:pw@img.clerk.com/x", "https://img.clerk.com:8443/x", "javascript:alert(1)", "data:image/png;base64,AAAA", `https://img.clerk.com/${"a".repeat(1100)}`, null, 42]) expect(safeAvatarUrl(bad), String(bad).slice(0, 40)).toBeNull();
  });

  it("takes an uploaded Clerk photo only, never Clerk's generated placeholder", () => {
    expect(avatarFromClerkUser({ imageUrl: PHOTO, hasImage: true })).toBe(PHOTO);
    expect(avatarFromClerkUser({ imageUrl: PHOTO, hasImage: false })).toBeNull();
    expect(avatarFromClerkUser({ imageUrl: "https://evil.example/p.png", hasImage: true })).toBeNull();
    expect(avatarFromClerkUser(null)).toBeNull();
  });

  it("falls back to initials", () => {
    expect(initials("Ada Lovelace King", "ada")).toBe("AL");
    expect(initials("  ", "grace")).toBe("G");
    expect(initials("zoë 🚀", "z")).toBe("Z");
  });
});

describe("publishing with the photo choice", () => {
  function deps(body: unknown, avatar: string | null = PHOTO) {
    const saved: EntryRow[] = [];
    const asked: string[] = [];
    const d: PublishDeps = {
      userId: "user_1", origin: "https://ai-insights.app", allowedOrigins: ["https://ai-insights.app"], contentType: "application/json",
      body: new Blob([JSON.stringify(body)]).stream(), allow: () => true, log: () => undefined, referrer: null,
      save: async (row) => (saved.push(row), "saved"),
      avatarFor: async (id) => (asked.push(id), avatar),
    };
    return { d, saved, asked };
  }

  it("stores the photo read from Clerk on the server only when the person ticked the box", async () => {
    const on = deps({ handle: "test-person", stats: STATS, showAvatar: true });
    expect((await handlePublish(on.d)).status).toBe(200);
    expect(on.asked).toEqual(["user_1"]);
    expect(on.saved[0]!.avatarUrl).toBe(PHOTO);
  });

  it("keeps it off by default and clears it on a republish without the choice, without asking Clerk", async () => {
    for (const body of [{ handle: "test-person", stats: STATS }, { handle: "test-person", stats: STATS, showAvatar: false }]) {
      const off = deps(body);
      expect((await handlePublish(off.d)).status).toBe(200);
      expect(off.asked).toEqual([]);
      expect(off.saved[0]!.avatarUrl).toBeNull();
    }
    expect(SAVE_ENTRY_SQL).toContain("avatar_url = EXCLUDED.avatar_url");
  });

  it("never takes a photo URL from the request, and drops anything not on img.clerk.com", async () => {
    const smuggled = deps({ handle: "test-person", stats: STATS, showAvatar: true, avatarUrl: "https://evil.example/p.png" });
    expect(await handlePublish(smuggled.d)).toEqual({ status: 400, body: { ok: false, error: ERRORS.body } });
    const notBool = deps({ handle: "test-person", stats: STATS, showAvatar: "yes" });
    expect((await handlePublish(notBool.d)).status).toBe(400);
    const odd = deps({ handle: "test-person", stats: STATS, showAvatar: true }, "https://evil.example/p.png");
    await handlePublish(odd.d);
    expect(odd.saved[0]!.avatarUrl).toBeNull();
  });
});
