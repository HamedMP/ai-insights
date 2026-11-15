import type { Source } from "../../schema/types.js";

/** Placeholder until the Claude Code source lands. Reports no history. */
export const claudeSource: Source = {
  harness: "claude-code",
  label: "Claude Code",
  defaultRoots: () => [],
  discover: async () => [],
  parse: async () => null,
  excerpt: async () => [],
};
