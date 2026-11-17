import { deflateRawSync } from "node:zlib";

/**
 * Small, hand-written Claude chat export fixtures. Every field the import must never keep holds a marker
 * string, so a test can search everything downstream for them.
 */

export const MARKERS = {
  title: "MARK_TITLE_7f1",
  summary: "MARK_SUMMARY_7f1",
  assistant: "MARK_ASSISTANT_TEXT_7f1",
  assistantBlock: "MARK_ASSISTANT_BLOCK_7f1",
  thinking: "MARK_THINKING_7f1",
  thinkingSummary: "MARK_THINKING_SUMMARY_7f1",
  toolInput: "MARK_TOOL_INPUT_7f1",
  toolOutput: "MARK_TOOL_OUTPUT_7f1",
  toolDisplay: "MARK_TOOL_DISPLAY_7f1",
  connectorTool: "mark_connector_tool_7f1",
  connectorName: "MARK_CONNECTOR_NAME_7f1",
  mcpUrl: "https://mark-mcp-7f1.example/mcp",
  attachmentName: "MARK_ATTACHMENT_NAME_7f1.pdf",
  attachmentText: "MARK_ATTACHMENT_TEXT_7f1",
  fileName: "MARK_FILE_NAME_7f1.png",
  voice: "MARK_VOICE_TEXT_7f1",
  voiceTitle: "MARK_VOICE_TITLE_7f1",
  citation: "https://mark-citation-7f1.example/page",
  account: "MARK_ACCOUNT_7f1",
} as const;

export const PROMPT_ONE = "Can you help me plan a week of dinners for two people please";
export const PROMPT_TWO = "Thanks, now make it vegetarian";

type Rec = Record<string, unknown>;

const at = (base: string, seconds: number) => new Date(Date.parse(base) + seconds * 1000).toISOString();

export function message(uuid: string, sender: "human" | "assistant", createdAt: string, parent: string | null, extra: Rec = {}): Rec {
  return {
    uuid,
    text: "",
    content: [],
    sender,
    created_at: createdAt,
    updated_at: createdAt,
    attachments: [],
    files: [],
    parent_message_uuid: parent,
    ...extra,
  };
}

export function human(uuid: string, createdAt: string, parent: string | null, text: string, extra: Rec = {}): Rec {
  return message(uuid, "human", createdAt, parent, {
    text,
    content: [{ start_timestamp: createdAt, stop_timestamp: createdAt, flags: null, type: "text", text, citations: [] }],
    ...extra,
  });
}

/** An assistant reply with thinking, a web search, a connector call, a failed tool, a voice note and text. */
export function assistant(uuid: string, createdAt: string, parent: string): Rec {
  return message(uuid, "assistant", createdAt, parent, {
    text: MARKERS.assistant,
    content: [
      {
        type: "thinking",
        start_timestamp: at(createdAt, 1),
        stop_timestamp: at(createdAt, 6),
        flags: null,
        thinking: MARKERS.thinking,
        summaries: [{ summary: MARKERS.thinkingSummary }],
        cut_off: false,
        truncated: false,
        hidden: false,
        thinking_hidden: false,
        alternative_display_type: null,
        signature: null,
      },
      {
        type: "tool_use",
        start_timestamp: at(createdAt, 7),
        stop_timestamp: at(createdAt, 8),
        flags: null,
        id: null,
        name: "web_search",
        input: { query: MARKERS.toolInput },
        message: MARKERS.toolDisplay,
        integration_name: null,
        mcp_server_url: null,
        display_content: { type: "text", text: MARKERS.toolDisplay },
      },
      {
        type: "tool_result",
        start_timestamp: null,
        stop_timestamp: null,
        flags: null,
        tool_use_id: null,
        name: "web_search",
        content: [{ type: "knowledge", title: MARKERS.toolOutput, url: MARKERS.citation, text: MARKERS.toolOutput, metadata: { site_name: MARKERS.toolOutput } }],
        is_error: false,
      },
      {
        type: "tool_use",
        start_timestamp: at(createdAt, 9),
        stop_timestamp: at(createdAt, 10),
        flags: null,
        name: MARKERS.connectorTool,
        input: { secret_query: MARKERS.toolInput },
        integration_name: MARKERS.connectorName,
        mcp_server_url: MARKERS.mcpUrl,
      },
      {
        type: "tool_result",
        start_timestamp: null,
        stop_timestamp: null,
        flags: null,
        name: MARKERS.connectorTool,
        content: [{ type: "text", text: MARKERS.toolOutput }],
        is_error: true,
        integration_name: MARKERS.connectorName,
      },
      { type: "token_budget", start_timestamp: null, stop_timestamp: null, flags: null, remaining: null },
      { type: "voice_note", start_timestamp: at(createdAt, 11), stop_timestamp: at(createdAt, 12), flags: null, title: MARKERS.voiceTitle, text: MARKERS.voice },
      { type: "mystery_block_from_the_future", payload: MARKERS.assistantBlock },
      {
        type: "text",
        start_timestamp: at(createdAt, 12),
        stop_timestamp: at(createdAt, 20),
        flags: null,
        text: MARKERS.assistantBlock,
        citations: [{ uuid: "c1", start_index: 0, end_index: 3, details: { type: "web_search_citation", url: MARKERS.citation } }],
      },
    ],
  });
}

/** One conversation: two prompts, two replies, one regenerated reply (a branch), an attachment and a file. */
export function conversation(uuid = "0b9a2c1e-0000-4000-8000-000000000001", base = "2026-08-03T21:15:00.000Z"): Rec {
  return {
    uuid,
    name: MARKERS.title,
    summary: MARKERS.summary,
    created_at: base,
    updated_at: at(base, 900),
    account: { uuid: MARKERS.account },
    chat_messages: [
      human("m1", at(base, 0), null, PROMPT_ONE, {
        attachments: [{ file_name: MARKERS.attachmentName, file_size: 12, file_type: "application/pdf", extracted_content: MARKERS.attachmentText }],
        files: [{ file_uuid: "f1", file_name: MARKERS.fileName }],
      }),
      assistant("m2", at(base, 30), "m1"),
      // A regenerated answer: a second child of the same prompt.
      assistant("m2b", at(base, 60), "m1"),
      human("m3", at(base, 300), "m2b", PROMPT_TWO),
      assistant("m4", at(base, 330), "m3"),
      // An attachment-only turn: counted, no words kept.
      human("m5", at(base, 600), "m4", "", { attachments: [{ file_name: MARKERS.attachmentName, extracted_content: MARKERS.attachmentText }] }),
      assistant("m6", at(base, 630), "m5"),
    ],
  };
}

export function exportJson(conversations: Rec[]): string {
  return JSON.stringify(conversations);
}

export interface ZipFileSpec {
  name: string;
  data: Buffer | string;
  /** 0 stored, 8 deflated. */
  method?: 0 | 8;
}

/** A minimal zip writer for tests (CRC left 0: the reader does not check it). `zip64` adds zip64 records. */
export function makeZip(files: ZipFileSpec[], options: { zip64?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const extra = options.zip64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
    if (options.zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(raw.length), 4);
      extra.writeBigUInt64LE(BigInt(body.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(45, 4);
    central.writeUInt16LE(45, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : body.length, 20);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name, extra);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const tail: Buffer[] = [];
  if (options.zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeBigUInt64LE(BigInt(files.length), 24);
    record.writeBigUInt64LE(BigInt(files.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : files.length, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : files.length, 10);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, directory, ...tail, end]);
}
