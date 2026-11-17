import { describe, expect, it } from "vitest";
import { aggregate, deviceLabel, LEGACY_DEVICE, publicDeviceStats, type DeviceRecord } from "../../site/lib/devices.ts";
import { activeDayNumbers, dayNumber, type SharedStats } from "../../site/lib/share.ts";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccc";

/** Bits for active days given as offsets from `from`, as the report encodes them. */
function bits(offsets: number[]): string {
  const b = new Uint8Array(Math.ceil((Math.max(...offsets) + 1) / 8));
  for (const d of offsets) b[d >> 3]! |= 1 << (d & 7);
  return Buffer.from(b).toString("base64url");
}

function v3(id: string, over: Partial<SharedStats> = {}, offsets: number[] | null = [0, 1, 2], from = "2026-03-01"): SharedStats {
  const run = (days: number[]) => { let best = 0, r = 0; for (let i = 0; i < days.length; i += 1) { r = i > 0 && days[i] === days[i - 1]! + 1 ? r + 1 : 1; best = Math.max(best, r); } return best; };
  return {
    // Sessions differ per computer so two default devices never look like one history published twice.
    v: 3, name: "Ada", from, to: "2026-03-31", sessions: 100 + id.charCodeAt(0) - 97, tokens: 1_000_000, usd: 50, activeDays: offsets ? offsets.length : 3, streak: offsets ? run(offsets) : 3,
    agents: [{ k: "claude-code", p: 100 }], fact: `fact ${id.slice(0, 1)}`,
    cards: [{ k: "parallel", b: "3 at once", c: "sessions running side by side" }, { k: "tokens", b: "1.0M", c: "tokens, about $50 at API list prices" }],
    titles: [], ratios: [{ k: "toolErrorRate", v: 0.1, n: 1000 }, { k: "parallelism", v: 2, n: 10 }],
    device: { id, name: "" }, days: offsets ? { from, bits: bits(offsets) } : null,
    ...over,
  };
}

let clock = 0;
const device = (key: string, stats: SharedStats, over: Partial<DeviceRecord> = {}): DeviceRecord => {
  clock += 1;
  const at = new Date(Date.UTC(2026, 3, 1, 0, clock)).toISOString();
  return { key, name: stats.device?.name ?? "", namePublic: false, stats, createdAt: at, updatedAt: at, ...over };
};

