import { importExport, type ExportFormat, type ImportOptions, type ImportOutcome } from "../claude-chat/importer.js";
import { conversationToSession, CONVERSATION_SPEC } from "./conversation.js";

/**
 * `ai-insights import openai <path>`: a ChatGPT data export, streamed through the same zip and JSON readers,
 * staging and swap as the Claude import, into `imports/chatgpt/` under the AI Insights home.
 */

export const CHATGPT_HARNESS = "chatgpt" as const;

/**
 * ChatGPT, checked against an unzipped export from November 2026: `conversations-000.json`, `-001` and so on (one
 * JSON array each) beside `export_manifest.json`, account and settings files (`user.json`, `user_settings.json`),
 * `conversation_summaries.json`, library and asset name lists, uploads as `file_*.dat`, and `pages/`, `sites/`
 * and `spaces/` folders. Older exports hold one `conversations.json` (plus `chat.html`, `message_feedback.json`
 * and more); the download is one zip of all of it. Only the conversations files are ever opened.
 */
export const CHATGPT_EXPORT: ExportFormat = {
  source: "openai",
  harness: CHATGPT_HARNESS,
  label: "ChatGPT",
  conversationFile: /^conversations(?:-\d{1,4})?\.json$/i,
  // At the zip's root or in the one folder a re-zipped export adds; never inside pages, sites or spaces.
  conversationEntry: /^(?:(?!(?:pages|sites|spaces)\/)[^/]+\/)?conversations(?:-\d{1,4})?\.json$/i,
  conversationZip: /\.zip$/i,
  privateZip: /^(?:user|account|memories|library)\b/i,
  manifestFile: /^export_manifest\.json$/i,
  spec: CONVERSATION_SPEC,
  arrayKey: "conversations",
  toSession: conversationToSession,
};

export function importChatgptExport(path: string, home: string, options: ImportOptions = {}): Promise<ImportOutcome> {
  return importExport(CHATGPT_EXPORT, path, home, options);
}
