import { resolveHome } from "../store/home.js";
import { NUDGE_TEXT, readNudgeState, takeNudge, writeNudgeState } from "./nudge.js";

// `ai-insights nudge`, and the entry the plugin's session-start hook runs (harness/ai-insights/hooks/nudge.mjs is
// generated from this file and nudge.ts). Always exits 0 and prints at most one line, so a hook can never break
// or clutter a session.

export interface NudgeDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  now: () => Date;
}

/**
 * How the line is printed. "text" (default): the line on stdout. "hook": hook JSON with the line as
 * `systemMessage`, which Claude Code and Codex show to the person without adding it to the model's context;
 * plain SessionStart stdout would be added to the context of every session it appears in.
 */
export type NudgeFormat = "text" | "hook";

export function formatNudge(line: string, format: NudgeFormat): string {
  return format === "hook" ? `${JSON.stringify({ systemMessage: line })}\n` : `${line}\n`;
}

export async function runNudge(argv: string[], deps: NudgeDeps): Promise<number> {
  try {
    const home = resolveHome(deps.env);
    let format: NudgeFormat = "text";
    let toggle: "off" | "on" | null = null;
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]!;
      if (arg === "--off") toggle = "off";
      else if (arg === "--on") toggle = "on";
      else if (arg === "--format" || arg.startsWith("--format=")) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
        if (value === "hook" || value === "text") format = value;
      }
    }
    if (toggle) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(home, { recursive: true, mode: 0o700 }).catch(() => undefined);
      const state = await readNudgeState(home);
      const saved = await writeNudgeState(home, { ...state, off: toggle === "off" });
      deps.stdout(
        saved
          ? toggle === "off"
            ? "AI Insights will not remind you about monthly reviews. Turn it back on: ai-insights nudge --on\n"
            : "AI Insights will remind you once a month, at the start of a session, when a review is due.\n"
          : `Could not save the setting in ${home}.\n`,
      );
      return 0;
    }
    const line = await takeNudge(home, deps.now());
    if (line) deps.stdout(formatNudge(line, format));
  } catch {
    // A reminder is never worth an error in someone's session.
  }
  return 0;
}

export { NUDGE_TEXT };
