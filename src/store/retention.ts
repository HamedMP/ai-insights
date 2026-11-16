import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  RETENTION_WINDOW_DAYS,
  type Harness,
  type HarnessRetention,
  type Retention,
  type RetentionAtRisk,
  type Session,
  type SessionFile,
} from "../schema/types.js";

/**
 * What a cached session keeps once the harness has deleted its transcript, read from `Session` and the store
 * (`src/store/store.ts` writes the parsed `Session` as JSON, nothing else): the numbers, tool metadata and the
 * person's own prompts, redacted. Never the assistant's replies, tool output or thinking text, which the
 * sources do not read into a session in the first place. Facets the person's agent wrote stay too.
 */
export const CACHE_KEEPS = [
  "When each session ran, how long, and in which project",
  "Token counts, models and estimated cost per request",
  "Which tools ran, failed or were declined, with shell commands redacted and cut to 300 characters",
  "Your own prompts, secrets redacted and cut to 2,000 characters",
  "Paths of files read or edited, lines changed, commits, skills, MCP servers and other feature use",
  "The session summaries (facets) your agent saved, if you ran the analysis skill",
];

export const CACHE_DROPS = [
  "The agent's replies",
  "Tool output: file contents, command output, search results",
  "Thinking text, images and attachments",
  "Anything needed to resume, rewind or replay the session in the harness",
];

const DAY_MS = 86_400_000;
const MAX_SETTINGS_BYTES = 1_000_000;
/** Claude Code reads this much from each end of a transcript to find its entry point. */
const ENTRYPOINT_PROBE_BYTES = 64 * 1024;
/** Transcripts probed for their entry point per scan; only those near the deletion age are probed. */
const MAX_PROBES = 2_000;
const MAX_DUE = 5;

export const CLAUDE_CLEANUP_URL = "https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically";
const CODEX_URL = "https://learn.chatgpt.com/docs/config-file/config-reference";
const OPENCODE_URL = "https://github.com/anomalyco/opencode";
const PI_URL = "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sessions.md";
const GEMINI_URL = "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md";

/** Entry points whose sessions Claude Code keeps at any age (v2.1.248+): Claude Desktop and Cowork. */
const DESKTOP_ENTRYPOINT = /"entrypoint"\s*:\s*"(?:claude-desktop|claude-desktop-3p|local-agent|local_agent)"/;
/** Claude Desktop's own session stores (see `src/sources/claude/index.ts`); Claude Code's sweep covers `~/.claude` only. */
const DESKTOP_STORES = ["local-agent-mode-sessions", "claude-code-sessions"];

export interface RetentionPolicy {
  harness: Harness;
  policy: HarnessRetention["policy"];
  days?: number;
  source?: HarnessRetention["source"];
  setting?: HarnessRetention["setting"];
  clock?: HarnessRetention["clock"];
  basis: string;
  url?: string;
  /**
   * Claude Code only: the age limit for sessions started or last continued in Claude Desktop or Cowork. Null:
   * kept at any age (the default). A number: deleted at that age.
   */
  desktopDays?: number | null;
}

export interface PolicyEnv {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

function tilde(path: string, home: string): string {
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** A settings file as an object: null when it does not exist, "unreadable" when it exists but does not parse. */
async function readSettings(path: string): Promise<Record<string, unknown> | null | "unreadable"> {
  let text: string;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_SETTINGS_BYTES) return "unreadable";
    text = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR" ? null : "unreadable";
  }
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : "unreadable";
  } catch {
    return "unreadable";
  }
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
}

