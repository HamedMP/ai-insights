import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_TOOL } from "../../../src/sources/claude-chat/conversation.js";
import { importDir, readManifest, removeImport } from "../../../src/sources/claude-chat/importer.js";
import { chatgptTool, conversationToSession, modelFamily } from "../../../src/sources/chatgpt/conversation.js";
import { chatgptSource } from "../../../src/sources/chatgpt/index.js";
import { CHATGPT_EXPORT, CHATGPT_HARNESS, importChatgptExport } from "../../../src/sources/chatgpt/importer.js";
import { makeZip } from "../claude-chat/fixtures.js";
import { BASE, classicConversation, currentConversation, exportJson, MARKERS, msg, PRIVATE_FILE_PROMPT, PRIVATE_FILES, privateFileBody, PROMPT_ONE, PROMPT_THREE, PROMPT_TWO, text } from "./fixtures.js";

let dir: string;
let home: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-insights-chatgpt-"));
  home = join(dir, "home");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const FILE = { harness: CHATGPT_HARNESS, path: "x", mtimeMs: 0, sizeBytes: 0 };

function everything(root: string): string {
  let out = "";
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out += readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return out;
}

function expectNoMarkers(text: string): void {
  for (const [field, marker] of Object.entries(MARKERS)) expect(text, `${field} leaked`).not.toContain(marker);
  expect(text, "a file next to the conversations was read").not.toContain(PRIVATE_FILE_PROMPT);
}

/** A conversation from nodes listed root first, in the trimmed shape. */
function chain(id: string, messages: Array<Record<string, unknown> | null>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const mapping: Record<string, unknown> = {};
  let parent: string | null = null;
  messages.forEach((message, index) => {
    const nid = `n${index}`;
    mapping[nid] = { id: nid, parent, message };
    parent = nid;
  });
  return { id, conversation_id: id, mapping, current_node: parent, ...extra };
}