describe("one account, several computers", () => {
  it("a single computer's numbers pass through unchanged", () => {
    const one = v3(A);
    const total = aggregate([device(A, one)]);
    expect(total.stats).toMatchObject({ sessions: 100, tokens: 1_000_000, usd: 50, activeDays: 3, streak: 3, from: "2026-03-01", to: "2026-03-31" });
    expect(total.stats.cards).toEqual(one.cards);
    expect(total.counted).toBe(1);
    expect(total.exactDays).toBe(true);
  });

  it("adds sessions, tokens and spend across two computers, and spans the earliest start to the latest end", () => {
    const total = aggregate([device(A, v3(A, { from: "2026-02-10" }, [0, 1], "2026-02-10")), device(B, v3(B, { sessions: 50, tokens: 3_000_000, usd: null, to: "2026-04-02" }, [0], "2026-03-05"))]);
    expect(total.stats).toMatchObject({ sessions: 150, tokens: 4_000_000, usd: 50, from: "2026-02-10", to: "2026-04-02" });
    expect(total.counted).toBe(2);
    expect(total.scores.tokens).toBe(4_000_000);
  });

  it("takes the union of active days and recomputes the streak across computers, so a day on both counts once", () => {
    // A: Mar 1-3. B: Mar 3-6. Together: Mar 1-6, six days in a row, not 3 + 4 = 7 days.
    const withStreak = { cards: [{ k: "streak" as const, b: "3 days", c: "in a row, Mar 1 to Mar 3" }] };
    const total = aggregate([device(A, v3(A, withStreak, [0, 1, 2])), device(B, v3(B, {}, [0, 1, 2, 3], "2026-03-03"))]);
    expect(total.exactDays).toBe(true);
    expect(total.stats.activeDays).toBe(6);
    expect(total.stats.streak).toBe(6);
    expect(total.scores.streak).toBe(6);
    expect(total.streakRange).toEqual({ start: "2026-03-01", end: "2026-03-06" });
    const streakCard = total.highlights.find((h) => h.card.k === "streak")!;
    expect(streakCard.card).toEqual({ k: "streak", b: "6 days", c: "in a row, Mar 1 to Mar 6" });
    expect(streakCard.from).toBeNull();
  });

  it("falls back to an 'at least' figure when a computer did not send its active days", () => {
    const total = aggregate([device(A, v3(A, { activeDays: 9, streak: 4 }, null)), device(B, v3(B, {}, [0, 1, 2, 3, 4], "2026-03-03"))]);
    expect(total.exactDays).toBe(false);
    expect(total.stats.activeDays).toBe(9);
    expect(total.stats.streak).toBe(5);
  });

  it("weighs agent shares by sessions", () => {
    const total = aggregate([
      device(A, v3(A, { sessions: 300, agents: [{ k: "claude-code", p: 100 }] })),
      device(B, v3(B, { sessions: 100, agents: [{ k: "codex", p: 60 }, { k: "claude-code", p: 40 }] })),
    ]);
    expect(total.stats.agents).toEqual([{ k: "claude-code", p: 85 }, { k: "codex", p: 15 }]);
    // Agent arenas add each computer's own estimate: 1M x 100% + 1M x 40%.
    expect(total.scores.claudeTokens).toBe(1_400_000);
    expect(total.scores.codexTokens).toBe(600_000);
  });

  it("recombines ratios from their counts and earns titles from the combined numbers", () => {
    const total = aggregate([
      device(A, v3(A, { ratios: [{ k: "toolErrorRate", v: 0.01, n: 3000 }, { k: "parallelism", v: 3, n: 10 }], titles: [{ k: "smooth_operator", v: 0.01 }, { k: "conductor", v: 3 }] })),
      device(B, v3(B, { ratios: [{ k: "toolErrorRate", v: 0.2, n: 1000 }, { k: "parallelism", v: 1, n: 30 }], titles: [{ k: "stress_tester", v: 0.2 }, { k: "deep_focuser", v: 1 }] })),
    ]);
    // (30 + 200) / 4000 failed calls; (30 + 30) agent hours over 40 clock hours.
    expect(total.stats.ratios).toEqual([{ k: "toolErrorRate", v: 0.0575 }, { k: "parallelism", v: 1.5 }]);
    expect(total.stats.titles).toEqual([]);
    expect(total.perDeviceRatios).toEqual([]);
    const both = aggregate([device(A, v3(A, { ratios: [{ k: "parallelism", v: 2.5, n: 10 }] })), device(B, v3(B, { ratios: [{ k: "parallelism", v: 2.5, n: 10 }] }))]);
    expect(both.stats.titles).toEqual([{ k: "conductor", v: 2.5 }]);
  });

  it("shows a ratio per computer only when one of them did not send the counts behind it", () => {
    const old: SharedStats = { v: 2, name: "Ada", from: "2026-01-01", to: "2026-01-31", sessions: 10, tokens: 10, usd: null, activeDays: 2, streak: 1, agents: [], fact: "", cards: [], titles: [], ratios: [{ k: "toolErrorRate", v: 0.5 }] };
    const total = aggregate([device(LEGACY_DEVICE, old), device(A, v3(A))]);
    expect(total.stats.ratios?.map((r) => r.k)).toEqual(["parallelism"]);
    expect(total.perDeviceRatios).toEqual(["toolErrorRate"]);
    expect(total.exactDays).toBe(false);
  });

  it("does not double a history two computers both published (a synced home folder): counts it once and says so", () => {
    const same = v3(A);
    const total = aggregate([device(A, same), device(B, { ...same, device: { id: B, name: "" } })]);
    expect(total.stats.sessions).toBe(100);
    expect(total.counted).toBe(1);
    expect(total.duplicates).toEqual([{ key: A, of: B }]);
  });

  it("picks each highlight card from one computer and remembers which, rebuilding tokens from the total", () => {
    const total = aggregate([device(A, v3(A, { sessions: 10 })), device(B, v3(B, { sessions: 90, cards: [{ k: "parallel", b: "5 at once", c: "sessions running side by side" }] }))]);
    expect(total.highlights.find((h) => h.card.k === "parallel")).toEqual({ card: { k: "parallel", b: "5 at once", c: "sessions running side by side" }, from: B });
    expect(total.highlights.find((h) => h.card.k === "tokens")).toEqual({ card: { k: "tokens", b: "2.0M", c: "tokens, about $100 at API list prices" }, from: null });
    expect(total.stats.cards!.map((c) => c.k)).toEqual(total.highlights.map((h) => h.card.k));
  });

  it("keeps a legacy (pre-device) entry working as a device on its own", () => {
    const old: SharedStats = { v: 1, name: "Ada", from: "2026-01-01", to: "2026-01-31", sessions: 10, tokens: 500, usd: 1, activeDays: 4, streak: 2, agents: [{ k: "codex", p: 100 }], fact: "x" };
    const total = aggregate([device(LEGACY_DEVICE, old)]);
    expect(total.stats).toEqual(old);
    expect(total.scores).toEqual({ tokens: 500, usd: 1, claudeTokens: 0, codexTokens: 500, streak: 2 });
  });

  it("numbers devices in publish order and shows a name publicly only when its owner chose to", () => {
    const list = [device(A, v3(A), { name: "Work laptop", namePublic: false }), device(B, v3(B), { name: "Home desktop", namePublic: true }), device(C, v3(C), { name: "" })];
    expect(list.map((d, i) => deviceLabel(d, i, "public"))).toEqual(["Device 1", "Home desktop", "Device 3"]);
    expect(list.map((d, i) => deviceLabel(d, i, "owner"))).toEqual(["Work laptop", "Home desktop", "Device 3"]);
  });

  it("never hands a visitor a device's id, private name or day bitmap", () => {
    const out = JSON.stringify(publicDeviceStats(v3(A, { device: { id: A, name: "Home desktop" } })));
    expect(out).not.toContain(A);
    expect(out).not.toContain("Home desktop");
    expect(out).not.toContain("bits");
    expect(JSON.parse(out).sessions).toBe(100);
    const total = JSON.stringify(aggregate([device(A, v3(A, { device: { id: A, name: "Home desktop" } })), device(B, v3(B))]).stats);
    expect(total).not.toContain(A);
    expect(total).not.toContain("Home desktop");
  });

  it("never lets one hostile computer push the total past the schema's limits", () => {
    const big = v3(A, { sessions: 9_000_000, tokens: 9e12, usd: 9e6 });
    const total = aggregate([device(A, big), device(B, { ...big, from: "2026-03-02", device: { id: B, name: "" } })]);
    expect(total.stats.sessions).toBe(10_000_000);
    expect(total.stats.tokens).toBe(1e13);
    expect(total.stats.usd).toBe(1e7);
    expect(activeDayNumbers({ from: "2026-03-01", bits: bits([0]) })).toEqual([dayNumber("2026-03-01")]);
  });
});
