import type { UserPrompt } from "../../schema/types.js";
import { BUILTIN_SLASH, COMMAND_PREFIXES, NEUTRAL, PUBLIC_MCP_SERVERS, PUBLIC_MODEL, PUBLIC_PROGRAMS, PUBLIC_SKILLS, SETUP_BUILTINS } from "./vocabulary.js";

/** Prompts longer than this are cut before tokenising; prompts are stored at 2,000 characters anyway. */
const MAX_TEXT = 4_000;

/** A prompt that opens with an XML-style tag is a template a script filled in, not words the person typed. */
const WRAPPED = /^\s*<[A-Za-z_][A-Za-z0-9_-]*>/;

export function isWrapped(prompt: UserPrompt): boolean {
  return WRAPPED.test(prompt.text);
}

export function isSlash(prompt: UserPrompt): boolean {
  return prompt.text.trimStart().startsWith("/");
}

/** Words the person typed themselves: not a slash command and not a filled-in template. */
export function isVoice(prompt: UserPrompt): boolean {
  return !isSlash(prompt) && !isWrapped(prompt);
}

/** Drops code, tags, links and anything path- or address-shaped, so only plain words remain. */
export function plainText(text: string): string {
  return text
    .slice(0, MAX_TEXT)
    // Harness markers for pasted images and text ("[image]", "[Image #2]", "[Pasted text #1 +40 lines]") are not words typed.
    .replace(/\[(?:image|pasted text)[^\]]{0,40}\]/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]{0,400}>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S*[/\\@]\S*/g, " ");
}

/** Lower-case word tokens of plain text, curly apostrophes made straight. */
export function tokens(text: string): string[] {
  return (plainText(text).toLowerCase().match(/[a-z][a-z'’-]*[a-z]|[a-z]/g) ?? []).map((word) => word.replace(/’/g, "'"));
}

export function wordCount(text: string): number {
  let count = 0;
  for (const part of text.slice(0, MAX_TEXT).trim().split(/\s+/)) if (part) count += 1;
  return count;
}

const QUESTION_START = /^(what|why|how|when|where|which|who|is|are|can|could|does|do|should)\b/i;

export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  return /\?\s*$/.test(trimmed) || QUESTION_START.test(trimmed);
}

export const POLITE = {
  please: /\b(please|pls|plz)\b/i,
  thanks: /\b(thanks|thank you|thx|cheers)\b/i,
  sorry: /\bsorry\b/i,
} as const;

/** The slash command a prompt invokes, lower-cased without the slash, or null. */
export function slashName(text: string): string | null {
  const match = /^\/([a-z][a-z0-9:_-]{0,40})(?=\s|$)/i.exec(text.trimStart());
  return match ? match[1]!.toLowerCase() : null;
}

/** `model`, `/model` and `Model` are one command; the label is a built-in's name or the neutral fallback. */
export function slashLabel(name: string): string {
  const key = name.trim().replace(/^\//, "").toLowerCase();
  return BUILTIN_SLASH.has(key) ? `/${key}` : NEUTRAL.custom;
}

function lastSegment(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * The program a shell command runs, as a public name or "your own CLI"; null when the command only sets up
 * (cd, export) or cannot be read. The first segment that runs something decides.
 */
export function programOf(command: string): string | null {
  for (const part of command.slice(0, 600).split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/).filter((word) => word && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    while (words.length && (COMMAND_PREFIXES.has(words[0]!) || words[0] === "timeout")) {
      if (words[0] === "timeout") words.splice(0, 2);
      else words.shift();
    }
    if (!words.length || SETUP_BUILTINS.has(words[0]!)) continue;
    if (/^[[#]/.test(words[0]!)) continue;
    const program = lastSegment(words[0]!.replace(/^["'(]+|["')]+$/g, ""));
    if (!program) continue;
    return PUBLIC_PROGRAMS.has(program) ? program : NEUTRAL.program;
  }
  return null;
}

export const TEST_RUN = /\b(vitest|jest|pytest|playwright test|go test|cargo test|(pnpm|npm|bun|yarn)( run)? test(:\S+)?|mocha|rspec)\b/;
export const RM_RF = /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/;
export const FORCE_PUSH = /git push[^\n]*(--force|-f\b)/;
export const SLEEP = /^\s*sleep\b/;

/**
 * Harnesses decorate server names: Claude's hosted connectors are `claude_ai_Linear`, many servers are installed
 * as `linear-server` or `github_mcp`. The bare product name is what the allowlist knows. Plugin servers
 * (`plugin_<plugin>_<server>`) carry a plugin name that can be private, so they stay custom.
 */
export function connectorLabel(server: string): string {
  const key = server
    .trim()
    .toLowerCase()
    .replace(/^claude_ai_/, "")
    .replace(/[-_](server|mcp)$/, "")
    .replace(/^mcp[-_]/, "")
    .replace(/_/g, "-");
  return PUBLIC_MCP_SERVERS.has(key) ? key : NEUTRAL.custom;
}

export function skillLabel(skill: string): string {
  // Plugin skills are `plugin:skill`; the plugin name can be private, so only the bare public names pass.
  const key = skill.trim().replace(/^\//, "").toLowerCase();
  return PUBLIC_SKILLS.has(key) ? key : NEUTRAL.custom;
}

function prettyModel(model: string): string {
  return model
    .replace(/-\d{8}$/, "")
    .replace(/^claude-/, "Claude ")
    .replace(/(\d)-(\d)(?!\d)/g, "$1.$2")
    .split(/[-\s]/)
    .filter(Boolean)
    .map((word) => (/^gpt$/i.test(word) ? "GPT" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ")
    .replace(/^GPT (\d)/, "GPT-$1");
}

/** A model id as a public display name, or "Another model" for anything outside the known families. */
export function modelLabel(model: string): string {
  const id = model.trim();
  // Router-style ids carry a provider in front (`anthropic/claude-…`); the provider can be a private name.
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return bare.length <= 80 && PUBLIC_MODEL.test(bare) ? prettyModel(bare.toLowerCase()) : NEUTRAL.model;
}
