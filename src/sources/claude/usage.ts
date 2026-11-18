import { basename } from "node:path";
import type { ModelRequest, SessionFile } from "../../schema/types.js";
import { DEFAULT_LIMITS, scanJsonl, type JsonlLimits } from "./jsonl.js";
import { addRequest, isoTime, obj, str, subagentFiles, type RequestLog } from "./parse.js";

/** Only lines with this key can carry a model request; the rest are counted, never decoded. */
const USAGE_MARKER = Buffer.from('"usage"');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A transcript's model requests, read without the rest of the parse. */
export interface UsageOnly {
  id: string;
  requests: ModelRequest[];
}

/**
 * The requests `parseClaudeTranscript` would give for this transcript, from a pass that parses only the lines that
 * mention `"usage"`, through the same `addRequest`. Null whenever this pass cannot be sure of giving the same
 * answer, so the caller parses it fully instead: the file is not named after its session, it hits a read limit, or
 * nothing in it shows the full parse would keep the session at all. Never throws.
 */
export async function readClaudeUsage(file: SessionFile, limits: JsonlLimits = DEFAULT_LIMITS): Promise<UsageOnly | null> {
  try {
    const stem = basename(file.path, ".jsonl");
    // Without the file name, the session id (used for responses without a message id) comes from some earlier line.
    if (!UUID.test(stem)) return null;
    const log: RequestLog = { requests: new Map(), placeholders: new Set(), sessionId: stem };
    let kept = false;
    const read = async (path: string, mainFile: boolean): Promise<boolean> => {
      for await (const row of scanJsonl(path, limits, { marker: USAGE_MARKER })) {
        if (row.kind === "issue") {
          if (row.reason === "too_many_lines" || row.reason === "file_too_large") return false;
          continue;
        }
        if (row.kind !== "record") continue;
        const record = row.value;
        if (mainFile && typeof record.sessionId === "string" && record.sessionId !== stem) continue;
        if (record.type !== "assistant") continue;
        const message = record.message;
        if (!message || typeof message !== "object") continue;
        const m = obj(message);
        if (str(m.model) === "<synthetic>") continue;
        const time = isoTime(record.timestamp);
        if (m.usage) addRequest(log, record, m, time);
        // A timed, real reply on the main thread gives the session a start, an end and an assistant message.
        if (mainFile && record.isSidechain !== true && time && (str(m.id) || str(record.uuid))) kept = true;
      }
      return true;
    };
    if (!(await read(file.path, true))) return null;
    for (const path of await subagentFiles(file.path)) {
      if (!(await read(path, false))) return null;
    }
    if (!kept) return null;
    return { id: stem, requests: [...log.requests.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) };
  } catch {
    return null;
  }
}
