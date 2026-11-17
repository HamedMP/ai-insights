import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeChatSource } from "../../../src/sources/claude-chat/index.js";
import { conversationToSession, CONNECTOR_TOOL } from "../../../src/sources/claude-chat/conversation.js";
import { importClaudeExport, importDir, readManifest, removeClaudeImport } from "../../../src/sources/claude-chat/importer.js";
import { conversation, exportJson, makeZip, MARKERS, PROMPT_ONE, PROMPT_TWO } from "./fixtures.js";

let dir: string;
let home: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-insights-claude-chat-"));
  home = join(dir, "home");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const FILE = { harness: "claude-chat" as const, path: "x", mtimeMs: 0, sizeBytes: 0 };

/** Every file under `root`, concatenated: what the import left on disk. */
function everything(root: string): string {
  let out = "";
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out += readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return out;
}

function expectNoMarkers(text: string): void {
  for (const [field, marker] of Object.entries(MARKERS)) expect(text, `${field} leaked`).not.toContain(marker);
}

describe("a Claude chat conversation as a session", () => {
  it("counts turns, tools by fixed label, thinking, voice notes, attachments and branches", () => {
    const session = conversationToSession(conversation(), FILE)!;
    expect(session.harness).toBe("claude-chat");
    expect(session.userMessageCount).toBe(3);
    expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, PROMPT_TWO]);
    expect(session.assistantMessageCount).toBe(4);
    expect(session.toolCalls.map((call) => [call.name, call.category, call.error ?? null])).toEqual(
      Array.from({ length: 4 }, () => [
        ["web_search", "web", null],
        [CONNECTOR_TOOL, "mcp", "other"],
      ]).flat(),
    );
    expect(session.thinking).toEqual({ blocks: 4, totalMs: 20_000, longestMs: 5_000 });
    expect(session.chat).toEqual({ attachments: 2, files: 1, voiceNotes: 4, branches: 1 });
    expect(session.models).toEqual([]);
    expect(session.requests).toEqual([]);
    expect(session.features.mcpServers).toEqual([]);
    expect(session.features.webSearch).toBe(true);
    expect(session.userResponseTimesSec.length).toBeGreaterThan(0);
    expect(session.startTime).toBe("2026-08-03T21:15:00.000Z");
  });

  it("keeps nothing the assistant, a tool or an attachment wrote", () => {
    expectNoMarkers(JSON.stringify(conversationToSession(conversation(), FILE)));
  });

  it("returns null for a conversation without an id or messages, and tolerates missing fields", () => {
    expect(conversationToSession({ ...conversation(), uuid: "../x" }, FILE)).toBeNull();
    expect(conversationToSession({ ...conversation(), chat_messages: [] }, FILE)).toBeNull();
    expect(conversationToSession(null, FILE)).toBeNull();
    const sparse = conversationToSession({ uuid: "c1", chat_messages: [{ sender: "human", created_at: "2026-08-01T10:00:00Z", content: [{ type: "text", text: "hello there" }] }, { sender: "robot" }, { sender: "assistant" }] }, FILE)!;
    expect(sparse.prompts.map((prompt) => prompt.text)).toEqual(["hello there"]);
    expect(sparse.issues).toBe(1);
  });

  it("redacts secrets in prompts", () => {
    const raw = conversation();
    (raw.chat_messages as Array<Record<string, unknown>>)[3]!.text = "use sk-ant-abcdefghijklmnopqrstuvwx please";
    const session = conversationToSession(raw, FILE)!;
    expect(session.prompts[1]!.text).toBe("use [redacted] please");
  });
});

