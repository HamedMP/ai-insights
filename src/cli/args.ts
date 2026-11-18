import { HARNESSES, type Harness } from "../schema/types.js";
import { parseSince, SINCE_HELP } from "../store/since.js";

// Argument parsing and help: nothing heavy, so the CLI can answer and draw its header before loading anything else.

export class UsageError extends Error {}

export const HELP = `ai-insights: look back at how you work with AI coding agents.

Reads your local agent history (Claude Code, Codex, OpenCode, Pi, Cursor, Gemini CLI) and any chat
export you imported, writes one HTML report.
Nothing leaves this machine.

Usage
  ai-insights [options]          scan, write the report, print a summary
  ai-insights scan [options]     scan and show what was found
  ai-insights report [options]   write the report (or print JSON with --json)
  ai-insights today|week|month   a quick look: sessions, time, tokens, cost and one tip
  ai-insights summary            today, this week and this month side by side
  ai-insights doctor             show which histories were found and where
  ai-insights share [options]    print your stats share link, to open and publish from any device
  ai-insights serve [--port <n>] show the last report to your computer through an SSH tunnel
  ai-insights mcp                start the MCP server on stdio (for your agent)
  ai-insights import claude <path>  add a Claude chat export (see import --help)
  ai-insights import openai <path>  add a ChatGPT data export (see import --help)
  ai-insights install            add the plugin to your agents (see install --help)
  ai-insights uninstall          remove it again
  ai-insights nudge              print a line when a monthly review is due (--off, --on)

Options
  --since <window>     only history from ${SINCE_HELP}
  --harness <name>     only one of: ${HARNESSES.join(", ")}
  --max-sessions <n>   read at most n transcripts, newest first
  --refresh            re-parse every transcript, ignoring the cache
  --json               report: print the report as JSON instead of writing HTML;
                       today|week|month|summary: print the numbers as JSON (docs/summary-json.md)
  --until <date>       today|week|month: up to and including this day (YYYY-MM-DD)
  --last <n>           today|week|month: the last n days, weeks or months, one row each
  --by <what>          today|week|month: break it down by project, model or agent
  --no-cost            today|week|month|summary: leave the cost out
  --open               open the written report in your browser without asking
  --no-open            do not ask to open it, and do not open it
  --no-install-prompt  do not offer to add AI Insights to your agents
                       (or set AI_INSIGHTS_NO_INSTALL_PROMPT=1)
  --name <name>        share: the display name on your card (default: none)
  --device <name>      share: a name for this computer (default: none)
  --no-days            share: leave out which days you were active
  --copy               share: also ask the terminal to copy the link (OSC 52)
  --port <n>           serve: listen on this port on 127.0.0.1 (default: a free one)
  -h, --help           show this help
  -v, --version        show the version

Cache and reports live in ~/.ai-insights (set AI_INSIGHTS_HOME to move them;
a ~/.hindsight from before 0.2 is moved there once, and the old path still works).
For the qualitative analysis, run the analyze-ai-usage skill in your agent.
`;

export interface Parsed {
  command: string;
  since?: Date;
  /** The --since value as typed, to repeat it back when it filtered everything out. */
  sinceText?: string;
  harness?: Harness;
  maxSessions?: number;
  refresh: boolean;
  json: boolean;
  /** --open or --no-open, the last one given winning; null when neither was. */
  open: "open" | "no-open" | null;
  /** --no-install-prompt: skip the offer to install into agents after the run. */
  noInstallPrompt: boolean;
  help: boolean;
  version: boolean;
  /** share: --name, --device, --no-days and --copy. */
  shareName: string;
  deviceName: string;
  days: boolean;
  copy: boolean;
  /** serve: --port, 0 for any free port. */
  port: number;
  /** Quick views: --until as typed (YYYY-MM-DD), --last, --by and --no-cost. */
  until?: string;
  last?: number;
  by?: "project" | "model" | "agent";
  noCost: boolean;
}

