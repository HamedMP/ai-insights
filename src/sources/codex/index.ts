import type { Source } from "../../schema/types.js";

/** Placeholder until the Codex source lands. Reports no history. */
export const codexSource: Source = {
  harness: "codex",
  label: "Codex",
  defaultRoots: () => [],
  discover: async () => [],
  parse: async () => null,
  excerpt: async () => [],
};
