import { createReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";

/**
 * A minimal, read-only zip reader for data exports: the central directory, stored and deflated entries, and
 * zip64 sizes and offsets. Entries are streamed into memory a chunk at a time and never written to disk, so an
 * entry name (`../../x`) cannot reach the file system; names are still checked and odd ones skipped. Every size
 * it reads is bounded. Never throws: an unreadable archive lists no entries and says why.
 */

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export interface ZipListing {
  entries: ZipEntry[];
  /** Entries skipped (unsafe or unreadable names, encryption, unsupported compression) or a directory that could not be read. */
  issues: number;
  /** Null when the directory was read; else why not. */
  error: "not_a_zip" | "unreadable" | "too_many_entries" | null;
}

export const ZIP_LIMITS = {
  /** Entries listed at most. */
  entries: 10_000,
  /** Central directory bytes read at most. */
  directoryBytes: 32 * 1024 * 1024,
  nameBytes: 1_024,
  /** Uncompressed bytes streamed from one entry at most. */
  entryBytes: 8 * 1024 * 1024 * 1024,
};

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

function u64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

/** A name safe to match on: relative, no `..` segment, no drive letter, no control characters. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > ZIP_LIMITS.nameBytes) return false;
  if (/[\u0000-\u001f]/.test(name)) return false;
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) return false;
  return !name.split(/[\\/]/).some((part) => part === "..");
}

interface Directory {
  offset: number;
  size: number;
  count: number;
}

async function findDirectory(handle: FileHandle, fileSize: number): Promise<Directory | null> {
  const tailLength = Math.min(fileSize, 22 + MAX_COMMENT + 20);
  const tail = await readAt(handle, fileSize - tailLength, tailLength);
  for (let at = tail.length - 22; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) !== EOCD) continue;
    const commentLength = tail.readUInt16LE(at + 20);
    if (at + 22 + commentLength !== tail.length) continue;
    let count = tail.readUInt16LE(at + 10);
    let size = tail.readUInt32LE(at + 12);
    let offset = tail.readUInt32LE(at + 16);
    if ((count === 0xffff || size === 0xffffffff || offset === 0xffffffff) && at >= 20 && tail.readUInt32LE(at - 20) === ZIP64_LOCATOR) {
      const zip64At = u64(tail, at - 20 + 8);
      const record = await readAt(handle, zip64At, 56);
      if (record.length === 56 && record.readUInt32LE(0) === ZIP64_EOCD) {
        count = u64(record, 32);
        size = u64(record, 40);
        offset = u64(record, 48);
      }
    }
    return { offset, size, count };
  }
  return null;
}

/** Sizes and offset from the zip64 extra field, for the fields the header left at their 0xffffffff marker. */
function zip64Extra(extra: Buffer, entry: ZipEntry): void {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    const body = extra.subarray(at + 4, at + 4 + length);
    if (id === 0x0001) {
      let field = 0;
      const next = (): number | null => {
        if (field + 8 > body.length) return null;
        const value = u64(body, field);
        field += 8;
        return value;
      };
      if (entry.size === 0xffffffff) entry.size = next() ?? entry.size;
      if (entry.compressedSize === 0xffffffff) entry.compressedSize = next() ?? entry.compressedSize;
      if (entry.localHeaderOffset === 0xffffffff) entry.localHeaderOffset = next() ?? entry.localHeaderOffset;
      return;
    }
    at += 4 + length;
  }
}

export async function listZip(path: string): Promise<ZipListing> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    const fileSize = (await handle.stat()).size;
    if (fileSize < 22) return { entries: [], issues: 0, error: "not_a_zip" };
    const directory = await findDirectory(handle, fileSize);
    if (!directory) return { entries: [], issues: 0, error: "not_a_zip" };
    if (directory.count > ZIP_LIMITS.entries) return { entries: [], issues: 0, error: "too_many_entries" };
    if (directory.size > ZIP_LIMITS.directoryBytes || directory.offset + directory.size > fileSize) return { entries: [], issues: 0, error: "unreadable" };
    const data = await readAt(handle, directory.offset, directory.size);
    const entries: ZipEntry[] = [];
    let issues = 0;
    let at = 0;
    for (let index = 0; index < directory.count; index += 1) {
      if (at + 46 > data.length || data.readUInt32LE(at) !== CENTRAL) {
        issues += 1;
        break;
      }
      const nameLength = data.readUInt16LE(at + 28);
      const extraLength = data.readUInt16LE(at + 30);
      const commentLength = data.readUInt16LE(at + 32);
      const end = at + 46 + nameLength + extraLength + commentLength;
      if (end > data.length) {
        issues += 1;
        break;
      }
      const flags = data.readUInt16LE(at + 8);
      const entry: ZipEntry = {
        // Bit 11 marks UTF-8 names; older archivers wrote CP437, which only matters for names we never match.
        name: data.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x800 ? "utf8" : "latin1"),
        method: data.readUInt16LE(at + 10),
        flags,
        compressedSize: data.readUInt32LE(at + 20),
        size: data.readUInt32LE(at + 24),
        localHeaderOffset: data.readUInt32LE(at + 42),
      };
      zip64Extra(data.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), entry);
      at = end;
      const directoryEntry = entry.name.endsWith("/");
      if (directoryEntry) continue;
      if (!isSafeEntryName(entry.name) || entry.flags & 0x1 || (entry.method !== 0 && entry.method !== 8) || entry.localHeaderOffset >= fileSize) {
        issues += 1;
        continue;
      }
      entries.push(entry);
    }
    return { entries, issues, error: null };
  } catch {
    return { entries: [], issues: 0, error: "unreadable" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * The entry's uncompressed bytes, a chunk at a time. Stops at `maxBytes` and at the entry's declared size, so a
 * crafted archive cannot inflate past what it claims. A truncated or corrupt entry ends with an error the caller
 * catches.
 */
export async function* readZipEntry(path: string, entry: ZipEntry, maxBytes: number = ZIP_LIMITS.entryBytes): AsyncGenerator<Buffer> {
  const handle = await open(path, "r");
  let dataStart: number;
  try {
    const header = await readAt(handle, entry.localHeaderOffset, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL) throw new Error("bad local header");
    dataStart = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await handle.close().catch(() => undefined);
  }
  const limit = Math.min(maxBytes, entry.size);
  if (entry.compressedSize === 0) return;
  const raw = createReadStream(path, { start: dataStart, end: dataStart + entry.compressedSize - 1, highWaterMark: 256 * 1024 });
  const stream = entry.method === 8 ? raw.pipe(createInflateRaw({ chunkSize: 256 * 1024 })) : raw;
  raw.on("error", (error) => stream.destroy(error));
  let total = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const room = limit - total;
      if (room <= 0) break;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      total += piece.length;
      yield piece;
    }
  } finally {
    raw.destroy();
    stream.destroy();
  }
  if (total < limit && total < entry.size) throw new Error("entry ended early");
}
