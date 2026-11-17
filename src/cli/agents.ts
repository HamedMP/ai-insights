import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Which agents are on this machine and whether the AI Insights plugin is already in them. Reads a few small
// files the agents keep about their own plugins; runs nothing and touches no network, so the end of a normal
// run can ask this without slowing down.

export const PLUGIN_ID = "ai-insights@ai-insights";
export const MARKETPLACE_NAME = "ai-insights";
export const MARKETPLACE_SOURCE = "hamedmp/ai-insights";
/** The plugin's name before 0.2, still installed on some machines. */
export const LEGACY_PLUGIN_ID = "hindsight@hindsight";

export type AgentId = "claude-code" | "codex" | "cursor" | "opencode" | "pi";
export const AGENT_IDS: readonly AgentId[] = ["claude-code", "codex", "cursor", "opencode", "pi"];

export const AGENT_LABELS: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
};

/** Claude Code and Codex install plugins from their own command line; the rest get printed steps. */
export const CLI_INSTALLABLE: ReadonlySet<AgentId> = new Set(["claude-code", "codex"]);

export interface AgentStatus {
  id: AgentId;
  label: string;
  /** The agent's command was found on PATH, or (Cursor) its home folder exists. */
  present: boolean;
  /** Absolute path of the agent's command, when found. */
  command: string | null;
  /** "unknown" when the agent keeps no file this can read (Cursor, OpenCode, Pi). */
  plugin: "installed" | "missing" | "unknown";
  /** The marketplace is already added, so install only needs the plugin step. */
  marketplace: boolean;
  /** The pre-0.2 hindsight plugin is still installed alongside. */
  legacy: boolean;
}

export interface DetectContext {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** The person's home folder. */
  home?: string;
  /** Reads a small text file; null when it is missing or unreadable. */
  readText?: (path: string) => Promise<string | null>;
  isFile?: (path: string) => Promise<boolean>;
  isDir?: (path: string) => Promise<boolean>;
}

const MAX_CONFIG_BYTES = 2_000_000;

async function readSmall(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function kind(path: string, want: "file" | "dir"): Promise<boolean> {
  try {
    const info = await stat(path);
    return want === "file" ? info.isFile() : info.isDirectory();
  } catch {
    return false;
  }
}

export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured ? resolve(configured) : join(home, ".claude");
}

export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env.CODEX_HOME?.trim();
  return configured ? resolve(configured) : join(home, ".codex");
}

/** The first `name` on PATH, the way a shell would find it. Windows also tries the PATHEXT endings. */
export async function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, isFile: (path: string) => Promise<boolean>): Promise<string | null> {
  const path = env.PATH ?? env.Path ?? "";
  const separator = platform === "win32" ? ";" : ":";
  const endings = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean).map((ending) => ending.toLowerCase()) : [""];
  for (const dir of path.split(separator).slice(0, 200)) {
    if (!dir) continue;
    for (const ending of endings) {
      const candidate = join(dir, `${name}${ending}`);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

function jsonKeys(text: string | null, pick: (value: Record<string, unknown>) => unknown): Set<string> {
  if (!text) return new Set();
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object") return new Set();
    const inner = pick(value as Record<string, unknown>);
    return inner && typeof inner === "object" && !Array.isArray(inner) ? new Set(Object.keys(inner)) : new Set();
  } catch {
    return new Set();
  }
}

/** A TOML table header such as `[plugins."ai-insights@ai-insights"]`, quoted or bare. */
function hasTable(toml: string | null, table: string, key: string): boolean {
  if (!toml) return false;
  return toml.split(/\r?\n/).some((line) => {
    const match = /^\s*\[\s*([A-Za-z_]+)\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/.exec(line);
    return match !== null && match[1] === table && (match[2] ?? match[3] ?? match[4]) === key;
  });
}

export async function detectAgents(context: DetectContext): Promise<AgentStatus[]> {
  const home = context.home ?? homedir();
  const readText = context.readText ?? readSmall;
  const isFile = context.isFile ?? ((path: string) => kind(path, "file"));
  const isDir = context.isDir ?? ((path: string) => kind(path, "dir"));
  const on = (name: string) => findOnPath(name, context.env, context.platform, isFile);

  const claudeDir = claudeConfigDir(context.env, home);
  const [claude, claudeInstalled, claudeMarkets] = await Promise.all([
    on("claude"),
    readText(join(claudeDir, "plugins", "installed_plugins.json")),
    readText(join(claudeDir, "plugins", "known_marketplaces.json")),
  ]);
  const claudePlugins = jsonKeys(claudeInstalled, (value) => value.plugins);
  const claudeMarketplaces = jsonKeys(claudeMarkets, (value) => value);

  const [codex, codexConfig] = await Promise.all([on("codex"), readText(join(codexHome(context.env, home), "config.toml"))]);

  const cursorDir = context.env.CURSOR_CONFIG_DIR?.trim() ? resolve(context.env.CURSOR_CONFIG_DIR.trim()) : join(home, ".cursor");
  const [cursor, cursorAgent, cursorHome, opencode, pi] = await Promise.all([on("cursor"), on("cursor-agent"), isDir(cursorDir), on("opencode"), on("pi")]);

  const status = (id: AgentId, fields: Omit<AgentStatus, "id" | "label">): AgentStatus => ({ id, label: AGENT_LABELS[id], ...fields });
  return [
    status("claude-code", {
      present: claude !== null,
      command: claude,
      plugin: claudePlugins.has(PLUGIN_ID) ? "installed" : "missing",
      marketplace: claudeMarketplaces.has(MARKETPLACE_NAME),
      legacy: claudePlugins.has(LEGACY_PLUGIN_ID),
    }),
    status("codex", {
      present: codex !== null,
      command: codex,
      plugin: hasTable(codexConfig, "plugins", PLUGIN_ID) ? "installed" : "missing",
      marketplace: hasTable(codexConfig, "marketplaces", MARKETPLACE_NAME),
      legacy: false,
    }),
    status("cursor", { present: cursor !== null || cursorAgent !== null || cursorHome, command: cursor ?? cursorAgent, plugin: "unknown", marketplace: false, legacy: false }),
    status("opencode", { present: opencode !== null, command: opencode, plugin: "unknown", marketplace: false, legacy: false }),
    status("pi", { present: pi !== null, command: pi, plugin: "unknown", marketplace: false, legacy: false }),
  ];
}

/** Agents on this machine that `ai-insights install` can set up by itself and that do not have the plugin yet. */
export function missingPlugin(agents: AgentStatus[]): AgentStatus[] {
  return agents.filter((agent) => agent.present && CLI_INSTALLABLE.has(agent.id) && agent.plugin === "missing");
}
