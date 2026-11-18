import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { DIGEST_FILE, type Digest } from "../../src/nudge/digest.js";
import { PRINT_CONFIG, runStatusline, sessionCounts } from "../../src/statusline/statusline.js";
import { tempHome } from "../store/fixtures.js";

// One line for Claude Code's status bar, from what Claude Code sends, the saved digest and the session's own new
// transcript bytes. Synthetic transcripts only.

let home: string;
let cleanup: () => Promise<void>;
let dir: string;
beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  dir = mkdtempSync(join(tmpdir(), "ai-insights-statusline-"));
});
afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const pad = (n: number) => String(n).padStart(2, "0");
function local(date: Date): string {
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
const NOW = new Date(2026, 10, 18, 15, 0);
function digest(written = new Date(2026, 10, 18, 14, 50), tip = "context_resets"): Digest {
  const period = (from: Date) => ({ from: local(from), to: local(written), sessions: 4, activeMinutes: 90, prompts: 30, contextResets: 3, tokens: 1000, costUsd: 8.4, tip: { id: tip } });
  return {
    v: 2,
    writtenAt: written.toISOString(),
    timezone: "Local",
    periods: {
      today: period(new Date(written.getFullYear(), written.getMonth(), written.getDate())),
      week: period(new Date(2026, 10, 16)),
      month: period(new Date(2026, 10, 1)),
      yesterday: period(new Date(2026, 10, 17)),
      lastWeek: period(new Date(2026, 10, 9)),
      lastMonth: period(new Date(2026, 9, 1)),
    },
  };
}

function line(record: unknown): string {
  return `${JSON.stringify(record)}\n`;
}
const compact = { type: "system", subtype: "compact_boundary", timestamp: "2026-11-18T10:00:00.000Z" };
const interrupt = { type: "user", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } };
// The words inside a string never count: their quotes are escaped.
const mention = { type: "user", message: { role: "user", content: 'please explain "subtype":"compact_boundary"' } };

async function status(input: unknown, argv: string[] = [], now = NOW): Promise<string> {
  let out = "";
  const code = await runStatusline(argv, { stdin: Readable.from([typeof input === "string" ? input : JSON.stringify(input)]), stdout: (text) => void (out += text), env: { AI_INSIGHTS_HOME: home }, now: () => now });
  expect(code).toBe(0);
  expect(out.endsWith("\n")).toBe(true);
  expect(out.trim().split("\n")).toHaveLength(1);
  return out.trim();
}

describe("the status line", () => {
  it("shows the model, Claude Code's own session cost, today's cost, context and a hint for this session", async () => {
    writeFileSync(join(home, DIGEST_FILE), JSON.stringify(digest()));
    const transcript = join(dir, "s.jsonl");
    writeFileSync(transcript, [compact, mention, compact, interrupt].map(line).join(""));
    expect(await status({ session_id: "s1", transcript_path: transcript, model: { display_name: "Opus" }, cost: { total_cost_usd: 1.234 }, context_window: { used_percentage: 42.4 } })).toBe(
      "Opus · $1.23 session · $8.40 today · ctx 42% · 2 compactions: /clear between tasks",
    );
  });

  it("leaves cost out with --no-cost, and says how old today's figure is", async () => {
    writeFileSync(join(home, DIGEST_FILE), JSON.stringify(digest(new Date(2026, 10, 18, 9, 30))));
    const input = { model: { display_name: "Opus" }, cost: { total_cost_usd: 3 }, context_window: { used_percentage: 10 } };
    expect(await status(input)).toBe("Opus · $3.00 session · $8.40 today by 09:30 · ctx 10% · this week: /clear between unrelated tasks");
    expect(await status(input, ["--no-cost"])).toBe("Opus · ctx 10% · this week: /clear between unrelated tasks");
  });

  it("never shows another day's figure as today's", async () => {
    writeFileSync(join(home, DIGEST_FILE), JSON.stringify(digest(new Date(2026, 10, 17, 18))));
    expect(await status({ model: { display_name: "Opus" } })).not.toContain("today");
  });

  it("puts the most pressing hint first and rotates when there are several", async () => {
    const transcript = join(dir, "s.jsonl");
    writeFileSync(transcript, [compact, compact, interrupt, interrupt, interrupt].map(line).join(""));
    const input = { session_id: "s2", transcript_path: transcript, context_window: { used_percentage: 91 }, cost: { total_duration_ms: 4 * 3_600_000 } };
    const seen = new Set<string>();
    for (let minute = 0; minute < 4; minute += 1) seen.add((await status(input, [], new Date(NOW.getTime() + minute * 60_000))).split(" · ").at(-1)!);
    expect([...seen].sort()).toEqual(["2 compactions: /clear between tasks", "3 interrupts: front-load the request", "4 h in: split at a checkpoint", "context 91%: /clear or hand off soon"]);
  });

  it("prints a minimal line and exits 0 on anything it cannot read", async () => {
    expect(await status("not json")).toBe("AI Insights");
    expect(await status({ model: { display_name: "Sonnet" }, transcript_path: join(dir, "missing.jsonl"), cost: { total_cost_usd: "x" } })).toBe("Sonnet");
    writeFileSync(join(home, DIGEST_FILE), "{broken");
    expect(await status({ model: { display_name: "Sonnet\u001b[31m" } })).toBe("Sonnet[31m");
  });

  it("prints the settings snippet and the reason for a global install, and edits nothing", async () => {
    let out = "";
    expect(await run(["statusline", "--print-config"], { stdout: (text) => void (out += text), stderr: () => {}, env: { AI_INSIGHTS_HOME: home } })).toBe(0);
    expect(out).toBe(PRINT_CONFIG);
    const snippet = /("statusLine": \{[\s\S]*?\n  \})/.exec(out)![1]!;
    expect(JSON.parse(`{${snippet}}`)).toEqual({ statusLine: { type: "command", command: "ai-insights statusline" } });
    expect(out).toMatch(/npm install -g ai-insights/);
  });
});

describe("the session's own counts", () => {
  it("read only what the transcript gained since the last call, and a line once it is whole", async () => {
    const transcript = join(dir, "s.jsonl");
    writeFileSync(transcript, line(compact));
    expect(await sessionCounts(home, "s", transcript)).toMatchObject({ compactions: 1, interrupts: 0 });
    const next = line(compact);
    appendFileSync(transcript, next.slice(0, 10));
    expect(await sessionCounts(home, "s", transcript)).toMatchObject({ compactions: 1 });
    appendFileSync(transcript, next.slice(10) + line(interrupt));
    const counts = await sessionCounts(home, "s", transcript);
    expect(counts).toMatchObject({ compactions: 2, interrupts: 1 });
    expect(counts!.offset).toBe(Buffer.byteLength(line(compact) + next + line(interrupt)));
  });

  it("count a rewritten, shorter transcript again from the top", async () => {
    const transcript = join(dir, "s.jsonl");
    writeFileSync(transcript, [compact, compact, compact].map(line).join(""));
    await sessionCounts(home, "s", transcript);
    writeFileSync(transcript, line(compact));
    expect(await sessionCounts(home, "s", transcript)).toMatchObject({ compactions: 1 });
  });

  it("never create a store the person has not made", async () => {
    const missing = join(dir, "no-store");
    const transcript = join(dir, "s.jsonl");
    writeFileSync(transcript, line(compact));
    expect(await sessionCounts(missing, "s", transcript)).toMatchObject({ compactions: 1 });
    expect(existsSync(missing)).toBe(false);
  });
});
