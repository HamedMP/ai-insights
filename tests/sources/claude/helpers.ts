import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import type { SessionFile } from "../../../src/schema/types.js";

export const SESSION = "11111111-2222-4333-8444-555555555555";
export const CWD = "/work/demo";

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

/** A throwaway `projects` root. */
export function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "hindsight-claude-"));
  made.push(dir);
  const root = join(dir, "projects");
  mkdirSync(root, { recursive: true });
  return root;
}

export function writeLines(path: string, lines: Array<unknown | string>, mtime?: Date): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n");
  if (mtime) utimesSync(path, mtime, mtime);
  return path;
}

export function transcript(lines: Array<unknown | string>, options: { root?: string; session?: string; project?: string } = {}): SessionFile {
  const root = options.root ?? tempRoot();
  const path = join(root, options.project ?? "-work-demo", `${options.session ?? SESSION}.jsonl`);
  writeLines(path, lines);
  return { harness: "claude-code", path, mtimeMs: 1, sizeBytes: 1 };
}

let counter = 0;
const uuid = () => `u-${++counter}`;
const envelope = (timestamp: string) => ({
  uuid: uuid(),
  parentUuid: null,
  sessionId: SESSION,
  cwd: CWD,
  gitBranch: "main",
  isSidechain: false,
  version: "2.0.0",
  timestamp,
});

export function prompt(timestamp: string, content: unknown, extra: Record<string, unknown> = {}) {
  return { ...envelope(timestamp), type: "user", message: { role: "user", content }, ...extra };
}

export interface UsageInput {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cache5m?: number;
  cache1h?: number;
}

export function assistant(
  timestamp: string,
  id: string,
  content: unknown[],
  options: { model?: string; usage?: UsageInput | null; stop?: string | null; extra?: Record<string, unknown> } = {},
) {
  const u = options.usage === undefined ? {} : options.usage;
  const usage =
    u === null
      ? undefined
      : {
          input_tokens: u.input ?? 10,
          output_tokens: u.output ?? 5,
          cache_read_input_tokens: u.cacheRead ?? 0,
          cache_creation_input_tokens: u.cacheWrite ?? 0,
          ...(u.cache5m !== undefined || u.cache1h !== undefined
            ? { cache_creation: { ephemeral_5m_input_tokens: u.cache5m ?? 0, ephemeral_1h_input_tokens: u.cache1h ?? 0 } }
            : {}),
        };
  return {
    ...envelope(timestamp),
    type: "assistant",
    requestId: `req-${id}`,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: options.model ?? "claude-opus-4-5",
      content,
      stop_reason: options.stop === undefined ? "end_turn" : options.stop,
      ...(usage ? { usage } : {}),
    },
    ...options.extra,
  };
}

export const text = (value: string) => ({ type: "text", text: value });
export const thinking = (value: string) => ({ type: "thinking", thinking: value, signature: "sig" });
export const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });

export function toolResult(timestamp: string, toolUseId: string, content: unknown, options: { error?: boolean; result?: unknown } = {}) {
  return {
    ...envelope(timestamp),
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: options.error ?? false }] },
    ...(options.result !== undefined ? { toolUseResult: options.result } : {}),
  };
}

export function system(timestamp: string, subtype: string, extra: Record<string, unknown> = {}) {
  return { ...envelope(timestamp), type: "system", subtype, isMeta: false, ...extra };
}

export function attachment(timestamp: string, value: Record<string, unknown>) {
  return { ...envelope(timestamp), type: "attachment", attachment: value };
}