describe("a ChatGPT conversation as a session", () => {
  it("follows the branch the person ended on and counts turns, tools by fixed label, thinking, voice, files and branches", () => {
    const session = conversationToSession(classicConversation(), FILE)!;
    expect(session.harness).toBe("chatgpt");
    expect(session.id).toBe("6f1c0a2e-0000-4000-8000-000000000001");
    expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, PROMPT_TWO]);
    // Two prompts with words, one turn that was only a big paste; the hidden custom-instruction message is not a turn.
    expect(session.userMessageCount).toBe(3);
    // The visible replies on the branch; the regenerated first reply sits off it.
    expect(session.assistantMessageCount).toBe(3);
    expect(session.toolCalls.map((call) => [call.name, call.category, call.error ?? null])).toEqual([
      ["python", "other", null],
      ["web_search", "web", null],
      [MCP_TOOL, "mcp", "other"],
    ]);
    expect(session.thinking).toEqual({ blocks: 1, totalMs: null, longestMs: null });
    expect(session.chat).toEqual({ attachments: 1, files: 1, voiceNotes: 1, branches: 1 });
    expect(session.models).toEqual(["gpt-5.6", "gpt-4o"]);
    expect(session.requests).toEqual([]);
    expect(session.features.webSearch).toBe(true);
    expect(session.features.mcpServers).toEqual([]);
    expect(session.startTime).toBe("2026-08-03T21:15:00.123Z");
    expect(session.endTime).toBe(new Date((BASE + 630) * 1000).toISOString());
    expect(session.userResponseTimesSec.length).toBeGreaterThan(0);
    expect(session.issues).toBe(0);
  });

  it("reads the trimmed late-2026 shape: no children, no tool messages, web search on the reply", () => {
    const session = conversationToSession(currentConversation(), FILE)!;
    expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, PROMPT_THREE]);
    expect(session.userMessageCount).toBe(2);
    expect(session.assistantMessageCount).toBe(2);
    expect(session.toolCalls.map((call) => [call.name, call.category])).toEqual([["web_search", "web"]]);
    expect(session.thinking?.blocks).toBe(1);
    expect(session.models).toEqual(["gpt-6.1", "gpt-5.5"]);
    expect(session.chat).toEqual({ attachments: 0, files: 1, voiceNotes: 0, branches: 1 });
    expect(session.issues).toBe(0);
  });

  it("keeps nothing ChatGPT, a tool, a memory, a custom instruction, an attachment or a title held", () => {
    expectNoMarkers(JSON.stringify(conversationToSession(classicConversation(), FILE)));
    expectNoMarkers(JSON.stringify(conversationToSession(currentConversation(), FILE)));
  });

  it("falls back to the newest leaf when current_node is missing or points nowhere", () => {
    for (const current of [undefined, "nowhere"]) {
      const raw = { ...currentConversation(), current_node: current };
      const session = conversationToSession(raw, FILE)!;
      expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, PROMPT_THREE]);
    }
  });

  it("survives a parent cycle, a broken parent link and nodes that are not objects, counting what it skipped", () => {
    const raw = currentConversation();
    const mapping = raw.mapping as Record<string, Record<string, unknown>>;
    mapping["client-created-root"]!.parent = "r2b";
    const cyclic = conversationToSession(raw, FILE);
    expect(cyclic?.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, PROMPT_THREE]);
    const broken = currentConversation();
    (broken.mapping as Record<string, Record<string, unknown>>).rr1!.parent = "gone";
    const session = conversationToSession(broken, FILE)!;
    expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_THREE]);
    expect(session.issues).toBeGreaterThan(0);
    const junk = { ...currentConversation(), mapping: { a: 3, b: "x", c: null, d: [] } };
    expect(conversationToSession(junk, FILE)).toBeNull();
    expect(conversationToSession({ id: "x", mapping: "nope" }, FILE)).toBeNull();
    expect(conversationToSession(null, FILE)).toBeNull();
    expect(conversationToSession({ ...currentConversation(), id: "../../etc", conversation_id: "../x" }, FILE)).toBeNull();
  });

  it("counts a message with no time or an unknown author as an issue, never as a prompt", () => {
    const raw = chain("9c0e0000-0000-4000-8000-000000000003", [
      null,
      msg("a", "user", BASE, text(PROMPT_ONE)),
      msg("b", "user", null, text("no time on this one")),
      msg("c", "critic", BASE + 1, text(MARKERS.assistant)),
      msg("d", "assistant", BASE + 2, text(MARKERS.assistant)),
    ]);
    const session = conversationToSession(raw, FILE)!;
    expect(session.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE]);
    expect(session.issues).toBe(2);
    expectNoMarkers(JSON.stringify(session));
  });

  it("keeps only the model family, never a codename or an unknown slug", () => {
    expect(modelFamily("gpt-5-6-thinking")).toBe("gpt-5.6");
    expect(modelFamily("gpt-5.6-abc-wm")).toBe("gpt-5.6");
    expect(modelFamily("gpt-6")).toBe("gpt-6");
    expect(modelFamily("gpt-4o")).toBe("gpt-4o");
    expect(modelFamily("gpt-4o-mini")).toBe("gpt-4o");
    expect(modelFamily("gpt-4-1106-preview")).toBe("gpt-4");
    expect(modelFamily("gpt-4-1")).toBe("gpt-4.1");
    expect(modelFamily("o3-pro")).toBe("o3");
    expect(modelFamily("o4-mini-high")).toBe("o4");
    expect(modelFamily("text-davinci-002-render-sha")).toBe("gpt-3.5");
    for (const slug of ["auto", "research", "my-private-model", "", "gpt-", "o99x", "gpt-12345"]) expect(modelFamily(slug), slug).toBeNull();
  });

  it("buckets GPT actions, plugins and connectors under one label and knows ChatGPT's own tools", () => {
    expect(chatgptTool("python")).toEqual({ name: "python", category: "other" });
    expect(chatgptTool("web.run")).toEqual({ name: "web_search", category: "web" });
    expect(chatgptTool("browser")).toEqual({ name: "web_search", category: "web" });
    expect(chatgptTool("dalle.text2im")).toEqual({ name: "image_generation", category: "other" });
    expect(chatgptTool("canmore.update_textdoc")).toEqual({ name: "canvas", category: "edit" });
    expect(chatgptTool("file_search.msearch")).toEqual({ name: "file_search", category: "search" });
    expect(chatgptTool("container.exec")).toEqual({ name: "container", category: "shell" });
    for (const name of [MARKERS.gptAction, MARKERS.connector, "api_tool.call_tool", "jit_plugin.x", "toString", "__proto__", ""]) expect(chatgptTool(name), name).toEqual({ name: MCP_TOOL, category: "mcp" });
  });
});

