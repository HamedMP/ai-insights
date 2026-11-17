import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Harness, Session, SessionFile } from "../../schema/types.js";
import { ensureDir, FILE_MODE, readJsonFile, writeFileAtomic } from "../../store/fs.js";
import { conversationToSession, CONVERSATION_SPEC } from "./conversation.js";
import { readArrayElements, type JsonLimits, type Spec } from "./json-stream.js";
import { listZip, readZipEntry, type ZipEntry } from "./zip.js";

/**
 * `ai-insights import claude <path>`: streams a Claude data export (the zip, an unzipped folder, or a bare
 * `conversations.json`), turns each conversation into a `Session`, and keeps those sessions under the AI Insights
 * home in `imports/claude-chat/`. The export itself is never copied: only what a `Session` holds (counts, fixed
 * tool labels and the person's own redacted prompts). A new import replaces the previous one whole.
 */

export const IMPORT_HARNESS = "claude-chat" as const;
/** Bumped when the mapping would turn the same export into different sessions; shown so a re-import can be suggested. */
export const IMPORT_VERSION = 1;

/**
 * What differs between chat products' exports. The zip and JSON readers, the staging, swap and removal are
 * shared, so a ChatGPT importer (its `conversations.json` or `conversations-000.json` shards, a `mapping` tree per
 * conversation) needs only its own format and mapper.
 */
export interface ExportFormat {
  /** The word after `ai-insights import`. */
  source: string;
  harness: Harness;
  label: string;
  /** Files that hold conversations, inside a zip or a folder. */
  conversationFile: RegExp;
  /** Zips in a folder that may hold conversations. Others are not opened. */
  conversationZip: RegExp;
  /** Zips never to open even when nothing else matches: account details, login history, memories, projects. */
  privateZip: RegExp;
  /** An export's manifest; pointing at it means its folder. */
  manifestFile: RegExp;
  /** The keys built from each conversation; everything else is skipped while streaming. */
  spec: Spec;
  /** The key holding the array when the file's root is an object. */
  arrayKey: string;
  toSession(raw: unknown, file: SessionFile, extras: { dropped?: number }): Session | null;
}

/**
 * Claude, checked against an export from August 2026: one zip per category (`conversations-000.zip`,
 * `projects-000.zip`, `memories-000.zip`, `light_metadata-000.zip`, more shards as `-001`), reportedly with a
 * `manifest-*.json` from late August 2026 on, and before that one `data-…-batch-0000.zip`.
 */
export const CLAUDE_EXPORT: ExportFormat = {
  source: "claude",
  harness: IMPORT_HARNESS,
  label: "Claude chat",
  conversationFile: /^conversations(?:[-_]\d{1,4})?\.json$/i,
  conversationZip: /^(?:conversations(?:[-_]\d{1,4})?|data-.*)\.zip$/i,
  privateZip: /^(?:light_metadata|users|login_history|memories|projects|design_chats)\b/i,
  manifestFile: /^manifest.*\.json$/i,
  spec: CONVERSATION_SPEC,
  arrayKey: "conversations",
  toSession: conversationToSession,
};

const MAX_FOLDER_ENTRIES = 2_000;
const MAX_ZIPS = 100;

export function importDir(home: string, harness: Harness = IMPORT_HARNESS): string {
  return join(home, "imports", harness);
}

export function importSessionsDir(home: string, harness: Harness = IMPORT_HARNESS): string {
  return join(importDir(home, harness), "sessions");
}

export interface ImportManifest {
  version: number;
  source: string;
  importedAt: string;
  conversations: number;
  sessions: number;
  /** Conversations with no message: nothing to count. */
  empty: number;
  duplicates: number;
  issues: number;
  prompts: number;
  replies: number;
  toolCalls: number;
  from: string | null;
  to: string | null;
}

type Input = { kind: "zip"; path: string; entry: ZipEntry } | { kind: "file"; path: string };

export type ImportOutcome =
  | { ok: true; manifest: ImportManifest }
  | { ok: false; reason: "not_found" | "no_conversations" | "nothing_readable" | "unreadable_zip"; issues: number };

