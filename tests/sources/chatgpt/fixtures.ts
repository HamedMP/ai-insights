/**
 * Small, hand-written ChatGPT data export fixtures in the two shapes the importer reads: the long-standing
 * one (a `mapping` tree whose nodes list `children`, messages with `recipient`, `status` and `end_turn`, tool
 * messages, hidden system and custom-instruction messages) and the trimmed one seen in exports from late 2026
 * (nodes with only `id`, `parent` and `message`; `thoughts` and `reasoning_recap` messages; web search recorded
 * as `search_result_groups` on the reply). Every field the import must never keep holds a marker string, so a
 * test can search everything downstream for them.
 */

export const MARKERS = {
  title: "MARK_GPT_TITLE_3c9",
  assistant: "MARK_GPT_ASSISTANT_TEXT_3c9",
  regenerated: "MARK_GPT_REGENERATED_TEXT_3c9",
  assistantVoice: "MARK_GPT_ASSISTANT_VOICE_3c9",
  thoughts: "MARK_GPT_THOUGHTS_3c9",
  thoughtSummary: "MARK_GPT_THOUGHT_SUMMARY_3c9",
  recap: "MARK_GPT_REASONING_RECAP_3c9",
  system: "MARK_GPT_SYSTEM_PROMPT_3c9",
  profile: "MARK_GPT_ABOUT_ME_3c9",
  instructions: "MARK_GPT_CUSTOM_INSTRUCTIONS_3c9",
  memory: "MARK_GPT_MEMORY_3c9",
  hiddenUser: "MARK_GPT_HIDDEN_USER_CONTEXT_3c9",
  toolInput: "MARK_GPT_TOOL_INPUT_3c9",
  toolOutput: "MARK_GPT_TOOL_OUTPUT_3c9",
  toolError: "MARK_GPT_TOOL_ERROR_3c9",
  browsing: "MARK_GPT_BROWSING_RESULT_3c9",
  connector: "mark_gpt_connector_3c9",
  gptAction: "g-markgptaction3c9.lookup",
  gizmo: "g-markgizmo3c9",
  project: "g-p-markproject3c9",
  citation: "https://mark-gpt-citation-3c9.example/page",
  searchDomain: "mark-gpt-search-3c9.example",
  attachmentName: "MARK_GPT_ATTACHMENT_3c9.png",
  pasteName: "MARK_GPT_PASTE_3c9.txt",
  assetPointer: "file-service://MARK_GPT_ASSET_3c9",
  audioPointer: "sediment://MARK_GPT_AUDIO_3c9",
  account: "MARK_GPT_ACCOUNT_3c9",
  memoryCitation: "MARK_GPT_MEMORY_CITATION_3c9",
} as const;

export const PROMPT_ONE = "Can you help me plan a week of dinners for two people please";
export const PROMPT_TWO = "Thanks, now make it vegetarian";
export const PROMPT_THREE = "What is in season in November";

type Rec = Record<string, unknown>;

/** Epoch seconds with a fraction, as the export writes them. */
export const BASE = Date.parse("2026-08-03T21:15:00.000Z") / 1000 + 0.123;

export interface Node {
  id: string;
  parent: string | null;
  message: Rec | null;
}

export function msg(id: string, role: string, at: number | null, content: Rec, extra: Rec = {}): Rec {
  return {
    id,
    author: { role, name: null, metadata: {} },
    create_time: at,
    update_time: null,
    content,
    status: "finished_successfully",
    end_turn: null,
    weight: 1,
    metadata: {},
    recipient: "all",
    channel: null,
    ...extra,
  };
}

export const text = (...parts: unknown[]): Rec => ({ content_type: "text", parts });
export const multimodal = (...parts: unknown[]): Rec => ({ content_type: "multimodal_text", parts });

/** A tree in the long-standing shape: every node lists its children. */
export function tree(nodes: Node[]): Record<string, Rec> {
  const mapping: Record<string, Rec> = {};
  for (const node of nodes) mapping[node.id] = { id: node.id, message: node.message, parent: node.parent, children: [] };
  for (const node of nodes) if (node.parent && mapping[node.parent]) (mapping[node.parent]!.children as string[]).push(node.id);
  return mapping;
}