describe("ai-insights import claude", () => {
  const zip = (conversations = [conversation()]) => {
    const path = join(dir, "export.zip");
    writeFileSync(path, makeZip([{ name: "users.json", data: '{"email_address":"a@b.c"}' }, { name: "conversations.json", data: exportJson(conversations) }]));
    return path;
  };

  it("imports a zip, a folder or a bare conversations.json, and the source reads it back", async () => {
    for (const input of ["zip", "folder", "json"] as const) {
      rmSync(home, { recursive: true, force: true });
      let path = zip();
      if (input !== "zip") {
        const folder = join(dir, "unzipped");
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "conversations.json"), exportJson([conversation()]));
        path = input === "folder" ? folder : join(folder, "conversations.json");
      }
      const outcome = await importClaudeExport(path, home);
      expect(outcome, input).toMatchObject({ ok: true, manifest: { conversations: 1, sessions: 1, prompts: 3, replies: 4, toolCalls: 8 } });
      const files = await claudeChatSource.discover({ roots: [importDir(home)] });
      expect(files).toHaveLength(1);
      const session = (await claudeChatSource.parse(files[0]!))!;
      expect(session.sourcePath).toBe(files[0]!.path);
      expect(session.prompts).toHaveLength(2);
    }
  });

  it("reads split exports: every conversations-NNN.zip in a folder", async () => {
    const folder = join(dir, "split");
    mkdirSync(folder);
    writeFileSync(join(folder, "conversations-000.zip"), makeZip([{ name: "conversations.json", data: exportJson([conversation("c-000")]) }]));
    writeFileSync(join(folder, "conversations-001.zip"), makeZip([{ name: "conversations.json", data: exportJson([conversation("c-001")]) }]));
    writeFileSync(join(folder, "memories-000.zip"), makeZip([{ name: "memories/m.json", data: "{}" }]));
    const outcome = await importClaudeExport(folder, home);
    expect(outcome).toMatchObject({ ok: true, manifest: { conversations: 2, sessions: 2 } });
  });

  it("leaves no assistant, thinking, tool, attachment or title text anywhere in the store, nor in excerpts", async () => {
    await importClaudeExport(zip(), home);
    expectNoMarkers(everything(home));
    const [file] = await claudeChatSource.discover({ roots: [importDir(home)] });
    const turns = await claudeChatSource.excerpt(file!);
    expect(turns.filter((turn) => turn.role === "user").map((turn) => turn.text)).toEqual([PROMPT_ONE, PROMPT_TWO]);
    expect(new Set(turns.map((turn) => turn.role))).toEqual(new Set(["user", "tool"]));
    expectNoMarkers(JSON.stringify(turns));
  });

  it("a newer import replaces the earlier one, and remove deletes it with its cache", async () => {
    await importClaudeExport(zip([conversation("old-one"), conversation("kept")]), home);
    mkdirSync(join(home, "sessions", "claude-chat"), { recursive: true });
    writeFileSync(join(home, "sessions", "claude-chat", "old-one.json"), "{}");
    const second = await importClaudeExport(zip([conversation("kept"), conversation("new-one")]), home);
    expect(second.ok).toBe(true);
    expect(readdirSync(join(importDir(home), "sessions")).sort()).toEqual(["kept.json", "new-one.json"]);
    expect(() => readdirSync(join(home, "sessions", "claude-chat"))).toThrow();
    expect((await readManifest(home))?.sessions).toBe(2);
    expect(readdirSync(join(home, "imports")).filter((name) => name !== "claude-chat")).toEqual([]);
    expect(await removeClaudeImport(home)).toBe(true);
    expect(await readManifest(home)).toBeNull();
    expect(await removeClaudeImport(home)).toBe(false);
    expect(await claudeChatSource.discover({ roots: [importDir(home)] })).toEqual([]);
  });

  it("refuses inputs with nothing to import and keeps the earlier import", async () => {
    await importClaudeExport(zip(), home);
    expect(await importClaudeExport(join(dir, "missing.zip"), home)).toMatchObject({ ok: false, reason: "not_found" });
    writeFileSync(join(dir, "bad.zip"), "not a zip, but long enough to look for a directory");
    expect(await importClaudeExport(join(dir, "bad.zip"), home)).toMatchObject({ ok: false, reason: "unreadable_zip" });
    writeFileSync(join(dir, "other.zip"), makeZip([{ name: "projects/p.json", data: "{}" }]));
    expect(await importClaudeExport(join(dir, "other.zip"), home)).toMatchObject({ ok: false, reason: "no_conversations" });
    writeFileSync(join(dir, "conversations.json"), "{ not json");
    expect(await importClaudeExport(join(dir, "conversations.json"), home)).toMatchObject({ ok: false, reason: "nothing_readable" });
    expect((await readManifest(home))?.sessions).toBe(1);
  });

  it("imports what it can from a malformed or truncated export and counts the rest as issues", async () => {
    const text = exportJson([conversation("first"), conversation("second")]);
    writeFileSync(join(dir, "conversations.json"), text.slice(0, text.length - 200));
    const outcome = await importClaudeExport(join(dir, "conversations.json"), home);
    expect(outcome).toMatchObject({ ok: true, manifest: { sessions: 1 } });
    expect(outcome.ok && outcome.manifest.issues).toBeGreaterThan(0);
  });

  it("caps an oversized prompt and skips a conversation nested absurdly deep", async () => {
    const huge = conversation("huge");
    (huge.chat_messages as Array<Record<string, unknown>>)[0]!.text = `${"word ".repeat(200_000)}`;
    let deep: unknown = 1;
    for (let level = 0; level < 500; level += 1) deep = [deep];
    const nested = { ...conversation("deep"), chat_messages: [{ sender: "human", content: deep }] };
    writeFileSync(join(dir, "conversations.json"), exportJson([huge, nested, conversation("fine")]));
    const outcome = await importClaudeExport(join(dir, "conversations.json"), home);
    expect(outcome).toMatchObject({ ok: true, manifest: { sessions: 2, issues: 1 } });
    const stored = JSON.parse(readFileSync(join(importDir(home), "sessions", "huge.json"), "utf8"));
    expect(stored.prompts[0].text.length).toBeLessThanOrEqual(2000);
  });
});
