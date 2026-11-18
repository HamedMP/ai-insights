import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_FILE, DEVICE_ID, deviceId } from "../../src/store/device.js";
import { Store } from "../../src/store/store.js";
import { tempHome } from "./fixtures.js";

let home: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
});
afterEach(async () => cleanup());

describe("device id", () => {
  it("is created once and stays the same on every later run, so republishing from one machine replaces its own entry", async () => {
    const first = await deviceId(home);
    expect(first).toMatch(DEVICE_ID);
    expect(await deviceId(home)).toBe(first);
    expect(await new Store(home).deviceId()).toBe(first);
  });

  it("is random, not derived from the machine: two fresh stores on the same machine get different ids", async () => {
    const other = await tempHome();
    try {
      expect(await deviceId(home)).not.toBe(await deviceId(other.home));
    } finally {
      await other.cleanup();
    }
  });

  it("holds nothing but the random id and when it was made: no hostname, username or hardware detail", async () => {
    const id = await deviceId(home);
    const saved = JSON.parse(await readFile(join(home, DEVICE_FILE), "utf8")) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(["createdAt", "id"]);
    expect(saved.id).toBe(id);
    const text = JSON.stringify(saved).toLowerCase();
    for (const leak of [process.env.USER, process.env.HOSTNAME, (await import("node:os")).hostname(), (await import("node:os")).userInfo().username]) {
      if (leak && leak.length > 2) expect(text).not.toContain(leak.toLowerCase());
    }
    expect((await stat(join(home, DEVICE_FILE))).mode & 0o777).toBe(0o600);
  });

  it("replaces a damaged or planted file with a fresh random id instead of passing its content on", async () => {
    await writeFile(join(home, DEVICE_FILE), JSON.stringify({ id: "my-laptop.local", createdAt: "x" }));
    const id = await deviceId(home);
    expect(id).toMatch(DEVICE_ID);
    expect(id).not.toContain("laptop");
    expect(await deviceId(home)).toBe(id);
    await writeFile(join(home, DEVICE_FILE), "not json");
    expect(await deviceId(home)).toMatch(DEVICE_ID);
  });

  it("gives concurrent first runs the same id", async () => {
    const ids = await Promise.all([deviceId(home), deviceId(home), deviceId(home)]);
    expect(new Set(ids).size).toBe(1);
  });

  it("waits for a run that is still writing its new id instead of replacing it with another", async () => {
    // Another run (or an older version, which creates the file empty and then writes it) is mid-write.
    await writeFile(join(home, DEVICE_FILE), "");
    const theirs = "fedcba9876543210fedcba9876543210";
    const writing = new Promise<void>((resolve) => setTimeout(() => void writeFile(join(home, DEVICE_FILE), JSON.stringify({ id: theirs, createdAt: "x" })).then(resolve), 30));
    const [id] = await Promise.all([deviceId(home), writing]);
    expect(id).toBe(theirs);
  });

  it("never leaves its temporary file behind", async () => {
    await Promise.all([deviceId(home), deviceId(home)]);
    expect((await readdir(home)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