/** Managed settings live outside the user's home, per OS (https://code.claude.com/docs/en/settings). */
function claudeManagedPath(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

export async function claudePolicy({ env = process.env, home = homedir(), platform = process.platform }: PolicyEnv = {}): Promise<RetentionPolicy> {
  const configDir = env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(home, ".claude");
  const userPath = join(configDir, "settings.json");
  const file = tilde(userPath, home);
  const base = { harness: "claude-code" as const, clock: "modified" as const, url: CLAUDE_CLEANUP_URL };
  const managed = await readSettings(claudeManagedPath(platform));
  const managedDays = managed && managed !== "unreadable" ? positiveInt(managed.cleanupPeriodDays) : null;
  if (managedDays !== null) {
    return {
      ...base,
      policy: "deletes",
      days: managedDays,
      source: "managed",
      setting: { name: "cleanupPeriodDays", file: claudeManagedPath(platform), value: managedDays },
      desktopDays: managedDays,
      basis: `Your organization's managed settings set \`cleanupPeriodDays\` to ${managedDays}: Claude Code deletes transcripts that long after they last changed, Claude Desktop and Cowork sessions included, the next time it starts.`,
    };
  }
  const user = await readSettings(userPath);
  if (user === "unreadable") {
    return {
      ...base,
      policy: "unknown",
      setting: { name: "cleanupPeriodDays", file, value: null },
      basis: `${file} could not be read, and Claude Code pauses its cleanup until its settings parse, so nothing is deleted for now. Once it is fixed, the default is 30 days.`,
    };
  }
  const days = user ? positiveInt(user.cleanupPeriodDays) : null;
  const desktop = user ? positiveInt(user.desktopSessionCleanupPeriodDays) : null;
  return {
    ...base,
    policy: "deletes",
    days: days ?? 30,
    source: days === null ? "default" : "settings",
    setting: { name: "cleanupPeriodDays", file, value: days },
    desktopDays: desktop,
    basis:
      `Claude Code deletes a transcript ${days ?? 30} days after it last changed (${days === null ? "the default, as `cleanupPeriodDays` is not set" : "`cleanupPeriodDays` in your settings"}), when it next starts. ` +
      "Sessions started or last continued in Claude Desktop or Cowork are kept at any age since v2.1.248. Project settings can set a different value for one project; only your user and managed settings were read.",
  };
}

/** `30d`, `2w`, `48h`: Gemini CLI's duration syntax. Months (`m`) are not read: the unit is ambiguous. */
function geminiDays(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d{1,6})\s*([hdw])\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const days = unit === "h" ? amount / 24 : unit === "w" ? amount * 7 : amount;
  return days > 0 ? days : null;
}

export async function geminiPolicy({ env = process.env, home = homedir() }: PolicyEnv = {}): Promise<RetentionPolicy> {
  const base = env.GEMINI_CLI_HOME?.trim() ? resolve(env.GEMINI_CLI_HOME.trim()) : home;
  const path = join(base, ".gemini", "settings.json");
  const file = tilde(path, home);
  const common = { harness: "gemini" as const, clock: "last-updated" as const, url: GEMINI_URL };
  const settings = await readSettings(path);
  if (settings === "unreadable") {
    return { ...common, policy: "unknown", setting: { name: "general.sessionRetention.maxAge", file, value: null }, basis: `${file} could not be read, so Gemini CLI's retention here is unknown.` };
  }
  const retention = settings && typeof settings.general === "object" && settings.general ? (settings.general as Record<string, unknown>).sessionRetention : undefined;
  const config = retention && typeof retention === "object" ? (retention as Record<string, unknown>) : {};
  if (config.enabled === false) {
    return { ...common, policy: "kept", setting: { name: "general.sessionRetention.enabled", file, value: "false" }, basis: "Session cleanup is turned off in your Gemini CLI settings, so chats are kept until you delete them." };
  }
  const raw = config.maxAge;
  const days = raw === undefined ? 30 : geminiDays(raw);
  if (days === null) {
    return { ...common, policy: "unknown", setting: { name: "general.sessionRetention.maxAge", file, value: typeof raw === "string" ? raw : null }, basis: "Gemini CLI's `maxAge` here is in a form AI Insights does not read, so how long chats are kept is unknown." };
  }
  return {
    ...common,
    policy: "deletes",
    days,
    source: raw === undefined ? "default" : "settings",
    setting: { name: "general.sessionRetention.maxAge", file, value: typeof raw === "string" ? raw : null },
    basis:
      `Gemini CLI deletes a project's chats ${days} days after their last update when it next starts in that project (${raw === undefined ? "its documented default" : "`maxAge` in your settings"}); \`maxCount\` can delete more.`,
  };
}

