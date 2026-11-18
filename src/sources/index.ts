import type { Harness, Source } from "../schema/types.js";
import { claudeSource } from "./claude/index.js";
import { chatgptSource } from "./chatgpt/index.js";
import { claudeChatSource } from "./claude-chat/index.js";
import { codexSource } from "./codex/index.js";
import { cursorSource } from "./cursor/index.js";
import { geminiSource } from "./gemini/index.js";
import { opencodeSource } from "./opencode/index.js";
import { piSource } from "./pi/index.js";

/** Every harness AI Insights can read. Add a source here to make it show up everywhere. */
export const sources: Source[] = [claudeSource, codexSource, cursorSource, opencodeSource, piSource, geminiSource, claudeChatSource, chatgptSource];

export function sourceFor(harness: Harness): Source | undefined {
  return sources.find((source) => source.harness === harness);
}
