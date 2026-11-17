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
  ai-insights doctor             show which histories were found and where
  ai-insights mcp                start the MCP server on stdio (for your agent)
  ai-insights import claude <path>  add a Claude chat export (see import --help)
  ai-insights install            add the plugin to your agents (see install --help)
  ai-insights uninstall          remove it again
  ai-insights nudge              print a line when a monthly review is due (--off, --on)

Options
  --since <window>     only history from ${SINCE_HELP}
  --harness <name>     only one of: ${HARNESSES.join(", ")}
  --max-sessions <n>   read at most n transcripts, newest first
  --refresh            re-parse every transcript, ignoring the cache
  --json               report: print the report as JSON instead of writing HTML
  --open               open the written report in your browser without asking
  --no-open            do not ask to open it, and do not open it
  --no-install-prompt  do not offer to add AI Insights to your agents
                       (or set AI_INSIGHTS_NO_INSTALL_PROMPT=1)
  -h, --help           show this help
  -v, --version        show the version

Cache and reports live in ~/.ai-insights (set AI_INSIGHTS_HOME to move them;
an existing ~/.hindsight from before 0.2 keeps being used).
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
}

const COMMANDS = new Set(["run", "scan", "report", "doctor", "mcp", "help"]);
const VALUE_FLAGS = new Set(["--since", "--harness", "--max-sessions"]);

export function parseArgs(argv: string[], now: Date): Parsed {
  const parsed: Parsed = { command: "run", refresh: false, json: false, open: null, noInstallPrompt: false, help: false, version: false };
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
  }
  return parsed;
}

