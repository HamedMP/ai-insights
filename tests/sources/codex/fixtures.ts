import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";

/** Small hand-written rollouts. Nothing here comes from a real transcript. */

export type Rec = Record<string, unknown>;

let clock = Date.parse("2026-03-02T09:00:00.000Z");
export function resetClock(start = "2026-03-02T09:00:00.000Z"): void {
  clock = Date.parse(start);
}
/** Advance the fake clock by `seconds` and return its ISO time. */
export function at(seconds = 1): string {
  clock += seconds * 1000;
  return new Date(clock).toISOString();
}

export const rec = (type: string, payload: Rec, extra: Rec = {}): Rec => ({ timestamp: at(), type, payload, ...extra });
export const event = (payload: Rec, extra: Rec = {}): Rec => rec("event_msg", payload, extra);
export const item = (payload: Rec, extra: Rec = {}): Rec => rec("response_item", payload, extra);

export function meta(id: string, extra: Rec = {}): Rec {
  return rec("session_meta", { id, timestamp: new Date(clock).toISOString(), cwd: "/work/demo", originator: "codex_cli_rs", cli_version: "0.50.0", git: { branch: "main" }, ...extra });
}

export function turnContext(model = "gpt-test", extra: Rec = {}): Rec {
  return rec("turn_context", { model, cwd: "/work/demo", approval_policy: "on-request", sandbox_policy: { type: "workspace-write" }, ...extra });
}

export function userMessage(text: string): Rec[] {
  return [
    item({ type: "message", role: "user", content: [{ type: "input_text", text }] }),
    event({ type: "user_message", message: text, images: [] }),
  ];
}

export function assistant(text: string): Rec[] {
  return [
    item({ type: "message", role: "assistant", content: [{ type: "output_text", text }] }),
    event({ type: "agent_message", message: text }),
  ];
}

export function shell(callId: string, command: string, exitCode: number, output = ""): Rec[] {
  return [
    item({ type: "function_call", name: "shell", call_id: callId, arguments: JSON.stringify({ command: ["bash", "-lc", command] }) }),
    event({ type: "exec_command_end", call_id: callId, exit_code: exitCode, stdout: output, stderr: "", aggregated_output: output }),
    item({ type: "function_call_output", call_id: callId, output: JSON.stringify({ output, metadata: { exit_code: exitCode, duration_seconds: 0.1 } }) }),
  ];
}

export function tokenCount(input: number, cached: number, output: number): Rec {
  return event({
    type: "token_count",
    info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output }, last_token_usage: {}, model_context_window: 200000 },
  });
}

export class Tree {
  readonly root: string;
  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "ai-insights-codex-"));
  }

  get sessions(): string {
    return join(this.root, "sessions");
  }

  /** Write a rollout under sessions/YYYY/MM/DD and return its path. */
  write(name: string, records: Rec[], options: { day?: string; zst?: boolean; mtime?: Date; raw?: string; base?: string } = {}): string {
    const [year, month, day] = (options.day ?? "2026-03-02").split("-");
    const dir = join(this.root, options.base ?? "sessions", year!, month!, day!);
    mkdirSync(dir, { recursive: true });
    const body = options.raw ?? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    let path = join(dir, name);
    if (options.zst) {
      path += ".zst";
      writeFileSync(path, compressZstd(Buffer.from(body)));
    } else writeFileSync(path, body);
    if (options.mtime) utimesSync(path, options.mtime, options.mtime);
    return path;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export const canZstd = typeof (zlib as unknown as { zstdCompressSync?: unknown }).zstdCompressSync === "function";

function compressZstd(data: Buffer): Buffer {
  return (zlib as unknown as { zstdCompressSync: (input: Buffer) => Buffer }).zstdCompressSync(data);
}

export const uuid = (n: number): string => `0000000${n}`.slice(-8) + "-1111-4222-8333-444455556666";
export const rolloutName = (n: number): string => `rollout-2026-03-02T09-00-0${n % 10}-${uuid(n)}.jsonl`;
