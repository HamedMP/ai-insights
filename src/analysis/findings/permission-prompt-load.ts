import type { Finding, Harness, Session, ToolCall } from "../../schema/types.js";
import { normalizeCommand } from "./commands.js";
import { evidence, HARNESS_LABELS, label, MAX_EVIDENCE, plural, type Detector } from "./context.js";

/** Blocked or rejected calls needed before permissions are a real drag rather than the odd "no". */
const MIN_BLOCKED = 10;
/** Spread over sessions, so it reflects the setup, not one risky task. */
const MIN_SESSIONS = 3;
/** Per hundred tool calls. Below one, refusals are rare enough to be deliberate safety stops, not friction. */
const MIN_PER_HUNDRED = 1;
/** Above these, the person is interrupted every few minutes of agent work. */
const MEDIUM_PER_HUNDRED = 5;
const HIGH_PER_HUNDRED = 15;
/**
 * The same safe command blocked this often, in more than one session, is worth an allow rule whatever the overall rate.
 * Fewer blocks than this are too thin to justify loosening permissions, even when the overall rate fires.
 */
const MIN_PATTERN_DENIALS = 5;
const MIN_PATTERN_SESSIONS = 2;
/** Named in the detail when blocked at least twice; once is not "repeatedly". */
const REPEATED = 2;
const MAX_PATTERNS = 5;

/** Both stop the agent and wait for the person; approved prompts leave no trace in transcripts. */
const BLOCKED = new Set(["permission_denied", "user_rejected"]);

/** CLIs whose verbs are two words deep (`gh pr ready`), so an allow rule names the whole verb. */
const SUBCOMMAND_DEPTH: Record<string, number> = { gh: 2, glab: 2, gcloud: 2, aws: 2, az: 2, npm: 2, pnpm: 2, yarn: 2, docker: 2, kubectl: 1, git: 1 };
/** Allowing one of these by name alone would allow any script; the rule must name the script too. */
const INTERPRETERS = new Set(["node", "python", "python3", "bash", "sh", "zsh", "deno", "bun", "ruby", "perl", "npx", "tsx"]);

/**
 * Never proposed for an allow rule: commands that delete, rewrite history, bypass review or need admin rights.
 * Checked against the whole command, so `git push origin main --force` is unsafe even though its pattern is `git push`.
 */
const UNSAFE: RegExp[] = [
  /^(?:sudo|su|doas)\b/,
  /(?:^|[;&|]\s*)(?:rm|rmdir|shred|dd|mkfs\S*|fdisk|parted|chown|chmod|truncate)\b/,
  /^git\s+(?:reset\s+--hard|clean\b|branch\s+-D|filter-branch|filter-repo|reflog\s+expire|update-ref\s+-d|stash\s+(?:drop|clear)|checkout\s+--\s|restore\b)/,
  /^git\s+push\b.*(?:\s--force(?!-with-lease)\b|\s-f\b|\s--delete\b|\s-d\b|\s--mirror\b|\s\+\S|\s:\S)/,
  /^git\s+push\b.*\s(?:main|master|production|prod|release)\b/,
  /^gh\s+(?:repo\s+(?:delete|archive|edit|rename)|release\s+delete|secret\b|variable\b|auth\b|api\b|ruleset\b|workflow\s+(?:disable|run)|issue\s+delete|pr\s+close|run\s+(?:cancel|delete))/,
  /^gh\s+pr\s+merge\b/,
  /\s--admin\b|\s--no-verify\b|\s--force(?!-with-lease)\b|\s--hard\b/,
  /^(?:kubectl|helm)\s+(?:delete|drain|uninstall|cordon)\b/,
  /^docker\s+(?:rm|rmi|system\s+prune|volume\s+(?:rm|prune)|image\s+prune)\b/,
  /^terraform\s+(?:destroy|apply|import|state)\b/,
  /^(?:npm|pnpm|yarn)\s+(?:publish|unpublish|deprecate|owner|access|dist-tag)\b/,
  /\bdrop\s+(?:table|database|schema)\b|\btruncate\s+table\b/i,
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/,
];

const WORD = /^[a-z][a-z0-9:_.-]*$/i;
/** Shell syntax, not a program: a loop or test says nothing about which command was blocked. */
const SHELL_KEYWORDS = new Set(["for", "while", "until", "if", "case", "do", "then", "[", "[[", "{", "(", "function", "select", "time", "!"]);
/**
 * Prefix rules match everything after them, so `Bash(git push:*)` would also allow `git push --force origin main`.
 * These verbs are named when blocked but never proposed as a rule on their own.
 */
