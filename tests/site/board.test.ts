import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMetric, metricValue, shortPeriod, standings, type MetricSource } from "../../site/lib/arena-format.ts";
import { pageSql, positionSql, SET_AVATAR_SQL, summarySql } from "../../site/lib/board-sql.ts";
import { handleDeviceList } from "../../site/lib/device-routes.ts";
import { ARENAS, barPercent, boardHref, boardView, boardViewPath, competitionRanks, MAX_PAGE, PAGE_SIZE, pageCount, pageOfPosition, parsePage, parseSort, SORTS } from "../../site/lib/leaderboard.ts";
import { handlePhoto, MAX_PHOTO_BODY_BYTES, PHOTO_ERRORS, type PhotoDeps } from "../../site/lib/photo-route.ts";
import { ERRORS } from "../../site/lib/publish.ts";

const SITE = join(import.meta.dirname, "..", "..", "site");
const ORIGIN = "https://ai-insights.app";
const stream = (text: string) => new Blob([text]).stream();
const CLERK_PHOTO = "https://img.clerk.com/eyJ0eXBlIjoicHJveHkifQ";

describe("sorting the leaderboard table", () => {
  it("sorts by the column in ?sort=, so a sorted view is a shareable server-rendered URL", () => {
    for (const s of SORTS) expect(parseSort({ sort: s.id })).toBe(s.id);
  });

  it("keeps old ?arena= links (profile badges, posts, bookmarks) landing on the same arena", () => {
    for (const a of ARENAS) expect(parseSort({ arena: a.id })).toBe(a.id);
    expect(parseSort({ arena: "codex", page: "2" })).toBe("codex");
    // A new ?sort= wins over a stale ?arena= in the same URL.
    expect(parseSort({ arena: "codex", sort: "sessions" })).toBe("sessions");
  });

  it("falls back to tokens for anything unknown instead of failing the page", () => {
    for (const bad of [{}, { sort: "usd" }, { sort: "tokens DESC; DROP TABLE x" }, { arena: "active" }, { sort: ["", "codex"] }]) expect(parseSort(bad)).toBe("tokens");
    expect(parseSort({ sort: ["codex", "spend"] })).toBe("codex");
  });

  it("builds short canonical links: tokens on page 1 is the bare path, pages are capped", () => {
    expect(boardHref("", "tokens")).toBe("/leaderboard");
    expect(boardHref("", "codex")).toBe("/leaderboard?sort=codex");
    expect(boardHref("", "spend", 3)).toBe("/leaderboard?sort=spend&page=3");
    expect(boardHref("", "tokens", 2, "#u-ada")).toBe("/leaderboard?page=2#u-ada");
    expect(boardHref("", "tokens", 10_000)).toBe(`/leaderboard?page=${MAX_PAGE}`);
    for (const s of SORTS) expect(parseSort(Object.fromEntries(new URL(boardHref("https://x.test", s.id), "https://x.test").searchParams))).toBe(s.id);
  });

  it("only ever puts a fixed column name into the SQL", () => {
    const columns = new Set(SORTS.map((s) => s.column));
    expect(columns.size).toBe(SORTS.length);
    for (const s of SORTS) {
      for (const sql of [pageSql(s.id), summarySql(s.id), positionSql(s.id)]) {
        expect(sql).toContain(s.column);
        expect(sql).not.toMatch(/\$\{|undefined/);
      }
      expect(pageSql(s.id)).toMatch(/LIMIT \$1 OFFSET \$2/);
    }
  });
});

describe("serving each board view from the cache", () => {
  const view = (qs: string) => boardViewPath(new URLSearchParams(qs));

  it("maps every public board URL to one cacheable path per sort and page, ignoring unrelated parameters", () => {
    expect(view("")).toBe("/leaderboard/view/tokens/1");
    expect(view("sort=codex&page=3")).toBe("/leaderboard/view/codex/3");
    expect(view("arena=streak")).toBe("/leaderboard/view/streak/1");
    expect(view("ref=ada&utm_source=x")).toBe("/leaderboard/view/tokens/1");
    expect(view("sort=bogus&page=-2")).toBe("/leaderboard/view/tokens/1");
    expect(view("page=99999")).toBe("/leaderboard/view/tokens/1");
    for (const s of SORTS) expect(view(new URL(boardHref("https://x.test", s.id, 2), "https://x.test").search)).toBe(`/leaderboard/view/${s.id}/2`);
  });

  it("renders only real views: anything else typed into the internal path is not found", () => {
    expect(boardView("spend", "2")).toEqual({ sort: "spend", page: 2 });
    for (const [sort, page] of [["usd", "1"], ["tokens", "0"], ["tokens", "01"], ["tokens", String(MAX_PAGE + 1)], ["tokens", "1e2"], ["tokens", "x"]] as const) expect(boardView(sort, page), `${sort}/${page}`).toBeNull();
  });
});

describe("the cached board and profiles", () => {
  const read = (path: string) => readFileSync(join(SITE, path), "utf8");

  it("are one page for everyone: their server render reads no session, so a cached copy holds no one's own data", () => {
    for (const path of ["app/leaderboard/board-view.tsx", "app/leaderboard/view/[sort]/[page]/page.tsx", "app/u/[handle]/page.tsx", "app/u/[handle]/data.ts", "lib/board-cache.ts"]) {
      const text = read(path);
      expect(text, path).not.toMatch(/currentUserId|from "@clerk\/nextjs\/server"|cookies\(\)|headers\(\)|force-dynamic/);
    }
    for (const path of ["app/leaderboard/view/[sort]/[page]/page.tsx", "app/u/[handle]/page.tsx"]) expect(read(path), path).toMatch(/export const revalidate = \d+[\s\S]*generateStaticParams/);
  });

  it("never store a degraded render: a failed board or ranks read throws, so the last good copy keeps being served", () => {
    expect(read("app/leaderboard/board-view.tsx")).toContain('throw new Error("leaderboard unavailable")');
    expect(read("app/u/[handle]/data.ts")).toContain('return "error"');
    expect(read("app/u/[handle]/data.ts")).not.toContain("return { ranks: {}, referrals: 0 }");
    expect(read("app/u/[handle]/page.tsx")).toContain('if (extras === "error") throw new Error("profile ranks unavailable")');
  });

  it("show a publish, a removal, a device change or the photo switch on the very next load", () => {
    expect(read("lib/board-cache.ts")).toContain("revalidateTag(BOARD_TAG, { expire: 0 })");
    expect(read("app/api/leaderboard/entry/route.ts").match(/boardChanged\(/g)?.length).toBe(2);
    expect(read("app/api/leaderboard/devices/route.ts")).toMatch(/if \(reply\.status === 200\) boardChanged\(\)/);
    expect(read("app/api/leaderboard/photo/route.ts")).toMatch(/if \(reply\.status === 200\) boardChanged\(\)/);
  });

  it("keep the signed-in strip in an owner-only, uncached route about the caller alone", () => {
    const you = read("app/api/leaderboard/you/route.ts");
    expect(you).toContain('"Cache-Control": "private, no-store"');
    expect(you).toContain("const userId = await currentUserId()");
    expect(you).not.toMatch(/searchParams\.get\("(?:user|handle|id)"\)/);
  });
});

describe("rank math", () => {
  it("gives tied values the same rank and skips the places they take (1, 2, 2, 4)", () => {
    expect(competitionRanks([900, 500, 500, 100])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([7, 7, 7])).toEqual([1, 1, 1]);
  });

  it("does not rank a missing or zero value, and does not let it take a place", () => {
    expect(competitionRanks([40, 12, 0, null])).toEqual([1, 2, null, null]);
    expect(competitionRanks([null, null])).toEqual([null, null]);
  });
});

describe("pagination bounds", () => {
  it("spans at least one page and never more than a visitor can open", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(PAGE_SIZE * MAX_PAGE * 3)).toBe(MAX_PAGE);
    expect(pageCount(-5)).toBe(1);
  });

  it("finds the page holding a person for 'jump to me', or none past the last page", () => {
    expect(pageOfPosition(1)).toBe(1);
    expect(pageOfPosition(PAGE_SIZE)).toBe(1);
    expect(pageOfPosition(PAGE_SIZE + 1)).toBe(2);
    expect(pageOfPosition(PAGE_SIZE * MAX_PAGE + 1)).toBeNull();
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(pageOfPosition(bad)).toBeNull();
  });

  it("reads only sane page numbers from the query string", () => {
    for (const [raw, page] of [["2", 2], ["0", 1], ["-3", 1], ["99999", 1], ["1e3", 1], ["9999", MAX_PAGE], [undefined, 1]] as const) expect(parsePage(raw)).toBe(page);
  });
});