async function zipInputs(path: string, format: ExportFormat): Promise<{ inputs: Input[]; issues: number; error: boolean }> {
  const listing = await listZip(path);
  if (listing.error) return { inputs: [], issues: listing.issues, error: true };
  // Only entry names are compared; no other entry is ever read.
  const inputs: Input[] = listing.entries
    .filter((entry) => format.conversationFile.test(basename(entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ kind: "zip", path, entry }));
  return { inputs, issues: listing.issues, error: false };
}

/**
 * What to read for `path`: a zip's conversation entries, a folder's conversation files (or its conversation
 * zips), or the file. A manifest stands for its folder. Zips holding account details, login history, memories
 * or projects are never opened.
 */
export async function findInputs(path: string, format: ExportFormat = CLAUDE_EXPORT): Promise<{ inputs: Input[]; issues: number; reason?: "not_found" | "unreadable_zip" }> {
  let full = resolve(path);
  if (format.manifestFile.test(basename(full))) full = dirname(full);
  const info = await stat(full).catch(() => null);
  if (!info) return { inputs: [], issues: 0, reason: "not_found" };
  if (info.isFile()) {
    if (!full.toLowerCase().endsWith(".zip")) return { inputs: [{ kind: "file", path: full }], issues: 0 };
    const zipped = await zipInputs(full, format);
    return zipped.error ? { inputs: [], issues: zipped.issues, reason: "unreadable_zip" } : zipped;
  }
  if (!info.isDirectory()) return { inputs: [], issues: 0, reason: "not_found" };
  let names: string[];
  try {
    names = (await readdir(full)).slice(0, MAX_FOLDER_ENTRIES).sort();
  } catch {
    return { inputs: [], issues: 0, reason: "not_found" };
  }
  // An unzipped export: read its JSON and ignore any zip next to it, so nothing is counted twice.
  const files: Input[] = names.filter((name) => format.conversationFile.test(name)).map((name) => ({ kind: "file", path: join(full, name) }));
  if (files.length > 0) return { inputs: files, issues: 0 };
  const zips = names.filter((name) => name.toLowerCase().endsWith(".zip") && !format.privateZip.test(name));
  // Named parts when there are any; else any other zip, in case the person renamed the download.
  const named = zips.filter((name) => format.conversationZip.test(name));
  const inputs: Input[] = [];
  let issues = 0;
  for (const name of (named.length > 0 ? named : zips).slice(0, MAX_ZIPS)) {
    const zipped = await zipInputs(join(full, name), format);
    inputs.push(...zipped.inputs);
    issues += zipped.issues + (zipped.error ? 1 : 0);
  }
  return { inputs, issues };
}

async function* chunksOf(input: Input): AsyncGenerator<Uint8Array> {
  if (input.kind === "zip") {
    yield* readZipEntry(input.path, input.entry);
    return;
  }
  for await (const chunk of createReadStream(input.path, { highWaterMark: 256 * 1024 })) yield chunk as Buffer;
}

export interface ImportOptions {
  now?: Date;
  limits?: Partial<JsonLimits>;
}

/** Imports a Claude export; see `importExport`. */
export function importClaudeExport(path: string, home: string, options: ImportOptions = {}): Promise<ImportOutcome> {
  return importExport(CLAUDE_EXPORT, path, home, options);
}

