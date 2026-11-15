/** Helpers every source uses, so redaction and bucketing behave the same across harnesses. */

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
];
const ASSIGNMENT = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s"']+)/gi;

/** Replace anything that looks like a credential. Runs before text is stored or shown. */
export function redact(text: string): string {
  let out = text.replace(ASSIGNMENT, (_match, name: string) => `${name}=[redacted]`);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Redact, collapse whitespace runs, then cap the length. */
export function clean(text: string, max: number): string {
  return truncate(redact(text).replace(/[ \t]+/g, " ").trim(), max);
}

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", rs: "Rust", go: "Go", rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++", cs: "C#", php: "PHP",
  sh: "Shell", bash: "Shell", zsh: "Shell", fish: "Shell",
  md: "Markdown", mdx: "Markdown", json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  html: "HTML", css: "CSS", scss: "CSS", sql: "SQL", vue: "Vue", svelte: "Svelte",
  ex: "Elixir", exs: "Elixir", dart: "Dart", lua: "Lua", zig: "Zig", nix: "Nix", tf: "Terraform",
};

/** Language name for a file path, or null when the extension is unknown. */
export function languageForPath(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "Dockerfile") return "Docker";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return LANGUAGES[base.slice(dot + 1).toLowerCase()] ?? null;
}

export const IDLE_GAP_MS = 10 * 60 * 1000;

/** Minutes with activity: gaps longer than ten minutes count as idle, not work. */
export function activeMinutes(timestamps: string[]): number {
  const times = timestamps.map((value) => Date.parse(value)).filter(Number.isFinite).sort((a, b) => a - b);
  let total = 0;
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index]! - times[index - 1]!;
    if (gap <= IDLE_GAP_MS) total += gap;
  }
  return Math.round(total / 60_000);
}
