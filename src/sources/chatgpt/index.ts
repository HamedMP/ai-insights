import type { Source } from "../../schema/types.js";
import { importedChatSource } from "../claude-chat/index.js";
import { CHATGPT_HARNESS } from "./importer.js";

/** ChatGPT history, from a data export the person imported with `ai-insights import openai <path>`. */
export const chatgptSource: Source = importedChatSource(CHATGPT_HARNESS, "ChatGPT");
