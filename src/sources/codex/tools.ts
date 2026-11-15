import type { ToolCategory, ToolErrorCategory } from "../../schema/types.js";

/** `["/bin/bash", "-lc", "git status"]` reads better as the script the shell ran. */
export function commandText(command: unknown): string {
  if (typeof command === "string") return command;
  if (!Array.isArray(command)) return "";
  const parts = command.filter((part): part is string => typeof part === "string");
  const flag = parts.findIndex((part) => /^-\w*c$/.test(part));
  if (flag >= 1 && flag === parts.length - 2 && /(^|\/)(ba|z|da|k|fi)?sh$/.test(parts[0] ?? "")) return parts[flag + 1] ?? "";
  return parts.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

const GIT_PREFIX = String.raw`\bgit(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+`;
const GIT_COMMIT = new RegExp(`${GIT_PREFIX}commit\\b(?![\\w-])`, "g");
const GIT_PUSH = new RegExp(`${GIT_PREFIX}push\\b(?![\\w-])`, "g");

export function gitOperations(script: string): { commits: number; pushes: number } {
  if (/--dry-run\b/.test(script)) return { commits: 0, pushes: 0 };
  return { commits: (script.match(GIT_COMMIT) ?? []).length, pushes: (script.match(GIT_PUSH) ?? []).length };
}

/** Codex skills are folders with a SKILL.md; the agent loads one by reading that file. */
export function skillFromCommand(script: string): string | null {
  const match = /(?:^|[\s"'/])skills\/(?:[^/\s"']+\/)*?([^/\s"']+)\/SKILL\.md\b/.exec(script);
  return match?.[1] ?? null;
}

/** Codex parses shell commands into read/search/list_files actions; a pure read is a file read. */
export function categoryForParsed(parsed: unknown): { category: ToolCategory; path?: string } {
  if (!Array.isArray(parsed) || parsed.length === 0) return { category: "shell" };
  const kinds = new Set<string>();
  let path: string | undefined;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return { category: "shell" };
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "unknown";
    kinds.add(type);
    if (!path && typeof record.path === "string" && type === "read") path = record.path;
  }
  if ([...kinds].every((kind) => kind === "read")) return path ? { category: "read", path } : { category: "read" };
  if ([...kinds].every((kind) => kind === "read" || kind === "search" || kind === "list_files")) return { category: "search" };
  return { category: "shell" };
}

/** Error category for a shell command from its exit code and the start of its output. */
export function shellError(exitCode: unknown, output: string, status?: unknown): ToolErrorCategory | undefined {
  if (status === "declined" || status === "rejected" || status === "denied") return "user_rejected";
  const code = typeof exitCode === "number" ? exitCode : null;
  const failed = status === "failed" || (code !== null && code !== 0);
  if (!failed) return undefined;
  const head = output.slice(0, 4000);
  if (code === 124 || /\btimed out\b|\btimeout\b/i.test(head)) return "timeout";
  if (code === 126 || /permission denied|operation not permitted|EACCES|EPERM\b/i.test(head)) return "permission_denied";
  if (/sandbox|rejected by user|declined/i.test(head) && code === null) return "user_rejected";
  if (/no such file or directory|ENOENT|cannot access|not found: \//i.test(head) && code !== 127) return "file_not_found";
  return "command_failed";
}

/** Exit code from a Codex function_call_output body, which is JSON in some versions and text in others. */
export function exitCodeFromOutput(output: unknown): { exitCode: number | null; text: string } {
  let text = "";
  if (typeof output === "string") text = output;
  else if (Array.isArray(output)) {
    text = output
      .map((part) => (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? String((part as Record<string, unknown>).text) : ""))
      .join("\n");
  } else if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.content === "string") text = record.content;
    else text = JSON.stringify(record).slice(0, 4000);
  }
  if (text.startsWith("{")) {
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      const metadata = value.metadata && typeof value.metadata === "object" ? (value.metadata as Record<string, unknown>) : {};
      const inner = typeof value.output === "string" ? value.output : text;
      if (typeof metadata.exit_code === "number") return { exitCode: metadata.exit_code, text: inner };
      return { exitCode: null, text: inner };
    } catch {
      // Not JSON after all; fall through to the text forms.
    }
  }
  const match = /(?:^|\n)(?:Exit code|Process exited with code|exit_code)[: ]+(-?\d+)/i.exec(text.slice(0, 2000));
  return { exitCode: match ? Number(match[1]) : null, text };
}

export interface FileStats {
  path: string;
  added: number;
  removed: number;
}

export interface PatchStats {
  files: string[];
  added: number;
  removed: number;
  perFile: FileStats[];
}

/** Lines and files from an `apply_patch` body (`*** Begin Patch` … `*** End Patch`). */
export function parseApplyPatch(patch: string): PatchStats {
  const perFile: FileStats[] = [];
  let current: FileStats | null = null;
  let mode: "add" | "update" | "delete" | null = null;
  for (const line of patch.split("\n")) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      mode = header[1] === "Add" ? "add" : header[1] === "Update" ? "update" : "delete";
      current = { path: header[2]!.trim(), added: 0, removed: 0 };
      perFile.push(current);
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && current) {
      current.path = move[1]!.trim();
      continue;
    }
    if (line.startsWith("***") || mode === null || mode === "delete" || !current) continue;
    if (line.startsWith("+")) current.added += 1;
    else if (line.startsWith("-") && mode === "update") current.removed += 1;
  }
  return {
    files: perFile.map((file) => file.path),
    added: perFile.reduce((sum, file) => sum + file.added, 0),
    removed: perFile.reduce((sum, file) => sum + file.removed, 0),
    perFile,
  };
}

/** Lines added and removed in a unified diff hunk set, ignoring file headers. */
export function diffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function lineCount(text: string): number {
  if (!text) return 0;
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

/** `mcp__server__tool`, or a `server__tool` name whose server Codex reported separately. */
export function mcpServerFromName(name: string, namespace?: unknown): string | null {
  if (typeof namespace === "string" && namespace.startsWith("mcp__")) return namespace.slice(5).replace(/__$/, "") || null;
  const match = /^mcp__(.+?)__/.exec(name);
  return match?.[1] ?? null;
}

const SHELL_TOOLS = new Set(["shell", "container.exec", "local_shell", "exec_command", "shell_command", "unified_exec", "write_stdin"]);

/** Category for a Codex function or custom tool by name. */
export function categoryForName(name: string, namespace?: unknown): ToolCategory {
  if (mcpServerFromName(name, namespace)) return "mcp";
  if (SHELL_TOOLS.has(name)) return "shell";
  if (name === "apply_patch") return "edit";
  if (name === "update_plan") return "plan";
  if (name === "view_image") return "read";
  if (name === "web_search" || name === "web_search_call" || name.startsWith("web.") || name.startsWith("web__")) return "web";
  if (/^request_user_input/.test(name)) return "ask_user";
  if (namespace === "collaboration" || /^(spawn_agent|send_input|send_message|wait_agent|close_agent|followup_task|list_agents)$/.test(name)) return "subagent";
  return "other";
}