describe("ai-insights import openai", () => {
  it("imports an unzipped split export without opening any other file in the folder", async () => {
    const folder = join(dir, "openai-export");
    mkdirSync(folder);
    writeFileSync(join(folder, "conversations-000.json"), exportJson([classicConversation()]));
    writeFileSync(join(folder, "conversations-001.json"), exportJson([currentConversation()]));
    writeFileSync(join(folder, "export_manifest.json"), JSON.stringify({ version: 1, account: MARKERS.account }));
    for (const name of PRIVATE_FILES) writeFileSync(join(folder, name), privateFileBody());
    mkdirSync(join(folder, "pages"));
    writeFileSync(join(folder, "pages", "conversations.json"), privateFileBody());
    const outcome = await importChatgptExport(folder, home, { now: new Date("2026-11-18T00:00:00Z") });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.manifest).toMatchObject({ source: "openai", conversations: 2, sessions: 2, prompts: 5, replies: 5, toolCalls: 4, issues: 0 });
    expect(outcome.manifest.from).toBe("2026-08-03T21:15:00.123Z");
    expectNoMarkers(everything(importDir(home, CHATGPT_HARNESS)));
    // Pointing at the export's manifest means its folder.
    expect((await importChatgptExport(join(folder, "export_manifest.json"), home)).ok).toBe(true);
  });

  it("imports the zip ChatGPT emails, reading only its conversations file", async () => {
    const zip = join(dir, "0123abcd-2026-11-18-10-00-00.zip");
    writeFileSync(
      zip,
      makeZip([
        { name: "user.json", data: privateFileBody() },
        { name: "conversations.json", data: exportJson([classicConversation(), currentConversation()]) },
        { name: "message_feedback.json", data: privateFileBody() },
        { name: "pages/conversations.json", data: privateFileBody() },
        { name: "spaces/space_1/conversations-000.json", data: privateFileBody() },
        { name: "file-abc.png", data: Buffer.from([0x89, 0x50]) , method: 0 },
      ]),
    );
    const outcome = await importChatgptExport(zip, home);
    expect(outcome.ok && outcome.manifest.sessions).toBe(2);
    expectNoMarkers(everything(importDir(home, CHATGPT_HARNESS)));
    // A folder that holds only the downloaded zip.
    const downloads = join(dir, "downloads");
    mkdirSync(downloads);
    writeFileSync(join(downloads, "export.zip"), readFileSync(zip));
    expect((await importChatgptExport(downloads, home)).ok).toBe(true);
  });

  it("imports an older export's single conversations.json", async () => {
    const file = join(dir, "conversations.json");
    writeFileSync(file, exportJson([classicConversation()]));
    const outcome = await importChatgptExport(file, home);
    expect(outcome.ok && outcome.manifest.sessions).toBe(1);
  });

  it("a re-import of the same export leaves the same sessions, and the source reads them back", async () => {
    const file = join(dir, "conversations.json");
    writeFileSync(file, exportJson([classicConversation(), currentConversation()]));
    await importChatgptExport(file, home, { now: new Date("2026-11-18T00:00:00Z") });
    const sessionsDir = join(importDir(home, CHATGPT_HARNESS), "sessions");
    const first = readdirSync(sessionsDir).sort().map((name) => readFileSync(join(sessionsDir, name), "utf8"));
    await importChatgptExport(file, home, { now: new Date("2026-11-19T00:00:00Z") });
    const second = readdirSync(sessionsDir).sort().map((name) => readFileSync(join(sessionsDir, name), "utf8"));
    expect(second).toEqual(first);
    expect((await readManifest(home, CHATGPT_HARNESS))?.importedAt).toBe("2026-11-19T00:00:00.000Z");
    const files = await chatgptSource.discover({ roots: [importDir(home, CHATGPT_HARNESS)] });
    expect(files).toHaveLength(2);
    const parsed = await chatgptSource.parse(files.find((file) => file.path.includes("6f1c0a2e"))!);
    expect(parsed?.prompts.map((prompt) => prompt.text)).toEqual([PROMPT_ONE, PROMPT_TWO]);
    const turns = await chatgptSource.excerpt(files[0]!);
    expect(turns.every((turn) => turn.role === "user" || turn.role === "tool")).toBe(true);
    expectNoMarkers(JSON.stringify(turns));
  });

  it("keeps the newer copy of a conversation that appears in two shards", async () => {
    const folder = join(dir, "split");
    mkdirSync(folder);
    const older = classicConversation();
    const newer = classicConversation(undefined, BASE + 3_600);
    writeFileSync(join(folder, "conversations-000.json"), exportJson([newer]));
    writeFileSync(join(folder, "conversations-001.json"), exportJson([older]));
    const outcome = await importChatgptExport(folder, home);
    expect(outcome.ok && outcome.manifest).toMatchObject({ sessions: 1, duplicates: 1 });
    const [file] = await chatgptSource.discover({ roots: [importDir(home, CHATGPT_HARNESS)] });
    expect((await chatgptSource.parse(file!))?.startTime).toBe(new Date((BASE + 3_600) * 1000).toISOString());
  });

  it("counts malformed input as issues without throwing, keeping what came before it", async () => {
    const good = exportJson([classicConversation()]);
    const file = join(dir, "conversations.json");
    writeFileSync(file, `${good.slice(0, -1)},{"id":"7a2d1b3f-0000-4000-8000-00000000000f","mapping":{"a":{"parent":nul`);
    const outcome = await importChatgptExport(file, home);
    expect(outcome.ok && outcome.manifest).toMatchObject({ sessions: 1 });
    expect(outcome.ok && outcome.manifest.issues).toBeGreaterThan(0);
    writeFileSync(file, '{"not":"an export"}');
    expect(await importChatgptExport(file, home)).toMatchObject({ ok: false });
    writeFileSync(file, "garbage");
    expect(await importChatgptExport(file, home)).toMatchObject({ ok: false });
    expect(await importChatgptExport(join(dir, "missing"), home)).toMatchObject({ ok: false, reason: "not_found" });
    const empty = join(dir, "empty");
    mkdirSync(empty);
    writeFileSync(join(empty, "user.json"), privateFileBody());
    expect(await importChatgptExport(empty, home)).toMatchObject({ ok: false, reason: "no_conversations" });
  });

  it("caps strings, mapping entries and conversations", async () => {
    const long = `${PROMPT_ONE} ${"x".repeat(50_000)}`;
    const raw = chain("9c0e0000-0000-4000-8000-000000000004", [null, msg("a", "user", BASE, text(long)), msg("b", "assistant", BASE + 1, text("y".repeat(100_000)))]);
    const file = join(dir, "conversations.json");
    writeFileSync(file, exportJson([raw]));
    const outcome = await importChatgptExport(file, home);
    expect(outcome.ok).toBe(true);
    const [stored] = await chatgptSource.discover({ roots: [importDir(home, CHATGPT_HARNESS)] });
    const session = (await chatgptSource.parse(stored!))!;
    expect(session.prompts[0]!.text.length).toBeLessThanOrEqual(2_100);
    // A mapping past the per-array cap: the extra nodes are dropped and counted, never built.
    const nodes = Array.from({ length: 30 }, (_, index) => msg(`m${index}`, index % 2 ? "assistant" : "user", BASE + index, text(index % 2 ? MARKERS.assistant : `prompt ${index}`)));
    writeFileSync(file, exportJson([chain("9c0e0000-0000-4000-8000-000000000005", [null, ...nodes])]));
    const capped = await importChatgptExport(file, home, { limits: { maxArrayItems: 10 } });
    expect(capped.ok && capped.manifest.issues).toBeGreaterThan(0);
    writeFileSync(file, exportJson(Array.from({ length: 5 }, (_, index) => classicConversation(`6f1c0a2e-0000-4000-8000-00000000010${index}`))));
    const few = await importChatgptExport(file, home, { limits: { maxElements: 3 } });
    expect(few.ok && few.manifest.sessions).toBe(3);
    expect(few.ok && few.manifest.issues).toBeGreaterThan(0);
  });

  it("removing the import drops its sessions and leaves a Claude import alone", async () => {
    const file = join(dir, "conversations.json");
    writeFileSync(file, exportJson([classicConversation()]));
    await importChatgptExport(file, home);
    mkdirSync(join(home, "imports", "claude-chat"), { recursive: true });
    mkdirSync(join(home, "sessions", "chatgpt"), { recursive: true });
    writeFileSync(join(home, "sessions", "chatgpt", "old.json"), "{}");
    expect(await removeImport(home, CHATGPT_HARNESS)).toBe(true);
    expect(() => readdirSync(join(home, "sessions", "chatgpt"))).toThrow();
    expect(readdirSync(join(home, "imports"))).toEqual(["claude-chat"]);
    expect(await removeImport(home, CHATGPT_HARNESS)).toBe(false);
    expect(await chatgptSource.discover({ roots: [importDir(home, CHATGPT_HARNESS)] })).toEqual([]);
  });

  it("is described as its own format: shard names, the manifest, and the ChatGPT label", () => {
    expect(CHATGPT_EXPORT.source).toBe("openai");
    expect(CHATGPT_EXPORT.label).toBe("ChatGPT");
    for (const name of ["conversations.json", "conversations-000.json", "conversations-012.json"]) expect(CHATGPT_EXPORT.conversationFile.test(name), name).toBe(true);
    for (const name of [...PRIVATE_FILES, "conversations.json.bak", "my-conversations.json"]) expect(CHATGPT_EXPORT.conversationFile.test(name), name).toBe(false);
    expect(CHATGPT_EXPORT.manifestFile.test("export_manifest.json")).toBe(true);
  });

  it("a tree from the long-standing shape and the same tree without children read the same", () => {
    const classic = classicConversation();
    const mapping = classic.mapping as Record<string, Record<string, unknown>>;
    const trimmed = { ...classic, mapping: Object.fromEntries(Object.entries(mapping).map(([key, node]) => [key, { id: node.id, parent: node.parent, message: node.message }])) };
    const a = conversationToSession(classic, FILE)!;
    const b = conversationToSession(trimmed, FILE)!;
    expect(b).toEqual(a);
  });
});
