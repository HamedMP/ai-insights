import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cursorSource, parseCursorTimestamp, projectFromSlug, typedText } from "../../../src/sources/cursor/index.js";

type Rec = Record<string, unknown>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hindsight-cursor-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ID = "73ae1b8b-477e-4557-a735-492ac4f35fb1";

function transcript(lines: Rec[], subagent?: Rec[]): string {
  const folder = join(dir, "projects", "work-app", "agent-transcripts", ID);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${ID}.jsonl`);
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  if (subagent) {
    mkdirSync(join(folder, "subagents"), { recursive: true });
    writeFileSync(join(folder, "subagents", "sub-1.jsonl"), subagent.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }
  const end = new Date("2026-05-29T09:00:00.000Z");
  utimesSync(path, end, end);
  return path;
}

const user = (text: string, stamp?: string): Rec => ({
  role: "user",
  message: { content: [{ type: "text", text: `${stamp ? `<timestamp>${stamp}</timestamp>\n` : ""}<user_query>\n${text}\n</user_query>` }] },
});
const assistant = (...content: Rec[]): Rec => ({ role: "assistant", message: { content } });
const tool = (name: string, input: unknown): Rec => ({ type: "tool_use", name, input });

describe("cursor agent transcripts", () => {
  it("reads the person's queries, their times and the agent's tool calls", async () => {
    transcript([
      user("fix the login form, password=hunter2", "Friday, May 29, 2026, 10:30 AM (UTC+2)"),
      assistant({ type: "text", text: "Looking." }, tool("Shell", { command: "git commit -m wip", description: "commit" }), tool("ReadFile", { path: "/work/app/a.tsx" })),
      assistant(tool("StrReplace", { path: "/work/app/a.tsx", old_string: "x", new_string: "y\nz" }), tool("CallMcpTool", { server: "linear", toolName: "get_issue", arguments: {} })),
      user("now the tests", "Friday, May 29, 2026, 10:45 AM (UTC+2)"),
      assistant({ type: "text", text: "Done." }),
    ]);
    const [file] = await cursorSource.discover({ roots: [join(dir, "projects")] });
    expect(file).toMatchObject({ harness: "cursor" });
    const session = (await cursorSource.parse(file!))!;
    expect(session.id).toBe(ID);
    expect(session.prompts.map((prompt) => [prompt.timestamp, prompt.text])).toEqual([
      ["2026-05-29T08:30:00.000Z", "fix the login form, password=[redacted]"],
      ["2026-05-29T08:45:00.000Z", "now the tests"],
    ]);
    expect(session.endTime).toBe("2026-05-29T09:00:00.000Z");
    expect(session.assistantMessageCount).toBe(3);
    expect(session.toolCalls.map((call) => [call.name, call.category])).toEqual([
      ["Shell", "shell"],
      ["ReadFile", "read"],
      ["StrReplace", "edit"],
      ["get_issue", "mcp"],
    ]);
    expect(session.features.mcpServers).toEqual(["linear"]);
    expect(session.gitCommits).toBe(1);
    expect(session.linesAdded).toBe(2);
    expect(session.requests).toEqual([]);
    // No per-message times exist, so no reply time is invented.
    expect(session.userResponseTimesSec).toEqual([]);
  });

  it("folds subagent transcripts in without counting their briefs as the person's prompts", async () => {
    transcript([user("research this", "Friday, May 29, 2026, 10:30 AM (UTC+2)"), assistant(tool("Subagent", { prompt: "go" }))], [
      user("go"),
      assistant(tool("Grep", { pattern: "foo", path: "/work" })),
    ]);
    const [file] = await cursorSource.discover({ roots: [join(dir, "projects")] });
    const session = (await cursorSource.parse(file!))!;
    expect(session.prompts).toHaveLength(1);
    expect(session.toolCalls.map((call) => call.name)).toEqual(["Subagent", "Grep"]);
    expect(session.features.subagents).toBe(1);
  });

  it("gives an excerpt of the conversation", async () => {
    transcript([user("hello", "Friday, May 29, 2026, 10:30 AM (UTC+2)"), assistant({ type: "text", text: "Hi there." })]);
    const [file] = await cursorSource.discover({ roots: [join(dir, "projects")] });
    expect((await cursorSource.excerpt(file!)).map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "hello"],
      ["assistant", "Hi there."],
    ]);
  });

  it("parses Cursor's prompt timestamps across zones and the 12-hour clock", () => {
    expect(parseCursorTimestamp("Tuesday, Jun 2, 2026, 12:05 AM (UTC-7)")).toBe("2026-06-02T07:05:00.000Z");
    expect(parseCursorTimestamp("Thursday, May 28, 2026, 1:15 PM (UTC+5:30)")).toBe("2026-05-28T07:45:00.000Z");
    expect(parseCursorTimestamp("not a time")).toBeNull();
  });

  it("keeps only what the person typed, not the context Cursor attaches", () => {
    expect(typedText("<timestamp>x</timestamp>\n<image_files>\n/tmp/a.png\n</image_files>\n<user_query>\nship it\n</user_query>")).toBe("ship it");
    expect(typedText("<timestamp>x</timestamp>\nplain words")).toBe("plain words");
  });

  it("finds the project folder a slug was made from", async () => {
    mkdirSync(join(dir, "code", "my-app.web", "src"), { recursive: true });
    mkdirSync(join(dir, "code", "my"), { recursive: true });
    expect(await projectFromSlug("code-my-app-web", dir)).toBe(join(dir, "code", "my-app.web"));
    expect(await projectFromSlug("code-gone", dir)).toBeNull();
  });
});