describe("table cells and bars", () => {
  const m: MetricSource = { tokens: 1_840_000_000, usd: null, claudeTokens: 1_288_000_000, codexTokens: 0, streak: 20, activeDays: 59, sessions: 412, deviceCount: 2 };
  it("shows a dash, not a zero or a fake number, for a missing spend or an agent never used", () => {
    expect(formatMetric("spend", metricValue("spend", m))).toBe("—");
    expect(formatMetric("codex", metricValue("codex", m))).toBe("—");
    expect(formatMetric("tokens", metricValue("tokens", m))).toBe("1.8B");
    expect(formatMetric("streak", metricValue("streak", m))).toBe("20d");
    expect(formatMetric("sessions", metricValue("sessions", m))).toBe("412");
    expect(formatMetric("spend", metricValue("spend", { ...m, usd: 1290.4 }))).toBe("$1,290");
  });

  it("scales bars to the top value, keeps a small value visible, and draws nothing for nothing", () => {
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(50, 200)).toBe(25);
    expect(barPercent(1, 1_000_000)).toBe(2);
    expect(barPercent(null, 100)).toBe(0);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(10, null)).toBe(0);
    expect(barPercent(500, 100)).toBe(100);
  });

  it("writes a short period for the narrow column", () => {
    expect(shortPeriod("2026-09-01", "2026-11-10")).toBe("Sep 1 – Nov 10");
    expect(shortPeriod("2025-12-03", "2026-01-09")).toBe("Dec 3 ’25 – Jan 9 ’26");
    expect(shortPeriod("nope", "2026-01-09")).toBe("");
  });
});

