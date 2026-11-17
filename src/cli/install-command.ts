import { homedir } from "node:os";
import { packageVersion } from "../mcp/version.js";
import { AGENT_IDS, AGENT_LABELS, PLUGIN_ID, detectAgents, missingPlugin, type AgentId, type AgentStatus, type DetectContext } from "./agents.js";
import { describePlan, executePlans, installPlan, uninstallPlan, type StepOutcome } from "./install.js";
import { declineStillHolds, mayOffer, readOfferState, recordDecline } from "./install-offer.js";
import type { Answer } from "./open.js";
import { spawnCommand, type Spawner } from "./spawn.js";

// `ai-insights install` / `uninstall`, and the one-question offer at the end of a normal run.

export const INSTALL_HELP = `ai-insights install: add AI Insights to your agents.

Usage
  ai-insights install [--harness <name>]... [--yes] [--dry-run]
  ai-insights uninstall [--harness <name>]... [--yes] [--dry-run]

Adds the ai-insights plugin to Claude Code and Codex through their own plugin commands
(it holds the ai-insights MCP server; the analyze-ai-usage, ai-insights-coach and
ai-insights-setup skills; and a session-start reminder when a monthly review is due,
which Codex runs only after you approve it in /hooks).
Cursor, OpenCode and Pi get the steps printed. The commands are shown before anything runs.

Options
  --harness <name>   only this agent; repeatable. One of: ${AGENT_IDS.join(", ")}
  -y, --yes          run without asking
  --dry-run          print what would run, change nothing
  -h, --help         show this help

Claude Code and Codex download the plugin from GitHub when you install it; AI Insights itself sends nothing.
`;

export interface InstallDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** Store folder (~/.ai-insights). */
  home: string;
  now: () => Date;
  stdoutTTY: boolean;
  stdinTTY: boolean;
  prompt: (question: string) => Promise<Answer>;
  spawner?: Spawner;
  detect?: (context: DetectContext) => Promise<AgentStatus[]>;
  /** The person's home folder, for finding agent config. */
  userHome?: string;
}