/**
 * The long-standing shape. The active branch: hidden system, custom-instruction and memory messages, an image
 * prompt, thinking, a code run, a web search, a GPT action that failed, a regenerated reply (the first one sits
 * off the branch), a voice prompt with a spoken reply, and a turn that is only a big paste.
 */
export function classicConversation(id = "6f1c0a2e-0000-4000-8000-000000000001", base = BASE): Rec {
  const t = (seconds: number) => base + seconds;
  const nodes: Node[] = [
    { id: "root", parent: null, message: null },
    { id: "sys", parent: "root", message: msg("sys", "system", null, text(MARKERS.system), { weight: 0, metadata: { is_visually_hidden_from_conversation: true } }) },
    {
      id: "ctx",
      parent: "sys",
      message: msg(
        "ctx",
        "user",
        null,
        { content_type: "user_editable_context", user_profile: MARKERS.profile, user_instructions: MARKERS.instructions },
        { metadata: { is_visually_hidden_from_conversation: true, is_user_system_message: true, user_context_message_data: { about_user_message: MARKERS.profile, about_model_message: MARKERS.instructions } } },
      ),
    },
    { id: "mem", parent: "ctx", message: msg("mem", "assistant", null, { content_type: "model_editable_context", model_set_context: MARKERS.memory, repository: null }, { metadata: { is_visually_hidden_from_conversation: true } }) },
    {
      id: "u1",
      parent: "mem",
      message: msg(
        "u1",
        "user",
        t(0),
        multimodal({ content_type: "image_asset_pointer", asset_pointer: MARKERS.assetPointer, size_bytes: 1234, width: 10, height: 10, fovea: null, metadata: { dalle: null } }, PROMPT_ONE),
        { metadata: { attachments: [{ id: "file-1", name: MARKERS.attachmentName, size: 1234, mime_type: "image/png", width: 10, height: 10 }], request_id: "r1" } },
      ),
    },
    { id: "a1", parent: "u1", message: msg("a1", "assistant", t(5), { content_type: "thoughts", thoughts: [{ summary: MARKERS.thoughtSummary, content: MARKERS.thoughts, chunks: [MARKERS.thoughts], finished: true }], source_analysis_msg_id: "x" }, { metadata: { model_slug: "gpt-5-6-thinking" } }) },
    { id: "a1r", parent: "a1", message: msg("a1r", "assistant", t(9), { content_type: "reasoning_recap", content: MARKERS.recap }, { metadata: { model_slug: "gpt-5-6-thinking" } }) },
    { id: "a2", parent: "a1r", message: msg("a2", "assistant", t(10), { content_type: "code", language: "unknown", text: MARKERS.toolInput }, { recipient: "python", end_turn: false, metadata: { model_slug: "gpt-5-6-thinking" } }) },
    { id: "t1", parent: "a2", message: msg("t1", "tool", t(11), { content_type: "execution_output", text: MARKERS.toolOutput }, { author: { role: "tool", name: "python", metadata: {} }, metadata: { aggregate_result: { code: MARKERS.toolInput, final_expression_output: MARKERS.toolOutput } } }) },
    { id: "a3", parent: "t1", message: msg("a3", "assistant", t(12), { content_type: "code", language: "unknown", text: MARKERS.toolInput }, { recipient: "web.run", end_turn: false, metadata: { model_slug: "gpt-5-6-thinking" } }) },
    { id: "t2", parent: "a3", message: msg("t2", "tool", t(14), { content_type: "tether_browsing_display", result: MARKERS.browsing, summary: MARKERS.browsing, assets: [], tether_id: null }, { author: { role: "tool", name: "web.run", metadata: {} }, metadata: { search_result_groups: [{ domain: MARKERS.searchDomain, entries: [{ url: MARKERS.citation, title: MARKERS.browsing }] }] } }) },
    { id: "a4", parent: "t2", message: msg("a4", "assistant", t(15), { content_type: "text", parts: [MARKERS.toolInput] }, { recipient: MARKERS.gptAction, end_turn: false, metadata: { model_slug: "gpt-5-6-thinking" } }) },
    { id: "t3", parent: "a4", message: msg("t3", "tool", t(16), { content_type: "system_error", name: MARKERS.toolError, text: MARKERS.toolError }, { author: { role: "tool", name: MARKERS.gptAction, metadata: {} } }) },
    // The first reply, later regenerated: off the branch the person ended on.
    { id: "a5", parent: "t3", message: msg("a5", "assistant", t(20), text(MARKERS.regenerated), { end_turn: true, metadata: { model_slug: "gpt-5-6-thinking", citations: [{ metadata: { url: MARKERS.citation } }] } }) },
    { id: "a5b", parent: "t3", message: msg("a5b", "assistant", t(60), text(MARKERS.assistant), { end_turn: true, metadata: { model_slug: "gpt-5.6-xyz-wm", content_references: [{ type: "grouped_webpages", items: [{ url: MARKERS.citation, title: MARKERS.assistant }] }] } }) },
    {
      id: "u2",
      parent: "a5b",
      message: msg(
        "u2",
        "user",
        t(300),
        multimodal({ content_type: "audio_transcription", text: PROMPT_TWO, direction: "in", decoding_id: null }, { content_type: "audio_asset_pointer", asset_pointer: MARKERS.audioPointer, size_bytes: 10, format: "wav", metadata: { start: 0, end: 2 } }),
        { metadata: { voice_mode_message: true } },
      ),
    },
    { id: "a6", parent: "u2", message: msg("a6", "assistant", t(305), multimodal({ content_type: "audio_transcription", text: MARKERS.assistantVoice, direction: "out" }, { content_type: "audio_asset_pointer", asset_pointer: MARKERS.audioPointer }), { end_turn: true, metadata: { model_slug: "gpt-4o", voice_mode_message: true } }) },
    // Only a big paste: a turn the person took, with no words of theirs to keep.
    { id: "u3", parent: "a6", message: msg("u3", "user", t(600), text(""), { metadata: { attachments: [{ id: "file-2", name: MARKERS.pasteName, size: 9999, mime_type: "text/plain", is_big_paste: true, source: "local" }] } }) },
    { id: "a7", parent: "u3", message: msg("a7", "assistant", t(630), text(MARKERS.assistant), { end_turn: true, metadata: { model_slug: "gpt-4o" } }) },
  ];
  return {
    title: MARKERS.title,
    create_time: base,
    update_time: base + 630,
    mapping: tree(nodes),
    moderation_results: [],
    current_node: "a7",
    plugin_ids: null,
    conversation_id: id,
    conversation_template_id: MARKERS.gizmo,
    gizmo_id: MARKERS.gizmo,
    gizmo_type: "gpt",
    is_archived: false,
    safe_urls: [MARKERS.citation],
    blocked_urls: [],
    default_model_slug: "gpt-5-6-thinking",
    conversation_origin: null,
    voice: null,
    async_status: null,
    disabled_tool_ids: [],
    is_do_not_remember: false,
    memory_scope: "global_enabled",
    owner: MARKERS.account,
    id,
  };
}