const KEPT: Record<"codex" | "opencode" | "pi", RetentionPolicy> = {
  codex: {
    harness: "codex",
    policy: "kept",
    url: CODEX_URL,
    basis: "Codex keeps rollouts until you delete them: its `[history]` settings trim only `history.jsonl`, the prompt history, not the sessions.",
  },
  opencode: { harness: "opencode", policy: "kept", url: OPENCODE_URL, basis: "OpenCode has no automatic session cleanup: sessions go when you delete them or remove their workspace." },
  pi: { harness: "pi", policy: "kept", url: PI_URL, basis: "Pi keeps session files until you delete them; compaction never removes the original entries." },
};

const CURSOR: RetentionPolicy = {
  harness: "cursor",
  policy: "unknown",
  basis: "Cursor does not document whether it deletes old chats on its own; it has a manual command to delete them.",
};

/** Every harness's policy on this machine, from its settings files only. Never throws. */
export async function readRetentionPolicies(options: PolicyEnv = {}): Promise<Map<Harness, RetentionPolicy>> {
  const fallback = (harness: Harness): RetentionPolicy => ({ harness, policy: "unknown", basis: "Could not read this harness's settings." });
  const [claude, gemini] = await Promise.all([
    claudePolicy(options).catch(() => fallback("claude-code")),
    geminiPolicy(options).catch(() => fallback("gemini")),
  ]);
  return new Map<Harness, RetentionPolicy>([
    ["claude-code", claude],
    ["codex", KEPT.codex],
    ["opencode", KEPT.opencode],
    ["pi", KEPT.pi],
    ["cursor", CURSOR],
    ["gemini", gemini],
  ]);
}