describe("your standing chips", () => {
  it("leads with your best standing and words small boards and the top ten as ranks, the rest as top %", () => {
    const list = standings({ tokens: { rank: 40, total: 200, topPercent: 20 }, codex: { rank: 2, total: 150, topPercent: 2 }, streak: { rank: 3, total: 12, topPercent: 25 } });
    expect(list.map((s) => s.chip)).toEqual(["#2 Codex", "#3 streaks", "top 20% tokens"]);
    expect(list[0]!.label).toBe("Top 2% in Codex");
    expect(list[1]!.label).toBe("#3 of 12 in streaks");
    expect(standings({})).toEqual([]);
  });
});

function photoDeps(over: Partial<PhotoDeps> = {}): PhotoDeps & { stored: Array<string | null>; asked: string[] } {
  const stored: Array<string | null> = [];
  const asked: string[] = [];
  return {
    stored,
    asked,
    userId: "user_1",
    origin: ORIGIN,
    allowedOrigins: [ORIGIN],
    contentType: "application/json",
    body: stream(JSON.stringify({ show: true })),
    allow: () => true,
    log: () => undefined,
    avatarFor: async (userId) => {
      asked.push(userId);
      return CLERK_PHOTO;
    },
    setAvatar: async (_userId, url) => {
      stored.push(url);
      return true;
    },
    ...over,
  };
}

