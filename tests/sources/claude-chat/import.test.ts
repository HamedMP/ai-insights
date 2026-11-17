import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeChatSource } from "../../../src/sources/claude-chat/index.js";
import { chatTool, conversationToSession, MCP_TOOL } from "../../../src/sources/claude-chat/conversation.js";
import { importClaudeExport, importDir, readManifest, removeClaudeImport } from "../../../src/sources/claude-chat/importer.js";
import { conversation, exportJson, human, makeZip, MARKERS, PROMPT_ONE, PROMPT_TWO } from "./fixtures.js";

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
    // The first answer to the opening prompt was regenerated: only the branch the person ended on counts.
    expect(session.assistantMessageCount).toBe(3);
    expect(session.toolCalls.map((call) => [call.name, call.category, call.error ?? null])).toEqual(
      Array.from({ length: 3 }, () => [
        ["web_search", "web", null],
        [MCP_TOOL, "mcp", "other"],
      ]).flat(),
    );
    expect(session.thinking).toEqual({ blocks: 3, totalMs: 15_000, longestMs: 5_000 });
    expect(session.chat).toEqual({ attachments: 2, files: 1, voiceNotes: 3, branches: 1 });
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

  it("counts only the branch the person ended on when a prompt was edited, and the rest as branches", () => {
    const raw = conversation();
    const messages = raw.chat_messages as Array<Record<string, unknown>>;
    // The person edited their second prompt: a sibling of m3 under m2b, with its own answer, sent later.
    messages.push(human("m3b", "2026-08-03T21:40:00.000Z", "m2b", "Actually make it vegan"), { ...messages[4]!, uuid: "m4b", parent_message_uuid: "m3b", created_at: "2026-08-03T21:41:00.000Z" });
    const session = conversationToSession(raw, FILE)!;
    expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, "Actually make it vegan"]);
    expect(session.userMessageCount).toBe(2);
    expect(session.assistantMessageCount).toBe(2);
    expect(session.chat?.branches).toBe(2);
    expect(session.startTime).toBe("2026-08-03T21:15:00.000Z");
    expect(session.endTime).toBe("2026-08-03T21:41:00.000Z");
  });

  it("buckets MCP and connector tools under one label and knows Claude's own tools by either name", () => {
    const block = (name: string, extra: Record<string, unknown> = {}) => ({ type: "tool_use", name, ...extra });
    expect(chatTool(block("mcp__acme_private__lookup"))).toEqual({ name: MCP_TOOL, category: "mcp" });
    expect(chatTool(block("web_search", { integration_name: "Someone's server" }))).toEqual({ name: MCP_TOOL, category: "mcp" });
    expect(chatTool(block("toString"))).toEqual({ name: MCP_TOOL, category: "mcp" });
    expect(chatTool(block("Bash"))).toEqual({ name: "Bash", category: "shell" });
    expect(chatTool(block("bash_tool"))).toEqual({ name: "bash_tool", category: "shell" });
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
    const messages = raw.chat_messages as Array<Record<string, unknown>>;
    messages[3] = human("m3", String(messages[3]!.created_at), "m2b", "use sk-ant-abcdefghijklmnopqrstuvwx please");
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
      expect(outcome, input).toMatchObject({ ok: true, manifest: { conversations: 1, sessions: 1, prompts: 3, replies: 3, toolCalls: 6 } });
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

  it("never opens the account, memory or project zips, and reads the older single-zip layout and a manifest path", async () => {
    const folder = join(dir, "export");
    mkdirSync(folder);
    // Unreadable on purpose: opening any of them would count an issue.
    for (const name of ["light_metadata-000.zip", "memories-000.zip", "projects-000.zip", "design_chats-000.zip"]) writeFileSync(join(folder, name), "not a zip, and never to be opened by the importer");
    writeFileSync(join(folder, "conversations-000.zip"), makeZip([{ name: "conversations.json", data: exportJson([conversation("c-000")]) }]));
    writeFileSync(join(folder, "manifest-2026-08-30.json"), '{"files":[]}');
    const viaFolder = await importClaudeExport(folder, home);
    expect(viaFolder).toMatchObject({ ok: true, manifest: { sessions: 1, issues: 0 } });
    expect(await importClaudeExport(join(folder, "manifest-2026-08-30.json"), home)).toMatchObject({ ok: true, manifest: { sessions: 1, issues: 0 } });
    const older = join(dir, "older");
    mkdirSync(older);
    writeFileSync(join(older, "data-2026-07-01-12-00-00-batch-0000.zip"), makeZip([{ name: "users.json", data: '{"email_address":"MARK_EMAIL_7f1"}' }, { name: "conversations.json", data: exportJson([conversation("c-old")]) }]));
    expect(await importClaudeExport(older, home)).toMatchObject({ ok: true, manifest: { sessions: 1, issues: 0 } });
    expect(everything(home)).not.toContain("MARK_EMAIL_7f1");
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
