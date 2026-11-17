import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_CHECKED_COOKIE, clerkRun, contentSecurityPolicy, mountsClerk, needsAuthSync } from "../../site/lib/auth-config.ts";
import { hasSessionHint, returnPath } from "../../site/lib/session-hint.ts";
import { avatarFromClerkUser, initials, safeAvatarUrl } from "../../site/lib/avatar.ts";
import { SAVE_ENTRY_SQL } from "../../site/lib/entry-sql.ts";
import { ERRORS, handlePublish, type EntryRow, type PublishDeps } from "../../site/lib/publish.ts";
import type { SharedStats } from "../../site/lib/share.ts";

const SITE = join(import.meta.dirname, "..", "..", "site");
const STATS: SharedStats = { v: 2, name: "Test Person", from: "2026-01-01", to: "2026-02-01", sessions: 40, tokens: 1_000_000, usd: null, activeDays: 20, streak: 6, agents: [{ k: "codex", p: 100 }], fact: "", cards: [], titles: [], ratios: [] };
const PHOTO = "https://img.clerk.com/eyJ0eXBlIjoicHJveHkifQ";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

describe("where Clerk runs", () => {
  it("mounts Clerk on share, leaderboard, profiles and the API, never on the landing page", () => {
    for (const path of ["/share", "/leaderboard", "/u/ada", "/account/sign-in", "/api/leaderboard/me"]) expect(mountsClerk(path), path).toBe(true);
    for (const path of ["/", "/docs", "/docs/sharing", "/demo/report.html", "/user", "/uploads", "/sharex", "/accounts"]) expect(mountsClerk(path), path).toBe(false);
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

  it("gives Clerk hosts to pages that mount Clerk and to signed-in browsers only; anonymous visitors elsewhere get none", () => {
    const proxy = readFileSync(join(SITE, "proxy.ts"), "utf8");
    expect(proxy).toContain("mountsClerk(pathname) || (serverAuthEnabled() && hasSessionHint(cookies)) ? cspWithClerk : cspPlain");
    expect(proxy).toContain("const cspPlain = contentSecurityPolicy([], dev)");
    // Pages that do not mount Clerk never run its middleware, so the landing page never takes a sync or handshake redirect.
    expect(proxy).toContain('if (!clerk || run === "skip") return withHeaders(request, pass(request), run)');
    expect(clerkRun({ pathname: "/", search: "", userAgent: CHROME, fetchDest: "document", cookies: "__client_uat=1763000000" })).toBe("skip");
    expect(contentSecurityPolicy([])).not.toMatch(/clerk/);
  });

  it("keeps the shared header and its landing account slot free of Clerk imports; the account menu loads only on demand", () => {
    const staticClerk = /from "(?:@clerk\/|@\/components\/site\/(?:account-menu|auth-provider|clerk-slot))/;
    expect(readFileSync(join(SITE, "components/site/header.tsx"), "utf8")).not.toMatch(staticClerk);
    const slot = readFileSync(join(SITE, "components/site/session-account.tsx"), "utf8");
    expect(slot).not.toMatch(staticClerk);
    expect(slot).toContain('React.lazy(() => import("@/components/site/clerk-slot"))');
    expect(slot).toContain("hasSessionHint(document.cookie)");
    expect(readFileSync(join(SITE, "app/page.tsx"), "utf8")).not.toMatch(/@clerk|AccountMenu|AuthProvider/);
    // The cached board and profiles mount Clerk the same way: per signed-in part, on demand (clerk-island.tsx).
    for (const path of ["app/leaderboard/layout.tsx", "app/leaderboard/board-view.tsx", "app/u/[handle]/page.tsx", "components/site/you-strip.tsx"]) expect(readFileSync(join(SITE, path), "utf8"), path).not.toMatch(staticClerk);
    // The share page's card and publish panel import Clerk: a profile must not pull them in for its call to action.
    expect(readFileSync(join(SITE, "app/u/[handle]/page.tsx"), "utf8")).not.toMatch(/components\/site\/(?:share-card|publish-panel|publish-form)"/);
    const island = readFileSync(join(SITE, "components/site/clerk-island.tsx"), "utf8");
    expect(island).not.toMatch(staticClerk);
    expect(island).toContain('React.lazy(() => import("@/components/site/clerk-island-provider"))');
    expect(island).toContain("hasSessionHint(document.cookie)");
    const check = readFileSync(join(SITE, "scripts/check-build.mjs"), "utf8");
    expect(check).toContain("only pages that mount Clerk may");
    expect(check).toContain("anonymous HTML names the Clerk host");
    expect(check).toContain("anonymous HTML carries Clerk code");
  });

  it("builds the signed-out link with buildSignInUrl, so the satellite sync parameter is kept", () => {
    const menu = readFileSync(join(SITE, "components/site/account-menu.tsx"), "utf8");
    expect(menu).toContain("clerk.buildSignInUrl(");
    // The cached board and profiles skip the sync for a recently checked signed-out browser, so their Sign in is the
    // header's default link to /account/sign-in, which always runs it first: someone signed in on Matrix OS since is
    // recognised instead of being stranded on the primary's sign-in page.
    for (const path of ["app/leaderboard/board-view.tsx", "app/u/[handle]/page.tsx"]) expect(readFileSync(join(SITE, path), "utf8"), path).toContain("<Header />");
    expect(readFileSync(join(SITE, "components/site/session-account.tsx"), "utf8")).toContain("/account/sign-in?to=");
    for (const label of ["My profile", "Leaderboard", "People I referred", "Open Matrix OS"]) expect(menu).toContain(label);
  });
});

describe("Clerk's round trips on the cached leaderboard and profiles", () => {
  const visit = (pathname: string, extra: Partial<Parameters<typeof clerkRun>[0]> = {}) =>
    clerkRun({ pathname, search: "", userAgent: CHROME, fetchDest: "document", cookies: null, ...extra });

  it("syncs a browser's first visit, so someone signed in on Matrix OS is recognised", () => {
    expect(visit("/leaderboard")).toBe("sync");
    expect(visit("/u/ada")).toBe("sync");
  });

  it("keeps the server check for a browser that has signed in here, so owner panels get a fresh session", () => {
    expect(visit("/u/ada", { cookies: `__client_uat=1763000000; ${AUTH_CHECKED_COOKIE}=1` })).toBe("sync");
    expect(visit("/leaderboard", { cookies: `__client_uat_Xy12=1763000000; ${AUTH_CHECKED_COOKIE}=1` })).toBe("sync");
  });

  it("does not send a recently checked signed-out browser through the four-redirect sync again", () => {
    // Clerk leaves __client_uat=0 after a signed-out sync and would otherwise sync again on every visit.
    expect(visit("/leaderboard", { cookies: `__client_uat=0; ${AUTH_CHECKED_COOKIE}=1` })).toBe("skip");
    expect(visit("/u/ada", { cookies: `${AUTH_CHECKED_COOKIE}=1` })).toBe("skip");
    expect(visit("/u/ada", { cookies: `${AUTH_CHECKED_COOKIE}=0` })).toBe("sync");
  });

  it("lets a sync or handshake in progress finish, whatever the cookie says", () => {
    expect(visit("/leaderboard", { search: "?__clerk_synced=false", cookies: `${AUTH_CHECKED_COOKIE}=1` })).toBe("sync");
    expect(visit("/u/ada", { cookies: `${AUTH_CHECKED_COOKIE}=1; __clerk_handshake=abc` })).toBe("sync");
    expect(visit("/u/ada", { cookies: `${AUTH_CHECKED_COOKIE}=1; __clerk_handshake_nonce=abc` })).toBe("sync");
  });

  it("serves crawlers, client navigations, prefetches and OG images from the cache without Clerk", () => {
    expect(visit("/u/ada", { userAgent: "Twitterbot/1.0" })).toBe("skip");
    expect(visit("/leaderboard", { fetchDest: "empty" })).toBe("skip");
    expect(visit("/u/ada/opengraph-image", { fetchDest: "image" })).toBe("skip");
  });

  it("keeps Clerk on every route handler, /share and /account, and off the landing page and docs", () => {
    expect(visit("/api/leaderboard/me", { fetchDest: "empty", cookies: `${AUTH_CHECKED_COOKIE}=1` })).toBe("sync");
    expect(visit("/share", { cookies: `${AUTH_CHECKED_COOKIE}=1` })).toBe("sync");
    expect(visit("/account/sign-in", { cookies: `${AUTH_CHECKED_COOKIE}=1` })).toBe("sync");
    expect(visit("/__clerk/v1/client")).toBe("no-sync");
    expect(visit("/")).toBe("skip");
    expect(visit("/docs/sharing")).toBe("skip");
  });

  it("only marks a browser as checked once Clerk's middleware actually answered a page for it", () => {
    const proxy = readFileSync(join(SITE, "proxy.ts"), "utf8");
    expect(proxy).toContain('run === "sync" && cachedClerkPage(pathname) && res.status < 300');
  });
});

describe("the signed-in hint on pages that do not mount Clerk", () => {
  it("is set only by a positive Clerk client timestamp, suffixed or not", () => {
    expect(hasSessionHint("__client_uat=1731840000")).toBe(true);
    expect(hasSessionHint("a=1; __client_uat_AbC-12=1731840000; b=2")).toBe(true);
    for (const anonymous of [null, undefined, "", "__client_uat=0", "__client_uat_x=0", "x__client_uat=5", "__client_uat=abc", "__client_uatx=5", "aii_ref=ada"]) expect(hasSessionHint(anonymous), String(anonymous)).toBe(false);
    expect(hasSessionHint(`__client_uat=1; ${"x".repeat(20_000)}`)).toBe(false);
  });

  it("sends the Sign in link back to a same-site path only", () => {
    for (const ok of ["/", "/docs/sharing", "/leaderboard?sort=codex"]) expect(returnPath(ok)).toBe(ok);
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", 42, null, `/${"a".repeat(600)}`, "/a b"]) expect(returnPath(bad), String(bad)).toBe("/");
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