describe("the 'Show my photo' switch", () => {
  it("turns the photo on from the caller's own Clerk account, read on the server", async () => {
    const deps = photoDeps();
    expect(await handlePhoto(deps)).toEqual({ status: 200, body: { ok: true, shown: true } });
    expect(deps.asked).toEqual(["user_1"]);
    expect(deps.stored).toEqual([CLERK_PHOTO]);
  });

  it("clears the stored photo when switched off, without asking Clerk", async () => {
    const deps = photoDeps({ body: stream(JSON.stringify({ show: false })) });
    expect(await handlePhoto(deps)).toEqual({ status: 200, body: { ok: true, shown: false } });
    expect(deps.stored).toEqual([null]);
    expect(deps.asked).toEqual([]);
  });

  it("never takes a photo URL from the request", async () => {
    const deps = photoDeps({ body: stream(JSON.stringify({ show: true, url: "https://evil.example/x.png" })) });
    expect((await handlePhoto(deps)).status).toBe(400);
    expect(deps.stored).toEqual([]);
  });

  it("refuses a Clerk URL off the image host, and an account with no uploaded photo, storing nothing", async () => {
    for (const photo of ["https://evil.example/x.png", "http://img.clerk.com/x", "https://img.clerk.com.evil.example/x", null]) {
      const deps = photoDeps({ avatarFor: async () => photo });
      expect(await handlePhoto(deps)).toEqual({ status: 409, body: { ok: false, error: PHOTO_ERRORS.noPhoto } });
      expect(deps.stored).toEqual([]);
    }
  });

  it("refuses other sites, signed-out callers and rate-limited callers before reading the body", async () => {
    const cases: Array<[Partial<PhotoDeps>, number, string]> = [
      [{ origin: "https://evil.example" }, 403, ERRORS.origin],
      [{ origin: null }, 403, ERRORS.origin],
      [{ userId: null }, 401, ERRORS.auth],
      [{ allow: () => false }, 429, ERRORS.rate],
    ];
    for (const [over, status, error] of cases) {
      const deps = photoDeps(over);
      expect(await handlePhoto(deps)).toEqual({ status, body: { ok: false, error } });
      expect(deps.stored).toEqual([]);
    }
  });

  it("refuses non-JSON, oversized and malformed bodies with fixed messages", async () => {
    const cases: Array<[Partial<PhotoDeps>, number]> = [
      [{ contentType: "text/plain" }, 415],
      [{ body: stream(JSON.stringify({ show: true, pad: "x".repeat(MAX_PHOTO_BODY_BYTES) })) }, 413],
      [{ body: stream("{") }, 400],
      [{ body: stream("[]") }, 400],
      [{ body: stream(JSON.stringify({ show: "yes" })) }, 400],
      [{ body: stream(JSON.stringify({})) }, 400],
    ];
    for (const [over, status] of cases) {
      const deps = photoDeps(over);
      expect((await handlePhoto(deps)).status).toBe(status);
      expect(deps.stored).toEqual([]);
    }
  });

  it("says so when the caller has not published, and hides server errors", async () => {
    expect(await handlePhoto(photoDeps({ setAvatar: async () => false }))).toEqual({ status: 404, body: { ok: false, error: ERRORS.noEntry } });
    const logged: string[] = [];
    const failed = await handlePhoto(photoDeps({ avatarFor: async () => Promise.reject(new Error("clerk said secret_123")), log: (message) => logged.push(message) }));
    expect(failed).toEqual({ status: 500, body: { ok: false, error: ERRORS.server } });
    expect(JSON.stringify(failed)).not.toContain("secret");
    expect(logged).toEqual(["photo switch failed"]);
  });

  it("changes only the photo column, and leaves updated_at alone so ties and the publish limit do not move", () => {
    expect(SET_AVATAR_SQL).toBe("UPDATE leaderboard_entries SET avatar_url = $2 WHERE user_id = $1");
  });

  it("tells the owner's panels whether the photo is on, so a republish does not silently clear it", async () => {
    const reply = await handleDeviceList({ userId: "user_1", allow: () => true, log: () => undefined, list: async () => ({ handle: "test-person", devices: [], photo: true }) });
    expect(reply.body).toMatchObject({ ok: true, photo: true });
    const off = await handleDeviceList({ userId: "user_1", allow: () => true, log: () => undefined, list: async () => ({ handle: "test-person", devices: [] }) });
    expect(off.body).toMatchObject({ ok: true, photo: false });
  });
});