/** True when the transcript records a Claude Desktop or Cowork entry point in its first or last 64 KiB. */
export async function isDesktopTranscript(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
    const size = (await handle.stat()).size;
    const head = Buffer.alloc(Math.min(size, ENTRYPOINT_PROBE_BYTES));
    await handle.read(head, 0, head.length, 0);
    if (DESKTOP_ENTRYPOINT.test(head.toString("utf8"))) return true;
    if (size <= ENTRYPOINT_PROBE_BYTES) return false;
    const tail = Buffer.alloc(Math.min(size - head.length, ENTRYPOINT_PROBE_BYTES));
    await handle.read(tail, 0, tail.length, size - tail.length);
    return DESKTOP_ENTRYPOINT.test(tail.toString("utf8"));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function inDesktopStore(path: string): boolean {
  const parts = path.split(/[\\/]+/);
  return DESKTOP_STORES.some((store) => parts.includes(store));
}

export interface RetentionInput {
  now: Date;
  policies: Map<Harness, RetentionPolicy>;
  /** Every transcript on disk per harness. */
  files: Map<Harness, SessionFile[]>;
  /** The parsed session for a transcript path, where there is one. */
  sessionsByPath: Map<string, Session>;
  /** Sessions only the cache still holds, per harness. */
  cachedOnly: Map<Harness, Session[]>;
  /** Overridable for tests. */
  isDesktop?: (path: string) => Promise<boolean>;
  /** The transcript's own modification time; Claude Code's sweep looks at the main file, not its subagents. */
  mtimeOf?: (file: SessionFile) => Promise<number>;
}

function earliest(values: Array<string | null | undefined>): string | null {
  let best: number | null = null;
  for (const value of values) {
    const ms = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(ms) && (best === null || ms < best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

async function mainMtime(file: SessionFile): Promise<number> {
  if (file.path.includes("#")) return file.mtimeMs;
  return stat(file.path).then((info) => info.mtimeMs, () => file.mtimeMs);
}

/**
 * How long each harness keeps transcripts and what is about to go. Reads nothing but file metadata and, for
 * Claude Code transcripts near the deletion age, their first and last 64 KiB to tell Desktop sessions apart.
 */
export async function measureRetention(input: RetentionInput): Promise<Retention> {
  const nowMs = input.now.getTime();
  const horizon = nowMs + RETENTION_WINDOW_DAYS * DAY_MS;
  const isDesktop = input.isDesktop ?? isDesktopTranscript;
  const mtimeOf = input.mtimeOf ?? mainMtime;
  const harnesses: HarnessRetention[] = [];
  let probes = 0;
  for (const [harness, policy] of input.policies) {
    const files = input.files.get(harness) ?? [];
    const orphans = input.cachedOnly.get(harness) ?? [];
    if (files.length === 0 && orphans.length === 0) continue;
    const onDisk = files.map((file) => input.sessionsByPath.get(file.path)).filter((session): session is Session => !!session);
    const entry: HarnessRetention = {
      harness,
      policy: policy.policy,
      basis: policy.basis,
      transcripts: files.length,
      bytes: files.reduce((sum, file) => sum + (Number.isFinite(file.sizeBytes) && file.sizeBytes > 0 ? file.sizeBytes : 0), 0),
      oldestOnDisk: earliest(onDisk.map((session) => session.startTime)) ?? earliest(files.map((file) => new Date(file.mtimeMs).toISOString())),
      cachedOnly: orphans.length,
      coversFrom: earliest([...onDisk, ...orphans].map((session) => session.startTime)),
    };
    for (const key of ["days", "source", "setting", "clock", "url"] as const) if (policy[key] !== undefined) (entry as unknown as Record<string, unknown>)[key] = policy[key];

    if (policy.policy === "deletes" && policy.days !== undefined) {
      const limit = policy.days * DAY_MS;
      const atRisk: RetentionAtRisk = { sessions: 0, bytes: 0, nextDeletion: null };
      const due: Array<{ sessionId: string; eligibleAt: number }> = [];
      let exempt = 0;
      let exemptReason = "";
      for (const file of files) {
        const session = input.sessionsByPath.get(file.path);
        let changed: number;
        if (policy.clock === "last-updated") {
          const end = session ? Date.parse(session.endTime) : Number.NaN;
          changed = Number.isFinite(end) ? end : file.mtimeMs;
        } else {
          // Discovery reports the newest of a transcript and its subagents; Claude Code ages the transcript itself.
          changed = await mtimeOf(file);
        }
        let eligibleAt = changed + limit;
        if (eligibleAt > horizon) continue;
        if (harness === "claude-code") {
          if (inDesktopStore(file.path)) {
            exempt += 1;
            exemptReason = "Claude Desktop keeps its own copies of Code and Cowork sessions, outside Claude Code's cleanup";
            continue;
          }
          if (probes < MAX_PROBES) {
            probes += 1;
            if (await isDesktop(file.path)) {
              if (policy.desktopDays === null || policy.desktopDays === undefined) {
                exempt += 1;
                exemptReason ||= "Sessions started or last continued in Claude Desktop or Cowork are kept at any age (Claude Code v2.1.248 and later)";
                continue;
              }
              eligibleAt = changed + policy.desktopDays * DAY_MS;
              if (eligibleAt > horizon) continue;
            }
          }
        }
        atRisk.sessions += 1;
        atRisk.bytes += Number.isFinite(file.sizeBytes) && file.sizeBytes > 0 ? file.sizeBytes : 0;
        if (session) due.push({ sessionId: session.id, eligibleAt });
        const first = atRisk.nextDeletion === null ? Number.POSITIVE_INFINITY : Date.parse(atRisk.nextDeletion);
        if (eligibleAt < first) atRisk.nextDeletion = new Date(eligibleAt).toISOString();
      }
      entry.atRisk = atRisk;
      if (due.length) {
        entry.due = due
          .sort((a, b) => a.eligibleAt - b.eligibleAt || a.sessionId.localeCompare(b.sessionId))
          .slice(0, MAX_DUE)
          .map((item) => ({ sessionId: item.sessionId, eligibleAt: new Date(item.eligibleAt).toISOString() }));
      }
      if (exempt) entry.exempt = { sessions: exempt, reason: exemptReason };
    }
    harnesses.push(entry);
  }
  const atRisk: RetentionAtRisk = { sessions: 0, bytes: 0, nextDeletion: null };
  for (const entry of harnesses) {
    if (!entry.atRisk) continue;
    atRisk.sessions += entry.atRisk.sessions;
    atRisk.bytes += entry.atRisk.bytes;
    atRisk.nextDeletion = earliest([atRisk.nextDeletion, entry.atRisk.nextDeletion]);
  }
  return {
    windowDays: RETENTION_WINDOW_DAYS,
    harnesses,
    atRisk,
    cachedOnly: harnesses.reduce((sum, entry) => sum + entry.cachedOnly, 0),
    coversFrom: earliest(harnesses.map((entry) => entry.coversFrom)),
    cache: { keeps: [...CACHE_KEEPS], drops: [...CACHE_DROPS] },
  };
}
