import type { Harness, Source } from "../schema/types.js";
import { claudeSource } from "./claude/index.js";
import { codexSource } from "./codex/index.js";

/** Every harness AI Insights can read. Add a source here to make it show up everywhere. */
export const sources: Source[] = [claudeSource, codexSource];

export function sourceFor(harness: Harness): Source | undefined {
  return sources.find((source) => source.harness === harness);
}