/**
 * The trimmed shape: nodes with only `id`, `parent` and `message`, no recipients or tool messages; thinking as
 * `thoughts` and `reasoning_recap`; a web search recorded on the reply it fed; a prompt edited once (the first
 * version and its reply sit off the branch).
 */
export function currentConversation(id = "7a2d1b3f-0000-4000-8000-000000000002", base = BASE + 86_400): Rec {
  const t = (seconds: number) => base + seconds;
  const m = (mid: string, role: string, at: number, content: Rec, metadata: Rec = {}): Rec => ({ id: mid, author: { role, name: null }, create_time: at, content, metadata });
  const nodes: Node[] = [
    { id: "client-created-root", parent: null, message: null },
    { id: "p1", parent: "client-created-root", message: m("p1", "user", t(0), text(PROMPT_ONE), { serialization_metadata: { custom_symbol_offsets: [] } }) },
    { id: "th1", parent: "p1", message: m("th1", "assistant", t(3), { content_type: "thoughts", thoughts: [{ summary: MARKERS.thoughtSummary, content: MARKERS.thoughts, chunks: [], finished: true }], source_analysis_msg_id: "s" }, { model_slug: "gpt-6.1-xyz-wm", tool_icons: ["globe"], parent_id: "p1" }) },
    { id: "rr1", parent: "th1", message: m("rr1", "assistant", t(8), { content_type: "reasoning_recap", content: MARKERS.recap }, { model_slug: "gpt-6.1-xyz-wm" }) },
    {
      id: "r1",
      parent: "rr1",
      message: m("r1", "assistant", t(20), text(MARKERS.assistant), {
        model_slug: "gpt-6.1-xyz-wm",
        search_result_groups: [{ domain: MARKERS.searchDomain, entries: [{ url: MARKERS.citation, title: MARKERS.assistant }] }],
        content_references: [{ type: "grouped_webpages", alt: MARKERS.assistant, prompt_text: MARKERS.assistant, items: [{ url: MARKERS.citation }] }],
        conversation_context_citation_metadata: [{ citation: MARKERS.memoryCitation, citation_uuid: "c", deleted: false, feedback: null }],
      }),
    },
    // The first version of the second prompt, later edited.
    { id: "p2", parent: "r1", message: m("p2", "user", t(200), text(MARKERS.hiddenUser)) },
    { id: "r2", parent: "p2", message: m("r2", "assistant", t(210), text(MARKERS.regenerated), { model_slug: "gpt-6.1-xyz-wm" }) },
    { id: "p2b", parent: "r1", message: m("p2b", "user", t(300), text(PROMPT_THREE), { attachments: [{ id: "f", name: MARKERS.attachmentName, size: 1, mime_type: "image/jpeg", width: 1, height: 1, library_file_id: "lib" }] }) },
    { id: "r2b", parent: "p2b", message: m("r2b", "assistant", t(320), text(MARKERS.assistant), { model_slug: "gpt-5-5", automation_title: MARKERS.title }) },
  ];
  const mapping: Record<string, Rec> = {};
  for (const node of nodes) mapping[node.id] = { id: node.id, message: node.message, parent: node.parent };
  return {
    title: MARKERS.title,
    create_time: base + 5,
    update_time: base + 320,
    mapping,
    current_node: "r2b",
    conversation_id: id,
    conversation_template_id: MARKERS.project,
    default_model_slug: "gpt-6.1-xyz-wm",
    id,
    is_archived: false,
    is_do_not_remember: false,
    is_read_only: null,
    is_starred: null,
    is_study_mode: false,
    memory_scope: "global_enabled",
    pinned_time: null,
    plugin_ids: null,
    voice: null,
  };
}

export function exportJson(conversations: Rec[]): string {
  return JSON.stringify(conversations);
}

/**
 * Files a ChatGPT export holds next to its conversations. Each is shaped like a conversations file and carries a
 * prompt marker, so a test can tell whether any of them was read.
 */
export const PRIVATE_FILE_PROMPT = "MARK_GPT_PRIVATE_FILE_PROMPT_3c9";
export const PRIVATE_FILES = ["user.json", "user_settings.json", "conversation_summaries.json", "shared_conversations.json", "sectioned_conversations.json", "library_files.json", "conversation_asset_file_names.json", "message_feedback.json", "ads.json", "file_0000000000aa00000000000000000001.dat"];

export function privateFileBody(): string {
  const leak = classicConversation("8b3e2c40-0000-4000-8000-00000000dead");
  const mapping = leak.mapping as Record<string, { message: Record<string, unknown> | null }>;
  mapping.u1!.message!.content = text(PRIVATE_FILE_PROMPT);
  return JSON.stringify([leak]);
}
