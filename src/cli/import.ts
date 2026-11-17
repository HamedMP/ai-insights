import { importClaudeExport, readManifest, removeClaudeImport, type ImportManifest, type ImportOutcome } from "../sources/claude-chat/importer.js";

/**
 * `ai-insights import`: bring a chat product's data export into AI Insights. Kept in its own module so the main
 * CLI only routes to it. Chat exports are never looked for on their own (they sit in a downloads folder or
 * wherever the person saved them), so this command with an explicit path is the only way in.
 */

export interface ImportDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  home: string;
  now: () => Date;
}

export const IMPORT_HELP = `ai-insights import: add a chat export to your history.

Usage
  ai-insights import claude <path>   import a Claude data export: the .zip, its unzipped
                                     folder, or conversations.json (a newer import replaces
                                     the earlier one)
  ai-insights import --list          show what has been imported
  ai-insights import --remove claude remove the import and everything made from it

AI Insights keeps counts, tool names and your own prompts (secrets redacted) from the
export, never Claude's answers, thinking, tool results, attachments or chat titles.
Chat exports record no model or token counts, so tokens and cost are not measured for them.
`;

const SOURCES = new Set(["claude"]);

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "?");
const n = (value: number) => value.toLocaleString("en-US");

function describe(manifest: ImportManifest): string[] {
  return [
    `  Claude chat  ${n(manifest.sessions)} ${manifest.sessions === 1 ? "conversation" : "conversations"}, ${day(manifest.from)} to ${day(manifest.to)}`,
    `               ${n(manifest.prompts)} prompts, ${n(manifest.replies)} replies, ${n(manifest.toolCalls)} tool calls`,
    `               imported ${day(manifest.importedAt)}${manifest.issues ? `, ${n(manifest.issues)} unreadable ${manifest.issues === 1 ? "item" : "items"} skipped` : ""}`,
  ];
}

function failure(outcome: Extract<ImportOutcome, { ok: false }>, path: string): string {
  switch (outcome.reason) {
    case "not_found":
      return `nothing at ${path}. Give the path to the export .zip, its unzipped folder, or conversations.json.`;
    case "unreadable_zip":
      return `${path} could not be read as a zip. If the download was cut short, download the export again.`;
    case "no_conversations":
      return `no conversations found in ${path}. Point at the export that holds conversations.json (for a split export, the folder with the conversations-*.zip files).`;
    default:
      return `could not read any conversation from ${path}${outcome.issues ? ` (${n(outcome.issues)} unreadable ${outcome.issues === 1 ? "part" : "parts"})` : ""}.`;
  }
}

/** Returns the exit code. */
export async function runImport(argv: string[], deps: ImportDeps): Promise<number> {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const words = argv.filter((arg) => !arg.startsWith("-"));
  const usage = (message: string) => {
    deps.stderr(`ai-insights import: ${message}\nRun \`ai-insights import --help\` for usage.\n`);
    return 2;
  };
  if (flags.includes("-h") || flags.includes("--help")) {
    deps.stdout(IMPORT_HELP);
    return 0;
  }
  const unknown = flags.find((flag) => flag !== "--list" && flag !== "--remove");
  if (unknown) return usage(`unknown option "${unknown}"`);
  if (flags.includes("--list")) {
    if (words.length > 0 || flags.length > 1) return usage("--list takes nothing else");
    const manifest = await readManifest(deps.home);
    deps.stdout(manifest ? `Imported\n${describe(manifest).join("\n")}\n` : "Nothing imported yet. Run `ai-insights import claude <path>`.\n");
    return 0;
  }
  if (flags.includes("--remove")) {
    if (words.length !== 1 || !SOURCES.has(words[0]!)) return usage("--remove needs the source: claude");
    const removed = await removeClaudeImport(deps.home);
    deps.stdout(removed ? "Removed the Claude chat import and the sessions made from it.\n" : "There was no Claude chat import to remove.\n");
    return 0;
  }
  const [source, path, ...rest] = words;
  if (!source) return usage("say what to import: ai-insights import claude <path>");
  if (!SOURCES.has(source)) return usage(`unknown source "${source}"; only claude can be imported`);
  if (!path) return usage("give the path to the export: ai-insights import claude <path>");
  if (rest.length > 0) return usage("one path at a time");
  const outcome = await importClaudeExport(path, deps.home, { now: deps.now() });
  if (!outcome.ok) {
    deps.stderr(`ai-insights import: ${failure(outcome, path)}\n`);
    return 1;
  }
  deps.stdout(
    [
      "Imported your Claude chat history",
      ...describe(outcome.manifest),
      "",
      "Kept: counts, tool names and your own prompts. Not kept: Claude's answers, thinking, tool results,",
      "attachments and chat titles. Tokens and cost are not in the export, so they stay unmeasured.",
      "Run `ai-insights` to see it in your report.",
      "",
    ].join("\n"),
  );
  return 0;
}
