import { resolveHome } from "../store/home.js";
import { CADENCES, type Cadence } from "./digest.js";
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
    let cadence: Cadence | null = null;
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]!;
      if (arg === "--off") toggle = "off";
      else if (arg === "--on") toggle = "on";
      else if (arg === "--cadence" || arg.startsWith("--cadence=")) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
        cadence = CADENCES.find((candidate) => candidate === value) ?? null;
        if (!cadence) {
          deps.stderr("ai-insights: --cadence must be daily, weekly or monthly\n");
          return 0;
        }
      } else if (arg === "--format" || arg.startsWith("--format=")) {
        const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
        if (value === "hook" || value === "text") format = value;
      }
    }
    if (toggle || cadence) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(home, { recursive: true, mode: 0o700 }).catch(() => undefined);
      const state = await readNudgeState(home);
      const next = { ...state, ...(toggle ? { off: toggle === "off" } : {}), ...(cadence ? { cadence, shown: null } : {}) };
      const saved = await writeNudgeState(home, next);
      deps.stdout(saved ? `${settingText(next.off, next.cadence ?? "monthly")}\n` : `Could not save the setting in ${home}.\n`);
      return 0;
    }
    const line = await takeNudge(home, deps.now());
    if (line) deps.stdout(formatNudge(line, format));
  } catch {
    // A reminder is never worth an error in someone's session.
  }
  return 0;
}

/** What the setting now does, in one line. */
export function settingText(off: boolean, cadence: Cadence): string {
  if (off) return "AI Insights will not remind you at the start of a session. Turn it back on: npx ai-insights@latest nudge --on";
  if (cadence === "monthly") return "AI Insights will remind you once a month, at the start of a session, when a review is due.";
  const period = cadence === "daily" ? "day" : "week";
  return `AI Insights will show one line at the first session of each ${period}: sessions, active time, context resets and one tip, from your last run. Change it: npx ai-insights@latest nudge --cadence monthly`;
}

export { NUDGE_TEXT };