/** Imports the export at `path` into `home`, replacing any earlier import of that format. Never throws on bad input. */
export async function importExport(format: ExportFormat, path: string, home: string, options: ImportOptions = {}): Promise<ImportOutcome> {
  const found = await findInputs(path, format);
  if (found.reason) return { ok: false, reason: found.reason, issues: found.issues };
  if (found.inputs.length === 0) return { ok: false, reason: "no_conversations", issues: found.issues };

  const root = join(home, "imports");
  await ensureDir(root);
  const staging = join(root, `.${format.harness}-${process.pid}-${randomBytes(6).toString("hex")}`);
  const stagingSessions = join(staging, "sessions");
  await ensureDir(stagingSessions);
  const manifest: ImportManifest = {
    version: IMPORT_VERSION,
    source: format.source,
    importedAt: (options.now ?? new Date()).toISOString(),
    conversations: 0,
    sessions: 0,
    empty: 0,
    duplicates: 0,
    issues: found.issues,
    prompts: 0,
    replies: 0,
    toolCalls: 0,
    from: null,
    to: null,
  };
  const ends = new Map<string, Session>();
  try {
    for (const input of found.inputs) {
      for await (const result of readArrayElements(chunksOf(input), format.spec, options.limits, format.arrayKey)) {
        if (result.kind === "issue") {
          manifest.issues += 1;
          continue;
        }
        manifest.conversations += 1;
        // The final path is set when the source reads it back; this one only satisfies the type.
        const file: SessionFile = { harness: format.harness, path: "", mtimeMs: 0, sizeBytes: 0 };
        const session = format.toSession(result.value, file, { dropped: result.dropped });
        if (!session) {
          manifest.empty += 1;
          continue;
        }
        const earlier = ends.get(session.id);
        if (earlier) {
          manifest.duplicates += 1;
          if (Date.parse(earlier.endTime) >= Date.parse(session.endTime)) continue;
        }
        ends.set(session.id, { ...session, prompts: [] });
        await writeFile(join(stagingSessions, `${session.id}.json`), JSON.stringify(session), { mode: FILE_MODE });
      }
    }
    for (const session of ends.values()) {
      manifest.sessions += 1;
      manifest.prompts += session.userMessageCount;
      manifest.replies += session.assistantMessageCount;
      manifest.toolCalls += session.toolCalls.length;
      manifest.issues += session.issues;
      if (!manifest.from || session.startTime < manifest.from) manifest.from = session.startTime;
      if (!manifest.to || session.endTime > manifest.to) manifest.to = session.endTime;
    }
    if (manifest.sessions === 0) {
      await rm(staging, { recursive: true, force: true });
      return { ok: false, reason: manifest.conversations === 0 ? "nothing_readable" : "no_conversations", issues: manifest.issues };
    }
    await writeFileAtomic(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await swapIn(home, staging, format.harness);
    return { ok: true, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Puts the staged import in place of the old one, then drops the cached copies of the old sessions. */
async function swapIn(home: string, staging: string, harness: Harness): Promise<void> {
  const final = importDir(home, harness);
  const old = `${final}.old-${randomBytes(6).toString("hex")}`;
  const hadOld = await rename(final, old).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  try {
    await rename(staging, final);
  } catch (error) {
    if (hadOld) await rename(old, final).catch(() => undefined);
    throw error;
  }
  if (hadOld) await rm(old, { recursive: true, force: true });
  // Cached sessions of conversations missing from the new export would otherwise live on as cache-only history.
  await rm(join(home, "sessions", harness), { recursive: true, force: true });
}

/** Removes the import, its cached sessions and the agent review's facets for them. False when there was none. */
export function removeClaudeImport(home: string): Promise<boolean> {
  return removeImport(home, IMPORT_HARNESS);
}

export async function removeImport(home: string, harness: Harness): Promise<boolean> {
  const existed = (await stat(importDir(home, harness)).catch(() => null)) !== null;
  await rm(importDir(home, harness), { recursive: true, force: true });
  await rm(join(home, "sessions", harness), { recursive: true, force: true });
  await rm(join(home, "facets", harness), { recursive: true, force: true });
  return existed;
}

export async function readManifest(home: string, harness: Harness = IMPORT_HARNESS): Promise<ImportManifest | null> {
  const raw = await readJsonFile(join(importDir(home, harness), "manifest.json"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const number = (key: string) => (typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : 0);
  const text = (key: string) => (typeof value[key] === "string" && (value[key] as string).length <= 40 ? (value[key] as string) : null);
  return {
    version: number("version"),
    source: text("source") ?? "claude",
    importedAt: text("importedAt") ?? "",
    conversations: number("conversations"),
    sessions: number("sessions"),
    empty: number("empty"),
    duplicates: number("duplicates"),
    issues: number("issues"),
    prompts: number("prompts"),
    replies: number("replies"),
    toolCalls: number("toolCalls"),
    from: text("from"),
    to: text("to"),
  };
}