const TOO_BROAD = new Set([
  "git push", "git branch", "git checkout", "git switch", "git reset", "git rebase", "git tag", "git stash", "git remote", "git config",
  "gh api", "gh repo", "gh release", "gh secret", "gh auth", "gh workflow", "gh pr merge", "gh pr close",
  "docker", "kubectl", "terraform", "helm", "npm", "pnpm", "yarn",
]);

export interface CommandPattern {
  /** What the person reads and what an allow rule matches as a prefix, e.g. `gh pr ready`. */
  pattern: string;
  /** True when the command deletes, forces or needs admin rights, so it is never proposed for an allow rule. */
  unsafe: boolean;
  /** True when a prefix rule for this pattern would also allow destructive variants. */
  broad: boolean;
}

/** The program, its verb and the leading long flags, stopping at the first argument that changes between runs. */
export function commandPattern(command: string): CommandPattern | null {
  const normalized = normalizeCommand(command);
  const first = normalized.split(/\s*(?:&&|\|\||;)\s*/)[0]?.trim() ?? "";
  if (!first) return null;
  const tokens = first.split(/\s+/);
  const program = tokens[0]!;
  if (program.includes("<") || SHELL_KEYWORDS.has(program) || /^[([{!]/.test(program)) return null;
  const out = [program];
  let index = 1;
  if (INTERPRETERS.has(program)) {
    const script = tokens[1];
    if (script && !script.startsWith("-") && !script.includes("<")) {
      out.push(script);
      index = 2;
    }
  } else {
    const depth = SUBCOMMAND_DEPTH[program] ?? 1;
    while (out.length <= depth && index < tokens.length && WORD.test(tokens[index]!)) out.push(tokens[index++]!);
    while (index < tokens.length && /^--[a-z][a-z0-9-]*$/i.test(tokens[index]!) && out.length < depth + 3) out.push(tokens[index++]!);
  }
  const whole = [normalized, command.trim()];
  const pattern = out.join(" ");
  return { pattern, unsafe: whole.some((text) => UNSAFE.some((rule) => rule.test(text))), broad: TOO_BROAD.has(pattern) };
}

interface PatternStats {
  count: number;
  sessions: Set<Session>;
  /** Blocked by the person, not by settings: their "no" is deliberate, so it is not a candidate for an allow rule. */
  rejectedByPerson: boolean;
  unsafe: boolean;
  broad: boolean;
  shell: boolean;
}

interface HarnessStats {
  blocked: number;
  calls: number;
  patterns: Map<string, PatternStats>;
  sessions: Map<Session, { count: number; first: string; patterns: Map<string, number> }>;
}

/** Null for a shell command that has no nameable program (a loop, a subshell): it still counts, but is not named. */
function patternOf(call: ToolCall): { key: string; unsafe: boolean; broad: boolean; shell: boolean } | null {
  if (call.category === "shell") {
    const found = call.command ? commandPattern(call.command) : null;
    return found ? { key: label(found.pattern), unsafe: found.unsafe, broad: found.broad, shell: true } : null;
  }
  return { key: call.name, unsafe: false, broad: true, shell: false };
}

function allowRule(pattern: string): string {
  return `"Bash(${pattern}:*)"`;
}

const SETTINGS_URL: Partial<Record<Harness, string>> = {
  "claude-code": "https://code.claude.com/docs/en/settings",
  codex: "https://developers.openai.com/codex",
};

const GENERIC_ACTION: Partial<Record<Harness, string>> = {
  "claude-code":
    "Add allow rules for the commands and tools you always approve (`/permissions`, or `permissions.allow` in `.claude/settings.json`), and deny rules for the ones you always refuse, so the agent stops asking.",
  codex:
    "Choose an approval policy and sandbox mode that match how you work (`/approvals` in Codex, or `approval_policy` and `sandbox_mode` in `~/.codex/config.toml`).",
};

export const permissionPromptLoad: Detector = ({ sessions }) => {
  const byHarness = new Map<Harness, HarnessStats>();
  for (const session of sessions) {
    let row = byHarness.get(session.harness);
    if (!row) byHarness.set(session.harness, (row = { blocked: 0, calls: 0, patterns: new Map(), sessions: new Map() }));
    row.calls += session.toolCalls.length;
    for (const call of session.toolCalls) {
      if (!call.error || !BLOCKED.has(call.error)) continue;
      row.blocked += 1;
      const perSession = row.sessions.get(session) ?? { count: 0, first: call.timestamp, patterns: new Map<string, number>() };
      perSession.count += 1;
      row.sessions.set(session, perSession);
      const found = patternOf(call);
      if (!found) continue;
      const { key, unsafe, broad, shell } = found;
      perSession.patterns.set(key, (perSession.patterns.get(key) ?? 0) + 1);
      const stats = row.patterns.get(key) ?? { count: 0, sessions: new Set<Session>(), rejectedByPerson: false, unsafe: false, broad, shell };
      stats.count += 1;
      stats.sessions.add(session);
      stats.unsafe ||= unsafe;
      stats.rejectedByPerson ||= call.error === "user_rejected";
      row.patterns.set(key, stats);
    }
  }

  const findings: Finding[] = [];
  for (const [harness, row] of [...byHarness].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (row.blocked === 0) continue;
    const perHundred = (row.blocked / Math.max(1, row.calls)) * 100;
    const ranked = [...row.patterns].sort((a, b) => b[1].count - a[1].count || b[1].sessions.size - a[1].sessions.size || a[0].localeCompare(b[0]));
    const allowable = ranked.filter(
      ([pattern, stats]) =>
        stats.shell &&
        !stats.unsafe &&
        !stats.broad &&
        !stats.rejectedByPerson &&
        pattern.includes(" ") &&
        stats.count >= MIN_PATTERN_DENIALS &&
        stats.sessions.size >= MIN_PATTERN_SESSIONS,
    );
    const byRate = row.blocked >= MIN_BLOCKED && row.sessions.size >= MIN_SESSIONS && perHundred >= MIN_PER_HUNDRED;
    if (!byRate && allowable.length === 0) continue;

    const repeated = ranked.filter(([, stats]) => stats.count >= REPEATED).slice(0, MAX_PATTERNS);
    const shown = (pattern: string, stats: PatternStats) => `\`${pattern}\` (${plural(stats.count, "time")} in ${plural(stats.sessions.size, "session")})`;
    const which = repeated.length
      ? `Blocked repeatedly: ${repeated.map(([pattern, stats]) => shown(pattern, stats)).join(", ")}.`
      : ranked.length
        ? `Most were ${ranked.slice(0, 3).map(([pattern, stats]) => `\`${pattern}\` (${stats.count})`).join(", ")}.`
        : "";
    const items = [...row.sessions]
      .sort((a, b) => b[1].count - a[1].count || a[1].first.localeCompare(b[1].first))
      .slice(0, MAX_EVIDENCE)
      .map(([session, info]) => {
        const [top] = [...info.patterns].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        return evidence(session, `${plural(info.count, "tool call")} denied or rejected${top ? `, mostly \`${top[0]}\`` : ""}`, info.first);
      });

    const name = HARNESS_LABELS[harness];
    const rules = harness === "claude-code" ? allowable.slice(0, MAX_PATTERNS).map(([pattern]) => allowRule(pattern)) : [];
    const leftOut = repeated.filter(([, stats]) => stats.shell && (stats.unsafe || stats.broad)).map(([pattern]) => `\`${pattern}\``);
    const action = rules.length
      ? `Allow the commands that keep getting blocked by adding \`"permissions": {"allow": [${rules.join(", ")}]}\` to \`.claude/settings.json\`.${leftOut.length ? ` ${leftOut.join(", ")} ${leftOut.length === 1 ? "is" : "are"} left out on purpose: a rule for ${leftOut.length === 1 ? "it" : "them"} would also allow destructive or admin commands, which should keep asking.` : ""}`
      : (GENERIC_ACTION[harness] ?? "Allow the tools you always approve and deny the ones you always refuse in the agent's settings.");
    const url = SETTINGS_URL[harness];
    findings.push({
      id: `permission_prompt_load:${harness}`,
      kind: "permission_prompt_load",
      severity: !byRate ? "low" : perHundred >= HIGH_PER_HUNDRED ? "high" : perHundred >= MEDIUM_PER_HUNDRED ? "medium" : "low",
      title: rules.length ? `${name} keeps asking about the same commands` : `${name} keeps hitting permission walls`,
      detail: `${plural(row.blocked, "tool call")} in ${name} were denied by permission settings or rejected by you, across ${plural(row.sessions.size, "session")} (${Math.round(perHundred * 10) / 10} per 100 tool calls).${which ? ` ${which}` : ""} Each one stops the agent and waits for you.`,
      harnesses: [harness],
      metric: { value: row.blocked, unit: "blocked calls", label: "tool calls blocked or refused" },
      evidence: items,
      suggestion: {
        type: "feature",
        title: rules.length ? "Allow the commands you keep approving" : "Tune permissions once",
        action,
        ...(url ? { url } : {}),
      },
    });
  }
  return findings;
};
