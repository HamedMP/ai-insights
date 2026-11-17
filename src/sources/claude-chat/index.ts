import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, TranscriptTurn } from "../../schema/types.js";
import { MAX_STORE_FILE_BYTES } from "../../store/fs.js";
import { isSafeId, SessionSchema } from "../../store/schemas.js";
import { resolveHome } from "../../store/store.js";
import { finishExcerpt } from "../common/excerpt.js";
import { IMPORT_HARNESS, importDir } from "./importer.js";

/**
 * Claude chat history, from a data export the person imported with `ai-insights import claude <path>`. Nothing
 * is discovered on its own: an export sits wherever the person saved it (often a downloads folder, which is not
 * scanned), so until an import exists this source finds nothing. Each imported conversation is one stored
 * `Session` under `imports/claude-chat/sessions/`.
 */

const MAX_SESSIONS = 100_000;

export function claudeChatRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return [importDir(resolveHome(env))];
}

async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  for (const root of options.roots ?? claudeChatRoots()) {
    const dir = join(root, "sessions");
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (files.length >= MAX_SESSIONS) break;
      if (!name.endsWith(".json") || !isSafeId(name.slice(0, -5))) continue;
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) continue;
      files.push({ harness: IMPORT_HARNESS, path, mtimeMs: info.mtimeMs, sizeBytes: info.size });
    }
  }
  const since = options.since?.getTime();
  const kept = since === undefined ? files : files.filter((file) => file.mtimeMs >= since);
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.maxFiles !== undefined ? kept.slice(0, Math.max(0, options.maxFiles)) : kept;
}

async function read(file: SessionFile): Promise<Session | null> {
  try {
    const info = await stat(file.path);
    if (info.size > MAX_STORE_FILE_BYTES) return null;
    const parsed = SessionSchema.safeParse(JSON.parse(await readFile(file.path, "utf8")));
    if (!parsed.success || parsed.data.harness !== IMPORT_HARNESS) return null;
    return { ...(parsed.data as Session), sourcePath: file.path, sourceMtimeMs: file.mtimeMs };
  } catch {
    return null;
  }
}

/** The person's own prompts and the fixed tool labels: the import never kept anything the assistant wrote. */
async function excerpt(file: SessionFile, options: ExcerptOptions = {}): Promise<TranscriptTurn[]> {
  const session = await read(file);
  if (!session) return [];
  const turns: TranscriptTurn[] = [
    ...session.prompts.map((prompt): TranscriptTurn => ({ role: "user", timestamp: prompt.timestamp, text: prompt.text })),
    ...session.toolCalls.map((call): TranscriptTurn => ({ role: "tool", timestamp: call.timestamp, text: call.name, toolName: call.name, ...(call.error ? { isError: true } : {}) })),
  ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return finishExcerpt(turns, options);
}

export const claudeChatSource: Source = {
  parserVersion: "1",
  harness: IMPORT_HARNESS,
  label: "Claude chat",
  defaultRoots: () => claudeChatRoots(),
  discover,
  parse: read,
  excerpt,
};
