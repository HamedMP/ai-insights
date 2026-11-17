import { describe, expect, it } from "vitest";
import { handleDeviceList, handleDeviceRemove, handleDeviceRename, MAX_DEVICE_BODY_BYTES, summarise, type RemoveDeviceDeps, type RenameDeps } from "../../site/lib/device-routes.ts";
import { LEGACY_DEVICE, type DeviceRecord } from "../../site/lib/devices.ts";
import { ERRORS, handlePublish, type EntryRow, type PublishDeps, type SaveChoices } from "../../site/lib/publish.ts";
import type { SharedStats } from "../../site/lib/share.ts";

const ORIGIN = "https://ai-insights.app";
const ID = "0123456789abcdef0123456789abcdef";
const stream = (text: string) => new Blob([text]).stream();
const V1: SharedStats = { v: 1, name: "Test Person", from: "2026-01-01", to: "2026-02-01", sessions: 40, tokens: 1_000_000, usd: 12.5, activeDays: 20, streak: 6, agents: [{ k: "codex", p: 100 }], fact: "" };
const V2: SharedStats = { ...V1, v: 2, cards: [{ k: "streak", b: "6 days", c: "in a row, Jan 2 to Jan 7" }], titles: [], ratios: [{ k: "toolErrorRate", v: 0.1 }] };
const V3: SharedStats = { ...V2, v: 3, ratios: [{ k: "toolErrorRate", v: 0.1, n: 100 }], device: { id: ID, name: "Work laptop" }, days: null };

function publishDeps(body: unknown, over: Partial<PublishDeps> = {}) {
  const saved: Array<{ row: EntryRow; choices: SaveChoices }> = [];
  const deps: PublishDeps = {
    userId: "user_1", origin: ORIGIN, allowedOrigins: [ORIGIN], contentType: "application/json", body: stream(JSON.stringify(body)),
    allow: () => true, log: () => undefined, referrer: null,
    save: async (row, choices) => {
      saved.push({ row, choices });
      return { result: "saved", credited: null, devices: 2 };
    },
    ...over,
  };
  return { deps, saved };
}

describe("publishing from a computer", () => {
  it("old v1 and v2 links still publish, as the account's one pre-device entry", async () => {
    for (const stats of [V1, V2]) {
      const { deps, saved } = publishDeps({ handle: "test-person", stats });
      expect((await handlePublish(deps)).status).toBe(200);
      expect(saved[0]!.row.stats.device).toBeUndefined();
      expect(saved[0]!.choices).toEqual({ showDeviceName: false, replaceLegacy: false });
    }
  });

  it("a v3 link publishes with its device and the person's choices", async () => {
    const { deps, saved } = publishDeps({ handle: "test-person", stats: V3, showAvatar: false, showDeviceName: true, replaceLegacy: true });
    expect(await handlePublish(deps)).toEqual({ status: 200, body: { ok: true, handle: "test-person", devices: 2 } });
    expect(saved[0]!.row.stats.device).toEqual({ id: ID, name: "Work laptop" });
    expect(saved[0]!.choices).toEqual({ showDeviceName: true, replaceLegacy: true });
  });

  it("refuses an eleventh computer with a clear message", async () => {
    const { deps } = publishDeps({ handle: "test-person", stats: V3 }, { save: async () => "device_cap" });
    expect(await handlePublish(deps)).toEqual({ status: 409, body: { ok: false, error: ERRORS.devices } });
    expect(ERRORS.devices).toContain("10 computers");
  });

  it("tells the publisher when this computer's numbers exactly match another's", async () => {
    const { deps } = publishDeps({ handle: "test-person", stats: V3 }, { save: async () => ({ result: "saved", credited: null, duplicate: true, devices: 1 }) });
    expect(await handlePublish(deps)).toEqual({ status: 200, body: { ok: true, handle: "test-person", duplicate: true, devices: 1 } });
  });

  it("refuses choices that are not booleans and keys it does not know", async () => {
    for (const body of [
      { handle: "test-person", stats: V3, showDeviceName: "yes" },
      { handle: "test-person", stats: V3, replaceLegacy: 1 },
      { handle: "test-person", stats: V3, deviceId: ID },
      { handle: "test-person", stats: { ...V3, device: { id: "my-host.local", name: "" } } },
    ]) {
      const { deps, saved } = publishDeps(body);
      expect(await handlePublish(deps), JSON.stringify(body).slice(0, 90)).toEqual({ status: 400, body: { ok: false, error: ERRORS.body } });
      expect(saved).toHaveLength(0);
    }
  });
});

