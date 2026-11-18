import { lstat, opendir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { normalise, readRecords } from "./read.js";
import { idFromPath, metaFromPayload, type RolloutMeta } from "./parse.js";

export const MAX_SCAN_FILES = 50_000;
const MAX_SCAN_ENTRIES = 200_000;
const MAX_DEPTH = 6;
const MAX_CHILDREN = 5_000;
const INDEX_TTL_MS = 5_000;
/** Rollout heads read at once while indexing. */
const HEAD_READS = 16;
const ROLLOUT_NAME = /^rollout-.+\.(jsonl|jsonl\.zst|json)$/;

export interface RolloutFile {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}

export interface Family {
  file: RolloutFile;
  meta: RolloutMeta;
  /** Guardian reviews and spawned subagents whose parent rollout is present. */
  children: RolloutFile[];
  /** Newest mtime across the rollout and its children, so a new child makes the parent stale. */
  mtimeMs: number;
  sizeBytes: number;
}

export interface RolloutIndex {
  families: Map<string, Family>;
  /** Child rollout path to the parent rollout path it was folded into. */
  foldedInto: Map<string, string>;
  issues: number;
}

/** `sessions` and `archived_sessions` sit side by side; a child may be archived apart from its parent. */
export function expandRoots(roots: string[]): string[] {
  const out = new Set<string>();
  for (const root of roots) {
    const full = resolve(root);
    out.add(full);
    const name = basename(full);
    if (name === "sessions") out.add(join(dirname(full), "archived_sessions"));
    if (name === "archived_sessions") out.add(join(dirname(full), "sessions"));
  }
  return [...out];
}

/** Root a rollout path belongs to: `<root>/YYYY/MM/DD/rollout-….jsonl`, or its own folder. */
export function rootForPath(path: string): string {
  const day = dirname(path);
  const month = dirname(day);
  const year = dirname(month);
  if (/^\d{2}$/.test(basename(day)) && /^\d{2}$/.test(basename(month)) && /^\d{4}$/.test(basename(year))) return dirname(year);
  return day;
}

export async function scanRollouts(roots: string[]): Promise<{ files: RolloutFile[]; issues: number }> {
  const files: RolloutFile[] = [];
  let entries = 0;
  let issues = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_SCAN_FILES) return;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      return;
    }
    try {
      for await (const entry of handle) {
        entries += 1;
        if (entries > MAX_SCAN_ENTRIES || files.length >= MAX_SCAN_FILES) {
          issues += 1;
          return;
        }
        if (entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile() && ROLLOUT_NAME.test(entry.name)) {
          try {
            const info = await lstat(path);
            files.push({ path, mtimeMs: info.mtimeMs, sizeBytes: info.size });
          } catch {
            issues += 1;
          }
        }
      }
    } catch {
      issues += 1;
    }
  }
  for (const root of roots) await walk(root, 0);
  return { files, issues };
}

const heads = new Map<string, { key: string; meta: RolloutMeta }>();

/** The first record of a rollout says which thread it is and who started it. */
async function readHead(file: RolloutFile): Promise<RolloutMeta> {
  const key = `${file.mtimeMs}:${file.sizeBytes}`;
  const cached = heads.get(file.path);
  if (cached?.key === key) return cached.meta;
  let meta: RolloutMeta = { id: idFromPath(file.path), parentId: null, kind: "main" };
  if (!file.path.endsWith(".json")) {
    const result = { issues: 0 };
    for await (const raw of readRecords(file.path, result)) {
      const record = normalise(raw, true);
      if (record?.type === "session_meta" && record.payload && typeof record.payload === "object") {
        const found = metaFromPayload(record.payload as Record<string, unknown>);
        meta = { ...found, id: found.id ?? meta.id };
      }
      break;
    }
  }
  if (heads.size > MAX_SCAN_FILES) heads.clear();
  heads.set(file.path, { key, meta });
  return meta;
}

const indexes = new Map<string, { builtAt: number; index: Promise<RolloutIndex> }>();

/** Group rollouts into families: each main thread with the guardian and subagent threads it started. */
export function rolloutIndex(roots: string[], fresh = false): Promise<RolloutIndex> {
  const key = roots.join("\0");
  const cached = indexes.get(key);
  if (!fresh && cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached.index;
  const index = buildIndex(roots);
  indexes.set(key, { builtAt: Date.now(), index });
  if (indexes.size > 32) indexes.delete(indexes.keys().next().value!);
  return index;
}

async function buildIndex(roots: string[]): Promise<RolloutIndex> {
  const { files, issues } = await scanRollouts(roots);
  const metas = new Map<string, RolloutMeta>();
  const byId = new Map<string, RolloutFile>();
  // Heads are read side by side (each waits mostly on the disk and on zstd), then used in listing order.
  const headOf = new Array<RolloutMeta>(files.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(HEAD_READS, files.length) }, async () => {
      while (next < files.length) {
        const index = next;
        next += 1;
        headOf[index] = await readHead(files[index]!);
      }
    }),
  );
  for (const [index, file] of files.entries()) {
    const meta = headOf[index]!;
    metas.set(file.path, meta);
    if (!meta.id) continue;
    const existing = byId.get(meta.id);
    if (!existing || (metas.get(existing.path)?.kind !== "main" && meta.kind === "main")) byId.set(meta.id, file);
  }
  const parentOf = new Map<string, string>();
  for (const file of files) {
    const meta = metas.get(file.path)!;
    if (meta.kind === "main" || !meta.parentId) continue;
    const parent = byId.get(meta.parentId);
    if (parent && parent.path !== file.path) parentOf.set(file.path, parent.path);
  }
  // Follow chains (a subagent's own guardian reviews) up to the top-level thread, guarding against cycles.
  const topOf = (path: string): string | null => {
    let current = path;
    for (let hop = 0; hop < 8; hop += 1) {
      const next = parentOf.get(current);
      if (!next) return current === path ? null : current;
      current = next;
    }
    return null;
  };
  const families = new Map<string, Family>();
  const foldedInto = new Map<string, string>();
  for (const file of files) {
    if (parentOf.has(file.path) && topOf(file.path)) continue;
    families.set(file.path, { file, meta: metas.get(file.path)!, children: [], mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes });
  }
  for (const file of files) {
    const top = parentOf.has(file.path) ? topOf(file.path) : null;
    if (!top) continue;
    const family = families.get(top);
    if (!family || family.children.length >= MAX_CHILDREN) continue;
    family.children.push(file);
    family.mtimeMs = Math.max(family.mtimeMs, file.mtimeMs);
    family.sizeBytes += file.sizeBytes;
    foldedInto.set(file.path, top);
  }
  return { families, foldedInto, issues };
}
