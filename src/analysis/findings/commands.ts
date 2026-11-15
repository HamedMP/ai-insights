/** Shell command helpers shared by the detectors that reason about what the agent ran. */

/** Prefixes and pipes that change how a command is run but not what it does. */
const CD_PREFIX = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
const OUTPUT_TAIL = /\s*(?:2>&1|\|\s*(?:tail|head|grep|less|cat|tee)\b.*)$/;
/** `timeout [options] DURATION cmd`; `-k` and `-s` take a separate value. */
const TIMEOUT_WRAPPER = /^g?timeout(?:\s+(?:-[ks]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+\d+(?:\.\d+)?[smhd]?\s+/;
const OTHER_WRAPPER = /^(?:time|nohup|env|npx\s+--yes|nice(?:\s+-n\s+-?\d+)?|stdbuf(?:\s+-[ioe]\S+)+)\s+/;

/**
 * Parts that differ on every run of the same command. Order matters: whole temp paths first,
 * then ids inside what remains, so a hash inside a temp path does not leave a stray placeholder.
 */
const VOLATILE: Array<[RegExp, string]> = [
  [/(?:\/private)?\/(?:tmp|var\/folders|var\/tmp)\/[^\s'"`;|&)]*/g, "<tmp>"],
  [/\$\{?TMPDIR\}?[^\s'"`;|&)]*/g, "<tmp>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "<hash>"],
  [/\b\d{3,}\b/g, "<n>"],
];

/** Normalised commands longer than this are cut, and the id gets a hash of the full text instead. */
const MAX_COMMAND_CHARS = 160;

/**
 * The same intent written slightly differently should count as one command: the
 * agent often prefixes `cd repo &&`, sets env vars, wraps it in `timeout`, pipes output
 * through `tail`, or points it at a fresh temp directory.
 */
export function normalizeCommand(command: string): string {
  let text = command.replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const before = text;
    text = text.replace(CD_PREFIX, "").replace(ENV_PREFIX, "").replace(TIMEOUT_WRAPPER, "").replace(OTHER_WRAPPER, "");
    text = text.replace(OUTPUT_TAIL, "").trim();
    if (text === before) break;
  }
  for (const [pattern, placeholder] of VOLATILE) text = text.replace(pattern, placeholder);
  return text.slice(0, MAX_COMMAND_CHARS);
}

const PLACEHOLDER = /<(?:tmp|hash|id|time|n)>/;
const PLACEHOLDERS = /<(?:tmp|hash|id|time|n)>/g;
/** Programs that say nothing on their own: `node <temp file>` could be anything. */
const INTERPRETERS = new Set(["node", "bash", "sh", "zsh", "fish", "python", "python3", "deno", "bun", "ruby", "perl", "php", "tsx", "ts-node", "npx", "uv", "uvx", "pnpm dlx", "source", "."]);

/**
 * The command as a person should read it: run-to-run values become "…" and output redirected
 * to a temp file is dropped, so no placeholder, hash or temp path reaches the report.
 */
export function readableCommand(normalized: string): string {
  return normalized
    .replace(/\s*\d?>>?\s*<tmp>/g, "")
    .replace(PLACEHOLDERS, "…")
    .replace(/…(?:[\s/._-]*…)+/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a person would recognise the command: everything before the first run-to-run
 * value must name something beyond an interpreter and flags, like `gh pr view` or a script path.
 */
export function isRecognisable(normalized: string): boolean {
  const cut = normalized.search(PLACEHOLDER);
  if (cut < 0) return normalized.trim().length > 0;
  const words = normalized
    .slice(0, cut)
    .trim()
    .split(/\s+/)
    .filter((word) => word && !word.startsWith("-") && !INTERPRETERS.has(word));
  return words.some((word) => word.length >= 2);
}

export function hasTempPath(normalized: string): boolean {
  return normalized.includes("<tmp>");
}

/** Short stable key for a normalised command: readable prefix plus a hash of the whole thing. */
export function commandKey(normalized: string, maxChars = 40): string {
  if (normalized.length <= maxChars) return normalized;
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${normalized.slice(0, maxChars).trimEnd()}…${hash.toString(16).padStart(8, "0")}`;
}

/** Commands that check work: tests, type checks, linters and builds. Broad on purpose, so a check is rarely missed. */
const CHECK_COMMAND =
  /\b(?:test|tests|vitest|jest|mocha|ava|pytest|tox|nox|rspec|phpunit|ctest|unittest|typecheck|type-check|tsc|mypy|pyright|check|clippy|lint|eslint|biome|ruff|flake8|vet|build|make|gradle|mvn|bazel|xcodebuild)\b/i;

export function isCheckCommand(command: string): boolean {
  return CHECK_COMMAND.test(command);
}

/** A check command worth quoting back to the person, e.g. `pnpm test`, rather than a bare `make`. */
export function isTestOrTypecheck(command: string): boolean {
  return /\b(?:test|tests|vitest|jest|pytest|typecheck|type-check|tsc|mypy|pyright|cargo check)\b/i.test(command);
}