/** The quick views; they read the same history as a run but write no report. */
export const QUICK_COMMANDS = new Set(["today", "week", "month", "summary"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_LAST = 366;

const COMMANDS = new Set(["run", "scan", "report", "doctor", "mcp", "share", "serve", "help", ...QUICK_COMMANDS]);
const VALUE_FLAGS = new Set(["--since", "--harness", "--max-sessions", "--name", "--device", "--port", "--until", "--last", "--by"]);
/** Flags that mean something to one command only: anywhere else they are a mistake worth saying. */
const ONLY_FOR: Record<string, string> = { "--name": "share", "--device": "share", "--no-days": "share", "--copy": "share", "--port": "serve" };
/** Flags for the quick views only. */
const QUICK_ONLY = new Set(["--until", "--last", "--by", "--no-cost"]);

export function parseArgs(argv: string[], now: Date): Parsed {
  const parsed: Parsed = { command: "run", refresh: false, json: false, open: null, noInstallPrompt: false, help: false, version: false, shareName: "", deviceName: "", days: true, copy: false, port: 0, noCost: false };
  const quickFlags: string[] = [];
  const used: string[] = [];
  let commandSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("-")) {
      if (commandSeen || !COMMANDS.has(raw)) throw new UsageError(`unknown command "${raw}"`);
      parsed.command = raw === "help" ? "run" : raw;
      parsed.help ||= raw === "help";
      commandSeen = true;
      continue;
    }
    const eq = raw.indexOf("=");
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    let value: string | undefined = eq > 0 ? raw.slice(eq + 1) : undefined;
    if (VALUE_FLAGS.has(flag) && value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      index += 1;
    } else if (!VALUE_FLAGS.has(flag) && value !== undefined) {
      throw new UsageError(`${flag} does not take a value`);
    }
    switch (flag) {
      case "--since": {
        const since = parseSince(value!, now);
        if (!since) throw new UsageError(`--since must be ${SINCE_HELP}`);
        parsed.since = since;
        parsed.sinceText = value!;
        break;
      }
      case "--harness":
        if (!(HARNESSES as readonly string[]).includes(value!)) throw new UsageError(`--harness must be one of: ${HARNESSES.join(", ")}`);
        parsed.harness = value as Harness;
        break;
      case "--max-sessions": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) throw new UsageError("--max-sessions must be a positive whole number");
        parsed.maxSessions = count;
        break;
      }
      case "--refresh":
        parsed.refresh = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--open":
        parsed.open = "open";
        break;
      case "--no-open":
        parsed.open = "no-open";
        break;
      case "--no-install-prompt":
        parsed.noInstallPrompt = true;
        break;
      case "--name":
        parsed.shareName = value!;
        break;
      case "--device":
        parsed.deviceName = value!;
        break;
      case "--no-days":
        parsed.days = false;
        break;
      case "--copy":
        parsed.copy = true;
        break;
      case "--port": {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError("--port must be a whole number from 1024 to 65535");
        parsed.port = port;
        break;
      }
      case "--until":
        if (!DAY.test(value!) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) throw new UsageError("--until must be a day like 2026-11-30");
        parsed.until = value!;
        break;
      case "--last": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1 || count > MAX_LAST) throw new UsageError(`--last must be a whole number from 1 to ${MAX_LAST}`);
        parsed.last = count;
        break;
      }
      case "--by":
        if (value !== "project" && value !== "model" && value !== "agent") throw new UsageError("--by must be project, model or agent");
        parsed.by = value;
        break;
      case "--no-cost":
        parsed.noCost = true;
        break;
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      default:
        throw new UsageError(`unknown option "${flag}"`);
    }
    if (ONLY_FOR[flag]) used.push(flag);
    if (QUICK_ONLY.has(flag)) quickFlags.push(flag);
  }
  for (const flag of quickFlags) {
    if (!QUICK_COMMANDS.has(parsed.command)) throw new UsageError(`${flag} only works with \`ai-insights today\`, \`week\`, \`month\` or \`summary\``);
    if (parsed.command === "summary" && flag !== "--no-cost") throw new UsageError(`${flag} does not work with \`ai-insights summary\``);
  }
  if (QUICK_COMMANDS.has(parsed.command) && parsed.sinceText && !DAY.test(parsed.sinceText.trim())) throw new UsageError("--since must be a day like 2026-11-01 here");
  if (parsed.command === "summary" && parsed.sinceText) throw new UsageError("--since does not work with `ai-insights summary`");
  if (parsed.last !== undefined && (parsed.sinceText || parsed.until)) throw new UsageError("use --last or --since/--until, not both");
  if (parsed.sinceText && parsed.until && parsed.until < parsed.sinceText.trim()) throw new UsageError("--until is before --since");
  for (const flag of used) if (ONLY_FOR[flag] !== parsed.command) throw new UsageError(`${flag} only works with \`ai-insights ${ONLY_FOR[flag]}\``);
  return parsed;
}