const device = (key: string, stats: SharedStats, over: Partial<DeviceRecord> = {}): DeviceRecord => ({ key, name: "", namePublic: false, stats, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", ...over });

describe("the owner's devices panel", () => {
  it("lists only the caller's own devices, with owner labels and duplicates marked", async () => {
    const asked: string[] = [];
    const devices = [device(LEGACY_DEVICE, V2), device(ID, { ...V3, device: { id: ID, name: "" } }, { name: "Work laptop", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z" })];
    const reply = await handleDeviceList({ userId: "user_1", allow: () => true, log: () => undefined, list: async (userId) => { asked.push(userId); return { handle: "test-person", devices }; } });
    expect(asked).toEqual(["user_1"]);
    expect(reply.status).toBe(200);
    const body = reply.body as Extract<typeof reply.body, { ok: true }>;
    expect(body.devices.map((d) => [d.label, d.legacy, d.duplicateOf])).toEqual([["Device 1", true, "Work laptop"], ["Work laptop", false, null]]);
  });

  it("needs a session, is rate limited, and says nothing about other people", async () => {
    expect((await handleDeviceList({ userId: null, allow: () => true, log: () => undefined, list: async () => null })).status).toBe(401);
    expect((await handleDeviceList({ userId: "u", allow: () => false, log: () => undefined, list: async () => null })).status).toBe(429);
    expect((await handleDeviceList({ userId: "u", allow: () => true, log: () => undefined, list: async () => null })).status).toBe(404);
    const logged: string[] = [];
    const failed = await handleDeviceList({ userId: "u", allow: () => true, log: (m) => logged.push(m), list: async () => Promise.reject(new Error("password=hunter2")) });
    expect(failed).toEqual({ status: 500, body: { ok: false } });
    expect(logged).toEqual(["device list failed"]);
  });

  it("summarises each device's own numbers", () => {
    const { devices } = summarise([device(ID, V3)]);
    expect(devices[0]!.stats).toEqual({ from: "2026-01-01", to: "2026-02-01", sessions: 40, tokens: 1_000_000, usd: 12.5, activeDays: 20, streak: 6, cards: 1, days: false });
  });
});

function renameDeps(body: unknown, over: Partial<RenameDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: RenameDeps = {
    userId: "user_1", origin: ORIGIN, allowedOrigins: [ORIGIN], contentType: "application/json", body: stream(typeof body === "string" ? body : JSON.stringify(body)), allow: () => true, log: () => undefined,
    rename: async (...args) => { calls.push(args); return "ok"; },
    ...over,
  };
  return { deps, calls };
}

describe("renaming and removing a device", () => {
  it("renames one of the caller's devices, cleaning the name, and records the public choice", async () => {
    const { deps, calls } = renameDeps({ device: ID, name: "  Home‮ desktop\u0007 ", public: true });
    expect(await handleDeviceRename(deps)).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual([["user_1", ID, "Home desktop", true]]);
  });

  it("passes the same gate as publishing: origin, session, rate limit, JSON, size", async () => {
    for (const [over, status] of [[{ origin: "https://evil.example" }, 403], [{ userId: null }, 401], [{ allow: () => false }, 429], [{ contentType: "text/plain" }, 415]] as const) {
      const { deps, calls } = renameDeps({ device: ID, name: "x", public: false }, over);
      expect((await handleDeviceRename(deps)).status, JSON.stringify(over)).toBe(status);
      expect(calls).toHaveLength(0);
    }
    const { deps } = renameDeps("x".repeat(MAX_DEVICE_BODY_BYTES + 1));
    expect((await handleDeviceRename(deps)).status).toBe(413);
  });

  it("rejects hostile device ids and malformed bodies", async () => {
    for (const body of [
      { device: "../../etc", name: "x", public: false },
      { device: ID.toUpperCase(), name: "x", public: false },
      { device: `${ID}' OR 1=1 --`, name: "x", public: false },
      { device: ID, name: 7, public: false },
      { device: ID, name: "x", public: "yes" },
      { device: ID, name: "x" },
      { device: ID, name: "x", public: false, user: "user_2" },
    ]) {
      const { deps, calls } = renameDeps(body);
      expect(await handleDeviceRename(deps), JSON.stringify(body)).toEqual({ status: 400, body: { ok: false, error: ERRORS.body } });
      expect(calls).toHaveLength(0);
    }
  });

  it("an id from another account is just 'not on your profile'", async () => {
    const { deps } = renameDeps({ device: ID, name: "x", public: false }, { rename: async () => "not_found" });
    expect(await handleDeviceRename(deps)).toEqual({ status: 404, body: { ok: false, error: ERRORS.device } });
  });

  it("removes a device, refuses the last one, and never reads a body", async () => {
    const base = (over: Partial<RemoveDeviceDeps>): RemoveDeviceDeps => ({ userId: "user_1", origin: ORIGIN, allowedOrigins: [ORIGIN], contentType: null, body: null, allow: () => true, log: () => undefined, device: ID, remove: async () => "ok", ...over });
    const removed: string[] = [];
    expect(await handleDeviceRemove(base({ remove: async (_u, key) => { removed.push(key); return "ok"; } }))).toEqual({ status: 200, body: { ok: true } });
    expect(removed).toEqual([ID]);
    expect(await handleDeviceRemove(base({ device: LEGACY_DEVICE, remove: async () => "last_device" }))).toEqual({ status: 409, body: { ok: false, error: ERRORS.lastDevice } });
    expect(await handleDeviceRemove(base({ device: "nope" }))).toEqual({ status: 400, body: { ok: false, error: ERRORS.body } });
    expect(await handleDeviceRemove(base({ device: null }))).toEqual({ status: 400, body: { ok: false, error: ERRORS.body } });
    expect((await handleDeviceRemove(base({ body: stream("x") }))).status).toBe(413);
    expect((await handleDeviceRemove(base({ origin: "https://evil.example" }))).status).toBe(403);
    const logged: string[] = [];
    expect(await handleDeviceRemove(base({ remove: async () => Promise.reject(new Error("relation leaderboard_devices")), log: (m) => logged.push(m) }))).toEqual({ status: 500, body: { ok: false, error: ERRORS.server } });
    expect(logged).toEqual(["device remove failed"]);
  });
});