interface InstallArgs {
  harnesses: AgentId[];
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

class InstallUsageError extends Error {}

function parseInstallArgs(argv: string[]): InstallArgs {
  const args: InstallArgs = { harnesses: [], yes: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    const [flag, inline] = raw.startsWith("--") && raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
    switch (flag) {
      case "--harness": {
        const value = inline ?? argv[++index];
        if (!value || !(AGENT_IDS as readonly string[]).includes(value)) throw new InstallUsageError(`--harness must be one of: ${AGENT_IDS.join(", ")}`);
        if (!args.harnesses.includes(value as AgentId)) args.harnesses.push(value as AgentId);
        break;
      }
      case "-y":
      case "--yes":
        args.yes = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new InstallUsageError(`unknown option "${raw}"`);
    }
  }
  return args;
}

function detectWith(deps: InstallDeps): Promise<AgentStatus[]> {
  const context: DetectContext = { env: deps.env, platform: deps.platform, home: deps.userHome ?? homedir() };
  return (deps.detect ?? detectAgents)(context);
}

const AFTER_INSTALL = "Start a new session in your agent, then run /analyze-ai-usage (or ask it to analyze your AI usage).";
/** Codex skips a plugin's hooks until the person trusts them, and this has not been seen running in the Codex CLI. */
export const CODEX_HOOK_NOTE =
  "Codex: the monthly reminder runs only after you approve the ai-insights hook in /hooks. It is untested in the Codex CLI.";

/** What to say after the commands ran: how to start, and the Codex hook caveat when Codex was set up. */
function afterInstall(outcomes: StepOutcome[]): string[] {
  if (!outcomes.some((outcome) => outcome.ok)) return [];
  const codex = outcomes.some((outcome) => outcome.ok && outcome.step.agent === "codex" && outcome.step.args.includes(PLUGIN_ID));
  return [AFTER_INSTALL, ...(codex ? [CODEX_HOOK_NOTE] : [])];
}
const NETWORK_NOTE = "Claude Code and Codex download the plugin from GitHub; AI Insights itself sends nothing.";

/** `ai-insights install` and `ai-insights uninstall`. Returns the exit code. */
export async function runInstall(verb: "install" | "uninstall", argv: string[], deps: InstallDeps): Promise<number> {
  let args: InstallArgs;
  try {
    args = parseInstallArgs(argv);
  } catch (error) {
    if (!(error instanceof InstallUsageError)) throw error;
    deps.stderr(`ai-insights ${verb}: ${error.message}\nRun \`ai-insights install --help\` for usage.\n`);
    return 2;
  }
  if (args.help) {
    deps.stdout(INSTALL_HELP);
    return 0;
  }
  const agents = await detectWith(deps);
  const plans = verb === "install" ? installPlan(agents, args.harnesses) : uninstallPlan(agents, args.harnesses);
  if (plans.length === 0) {
    deps.stdout(`No supported agent found on this machine (looked for ${AGENT_IDS.map((id) => AGENT_LABELS[id]).join(", ")}).\n`);
    return 1;
  }
  deps.stdout(`${describePlan(plans, verb).join("\n")}\n`);
  const runnable = plans.filter((plan) => plan.action === "run");
  const absentAsked = plans.some((plan) => plan.action === "absent" && args.harnesses.includes(plan.agent.id));
  if (runnable.length === 0) return absentAsked ? 1 : 0;
  if (args.dryRun) {
    deps.stdout("Dry run: nothing was changed.\n");
    return 0;
  }
  if (!args.yes) {
    if (!deps.stdoutTTY || !deps.stdinTTY) {
      deps.stdout("Run it again with --yes to run these commands.\n");
      return 1;
    }
    const question = "Run these commands? [Y/n]";
    deps.stdout(`${question} `);
    const answer = await deps.prompt(question);
    deps.stdout(answer === "yes" ? "yes\n" : "no\n");
    if (answer === "cancel") return 130;
    if (answer === "no") return 0;
  }
  if (verb === "install") deps.stdout(`${NETWORK_NOTE}\n`);
  const outcomes = await executePlans(runnable, deps.spawner ?? spawnCommand, deps.env, (line) => deps.stdout(`${line}\n`));
  const failed = outcomes.some((outcome) => !outcome.ok);
  if (verb === "install") for (const line of afterInstall(outcomes)) deps.stdout(`${line}\n`);
  if (verb === "uninstall" && !failed) deps.stdout("Your report and cache in the AI Insights folder were left as they are.\n");
  return failed || absentAsked ? 1 : 0;
}

interface CliLike {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  now: () => Date;
  terminal?: { isTTY: boolean; stdin?: boolean };
  prompt: (question: string) => Promise<Answer>;
  spawner?: Spawner;
  detectAgents?: (context: DetectContext) => Promise<AgentStatus[]>;
  userHome?: string;
}

/** The install dependencies out of the CLI's own (see CliDeps in main.ts). */
export function installDeps(deps: CliLike, home: string): InstallDeps {
  return {
    stdout: deps.stdout,
    stderr: deps.stderr,
    env: deps.env,
    platform: deps.platform,
    home,
    now: deps.now,
    stdoutTTY: deps.terminal?.isTTY === true,
    stdinTTY: deps.terminal?.stdin === true,
    prompt: deps.prompt,
    ...(deps.spawner ? { spawner: deps.spawner } : {}),
    ...(deps.detectAgents ? { detect: deps.detectAgents } : {}),
    ...(deps.userHome ? { userHome: deps.userHome } : {}),
  };
}

// -- the offer at the end of a run ---------------------------------------------------

function listText(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The offer, in full. Every clause is something the plugin does; see the privacy docs for the network part. */
export function offerText(agents: AgentStatus[], store = "~/.ai-insights"): string[] {
  const names = listText(agents.map((agent) => agent.label));
  return [
    `Add AI Insights to ${names}? It installs the ai-insights plugin:`,
    "the MCP server, three skills (analyze-ai-usage, ai-insights-coach,",
    "ai-insights-setup) and a once-a-month reminder when a review is due.",
    ...(agents.some((agent) => agent.id === "codex") ? ["Codex runs the reminder only after you approve it in /hooks."] : []),
    `Each review saves your sessions' stats and prompts in ${store},`,
    "so they outlast agents that delete old transcripts.",
  ];
}

export const OFFER_QUESTION = "Install it now? [Y/n]";

export interface OfferDeps extends InstallDeps {
  /** --no-install-prompt */
  disabled: boolean;
  /** Indent for the rich screen. */
  indent: string;
}

/**
 * After the result screen: one question, only on an interactive terminal, only when an agent that can be set
 * up from here lacks the plugin, and not again for a while after a no. Returns an exit code only for Ctrl-C.
 */
export async function offerInstall(deps: OfferDeps): Promise<number | null> {
  if (!mayOffer({ env: deps.env, stdoutTTY: deps.stdoutTTY, stdinTTY: deps.stdinTTY, disabled: deps.disabled })) return null;
  const version = packageVersion();
  if (declineStillHolds(await readOfferState(deps.home), deps.now(), version)) return null;
  let agents: AgentStatus[];
  try {
    agents = missingPlugin(await detectWith(deps));
  } catch {
    return null;
  }
  if (agents.length === 0) return null;
  const { indent } = deps;
  const user = deps.userHome ?? homedir();
  const store = deps.home === user ? deps.home : deps.home.startsWith(`${user}/`) || deps.home.startsWith(`${user}\\`) ? `~${deps.home.slice(user.length)}` : deps.home;
  deps.stdout(`\n${offerText(agents, store).map((line) => `${indent}${line}`).join("\n")}\n${indent}${OFFER_QUESTION} `);
  const answer = await deps.prompt(OFFER_QUESTION);
  if (answer === "cancel") {
    deps.stdout("\n");
    return 130;
  }
  deps.stdout(answer === "yes" ? "yes\n" : "no\n");
  if (answer === "no") {
    await recordDecline(deps.home, deps.now(), version).catch(() => undefined);
    deps.stdout(`${indent}Not asking again for 30 days. Any time: npx ai-insights install\n`);
    return null;
  }
  const plans = installPlan(agents, agents.map((agent) => agent.id));
  deps.stdout(`${indent}${NETWORK_NOTE}\n`);
  const outcomes = await executePlans(plans, deps.spawner ?? spawnCommand, deps.env, (line) => deps.stdout(`${indent}${line}\n`));
  for (const line of afterInstall(outcomes)) deps.stdout(`${indent}${line}\n`);
  return null;
}
