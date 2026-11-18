import { mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_TAIL_ENTRIES, TAIL_TTL_MS, TailCheckpoints } from "../../src/store/tail.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-insights-tailstore-"));
  dirs.push(dir);
  return dir;
}

describe("tail checkpoints on disk", () => {
  it("keep only transcripts that start with the bytes they were made from", async () => {
    const root = temp();
    const path = join(root, "t.jsonl");
    writeFileSync(path, "a\nb\n");
    const store = new TailCheckpoints(join(root, "tail"), { minBytes: 0 });
    await store.save(path, "k", { position: { offset: 4, lines: 2 }, state: "{}" });
    expect(await store.load(path, "k")).toEqual({ position: { offset: 4, lines: 2 }, state: "{}" });
    expect(await store.load(path, "other-key")).toBeNull();
    writeFileSync(path, "a\nb\nc\n");
    expect(await store.load(path, "k")).not.toBeNull();
    writeFileSync(path, "x\nb\nc\n");
    expect(await store.load(path, "k")).toBeNull();
  });

  it("skip transcripts below the size worth a checkpoint and refresh runs that must not read them", async () => {
    const root = temp();
    const path = join(root, "t.jsonl");
    writeFileSync(path, "a\nb\n");
    const small = new TailCheckpoints(join(root, "tail"), { minBytes: 1024 });
    await small.save(path, "k", { position: { offset: 4, lines: 2 }, state: "{}" });
    expect(readdirSync(root)).not.toContain("tail");
    const store = new TailCheckpoints(join(root, "tail"), { minBytes: 0 });
    await store.save(path, "k", { position: { offset: 4, lines: 2 }, state: "{}" });
    expect(await new TailCheckpoints(join(root, "tail"), { minBytes: 0, read: false }).load(path, "k")).toBeNull();
  });

  it("stay bounded: old ones expire, the oldest beyond the cap go, and links are never followed", async () => {
    const root = temp();
    const dir = join(root, "tail");
    const path = join(root, "t.jsonl");
    writeFileSync(path, "a\n");
    const now = Date.now();
    const store = new TailCheckpoints(dir, { minBytes: 0, now: () => now });
    await store.save(path, "k", { position: { offset: 2, lines: 1 }, state: "{}" });
    const outside = join(root, "keep-me.json");
    writeFileSync(outside, "{}");
    symlinkSync(outside, join(dir, "link.json"));
    for (let n = 0; n < MAX_TAIL_ENTRIES + 5; n += 1) {
      const entry = join(dir, `old-${n}.json`);
      writeFileSync(entry, "{}");
      const age = new Date(now - (n < 3 ? TAIL_TTL_MS + 60_000 : 1000 + n));
      utimesSync(entry, age, age);
    }
    await new TailCheckpoints(dir, { minBytes: 0, now: () => now }).prune();
    const left = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "link.json");
    expect(left.length).toBeLessThanOrEqual(MAX_TAIL_ENTRIES);
    expect(left).not.toContain("old-0.json");
    expect(statSync(outside).isFile()).toBe(true);
  });
});
