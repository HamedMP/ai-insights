import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSafeEntryName, listZip, readZipEntry } from "../../../src/sources/claude-chat/zip.js";
import { makeZip } from "./fixtures.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-insights-zip-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, bytes: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

async function text(path: string, name: string, maxBytes?: number): Promise<string> {
  const listing = await listZip(path);
  const entry = listing.entries.find((candidate) => candidate.name === name)!;
  const chunks: Buffer[] = [];
  for await (const chunk of readZipEntry(path, entry, maxBytes)) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

describe("reading an export zip in memory", () => {
  it("lists and streams stored and deflated entries", async () => {
    const big = "x".repeat(300_000);
    const path = write("a.zip", makeZip([{ name: "conversations.json", data: "[1,2]", method: 0 }, { name: "projects/p.json", data: big }]));
    const listing = await listZip(path);
    expect(listing.error).toBeNull();
    expect(listing.entries.map((entry) => entry.name)).toEqual(["conversations.json", "projects/p.json"]);
    expect(await text(path, "conversations.json")).toBe("[1,2]");
    expect(await text(path, "projects/p.json")).toBe(big);
  });

  it("reads zip64 sizes and offsets", async () => {
    const path = write("z64.zip", makeZip([{ name: "first.json", data: "{}" }, { name: "conversations.json", data: '[{"a":1}]' }], { zip64: true }));
    const listing = await listZip(path);
    expect(listing.entries.map((entry) => [entry.name, entry.size])).toEqual([["first.json", 2], ["conversations.json", 9]]);
    expect(await text(path, "conversations.json")).toBe('[{"a":1}]');
  });

  it("skips entries whose names could escape a folder, and never writes anything", async () => {
    const path = write("evil.zip", makeZip([{ name: "../../conversations.json", data: "[]" }, { name: "/etc/conversations.json", data: "[]" }, { name: "C:\\x\\conversations.json", data: "[]" }, { name: "ok/conversations.json", data: "[]" }]));
    const listing = await listZip(path);
    expect(listing.entries.map((entry) => entry.name)).toEqual(["ok/conversations.json"]);
    expect(listing.issues).toBe(3);
    expect(isSafeEntryName("a/../b")).toBe(false);
    expect(isSafeEntryName("a\u0000b")).toBe(false);
    expect(isSafeEntryName("conversations-001.json")).toBe(true);
  });

  it("says a file that is not a zip is not one, without throwing", async () => {
    expect((await listZip(write("no.zip", Buffer.from("not a zip at all, just text that is long enough")))).error).toBe("not_a_zip");
    expect((await listZip(write("tiny.zip", Buffer.from("PK")))).error).toBe("not_a_zip");
    expect((await listZip(join(dir, "missing.zip"))).error).toBe("unreadable");
  });

  it("a truncated zip loses its directory; a truncated entry ends with an error the caller catches", async () => {
    const whole = makeZip([{ name: "conversations.json", data: JSON.stringify(Array.from({ length: 2000 }, (_, n) => ({ n, pad: "p".repeat(40) }))) }]);
    expect((await listZip(write("cut.zip", whole.subarray(0, Math.floor(whole.length / 2))))).error).toBe("not_a_zip");
    // Keep the directory but cut the entry's data short by moving the directory's view of the size past the end.
    const path = write("short.zip", whole);
    const listing = await listZip(path);
    const entry = { ...listing.entries[0]!, compressedSize: listing.entries[0]!.compressedSize - 200 };
    await expect(
      (async () => {
        for await (const _chunk of readZipEntry(path, entry)) void _chunk;
      })(),
    ).rejects.toThrow();
  });

  it("stops inflating at the cap, so a zip bomb cannot fill memory", async () => {
    const path = write("bomb.zip", makeZip([{ name: "conversations.json", data: "0".repeat(2_000_000) }]));
    expect((await text(path, "conversations.json", 1000)).length).toBe(1000);
  });

  it("skips encrypted entries and unknown compression methods", async () => {
    const bytes = makeZip([{ name: "conversations.json", data: "[]", method: 0 }]);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const encrypted = Buffer.from(bytes);
    encrypted.writeUInt16LE(0x801, central + 8);
    expect((await listZip(write("enc.zip", encrypted))).entries).toEqual([]);
    const lzma = Buffer.from(bytes);
    lzma.writeUInt16LE(14, central + 10);
    expect((await listZip(write("lzma.zip", lzma))).issues).toBe(1);
  });
});
