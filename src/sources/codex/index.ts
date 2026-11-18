import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, TranscriptTurn } from "../../schema/types.js";
import { scrub } from "../shared.js";
import { expandRoots, rolloutIndex, rootForPath } from "./discover.js";
import { buildRollout, foldChild, SUBAGENT_REPLY } from "./parse.js";
import { chooseProject, MAX_EVIDENCE } from "./project.js";

function codexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? configured : join(homedir(), ".codex");
}

function defaultRoots(): string[] {
  const home = codexHome();
  return [join(home, "sessions"), join(home, "archived_sessions")];
}

async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const roots = expandRoots(options.roots ?? defaultRoots());
  const index = await rolloutIndex(roots, true);
  const since = options.since?.getTime();
  const files: SessionFile[] = [];
  for (const family of index.families.values()) {
    if (since !== undefined && family.mtimeMs < since) continue;
    files.push({ harness: "codex", path: family.file.path, mtimeMs: family.mtimeMs, sizeBytes: family.sizeBytes });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.maxFiles !== undefined ? files.slice(0, Math.max(0, options.maxFiles)) : files;
}

async function parse(file: SessionFile): Promise<Session | null> {
  try {
    const index = await rolloutIndex(expandRoots([rootForPath(file.path)]));
    // Guardian reviews and subagents are counted inside the session that started them.
    if (index.foldedInto.has(file.path)) return null;
    const built = await buildRollout(file.path, file.mtimeMs);
    const session = built.session;
    if (!session) return null;
    const family = index.families.get(file.path);
    const evidence = [...built.evidence];
    for (const child of family?.children ?? []) {
      const folded = await buildRollout(child.path, child.mtimeMs);
      foldChild(session, folded);
      // A subagent's edits are this session's work; a guardian only reads what it reviews.
      if (folded.meta.kind !== "guardian") evidence.push(...folded.evidence.slice(0, Math.max(0, MAX_EVIDENCE - evidence.length)));
    }
    if (family?.children.length) session.requests.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    session.projectPath = chooseProject(session.projectPath, evidence);
    return session;
  } catch {
    // Parsers never throw; an unreadable rollout simply holds no session.
    return null;
  }
}

type Indexed = { turn: TranscriptTurn; index: number };

const INTERRUPTED = "[interrupted]";

function pickEvenly<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return items;
  if (count === 1) return [items[items.length - 1]!];
  const picked: T[] = [];
  for (let step = 0; step < count; step += 1) picked.push(items[Math.round((step * (items.length - 1)) / (count - 1))]!);
  return picked;
}

/**
 * Tool and assistant turns vastly outnumber the person's. When turns must be dropped, keep what carries the
 * signal first: the person's prompts (up to half the slots), the final answer, then failures and messages
 * from other agents, then an even spread of the rest. Always in time order.
 */
function selectTurns(turns: TranscriptTurn[], maxTurns: number, around?: string): TranscriptTurn[] {
  if (turns.length <= maxTurns) return turns;
  const target = around ? Date.parse(around) : Number.NaN;
  if (Number.isFinite(target)) {
    return turns
      .map((turn, index) => ({ index, distance: Math.abs((Date.parse(turn.timestamp) || 0) - target) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, maxTurns)
      .sort((a, b) => a.index - b.index)
      .map(({ index }) => turns[index]!);
  }
  const indexed: Indexed[] = turns.map((turn, index) => ({ turn, index }));
  let finalIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]!.role === "assistant") {
      finalIndex = index;
      break;
    }
  }
  const users = indexed.filter(({ turn }) => turn.role === "user");
  const brief = users.findIndex(({ turn }) => turn.text !== INTERRUPTED);
  const signals = indexed.filter(({ turn, index }) => index !== finalIndex && (turn.isError || turn.role === "agent"));
  const isReply = (turn: TranscriptTurn) => turn.toolName === SUBAGENT_REPLY && !turn.isError;
  const rest = indexed.filter(({ turn, index }) => index !== finalIndex && turn.role !== "user" && !turn.isError && turn.role !== "agent" && !isReply(turn));
  // Subagent replies are the session's own machinery reporting in: only room nothing else wanted goes to them.
  const replies = indexed.filter(({ turn, index }) => index !== finalIndex && isReply(turn));
  const picked: Indexed[] = [];
  let room = maxTurns;
  if (finalIndex >= 0) {
    picked.push(indexed[finalIndex]!);
    room -= 1;
  }
  const others = signals.length + rest.length;
  const userTake = Math.min(users.length, room, Math.max(Math.ceil(maxTurns / 2), room - others));
  // The first prompt is usually the brief: without it the rest of the session cannot be judged.
  if (brief >= 0 && userTake > 0) picked.push(users[brief]!, ...pickEvenly([...users.slice(0, brief), ...users.slice(brief + 1)], userTake - 1));
  else picked.push(...pickEvenly(users, userTake));
  room -= userTake;
  const signalTake = Math.min(signals.length, Math.max(Math.ceil(room / 2), room - rest.length));
  picked.push(...pickEvenly(signals, signalTake));
  room -= signalTake;
  const restTake = Math.min(rest.length, room);
  picked.push(...pickEvenly(rest, restTake));
  picked.push(...pickEvenly(replies, room - restTake));
  return picked.sort((a, b) => a.index - b.index).map(({ turn }) => turn);
}

async function excerpt(file: SessionFile, options: ExcerptOptions = {}): Promise<TranscriptTurn[]> {
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 40, 500));
  const maxChars = Math.max(20, Math.min(options.maxCharsPerTurn ?? 1200, 20_000));
  try {
    const built = await buildRollout(file.path, file.mtimeMs, { turnChars: maxChars });
    // Later prompts get half the room, so a long pasted log further on cannot squeeze the brief out of the budget.
    const laterPromptChars = Math.max(200, Math.floor(maxChars / 2));
    let briefSeen = false;
    const turns = built.turns
      .map((turn) => {
        let cap = maxChars;
        if (turn.role === "user" && turn.text !== INTERRUPTED) {
          if (briefSeen) cap = Math.min(maxChars, laterPromptChars);
          briefSeen = true;
        }
        return { ...turn, text: scrub(turn.text, cap) };
      })
      .filter((turn) => turn.text.length > 0);
    return selectTurns(turns, maxTurns, options.around);
  } catch {
    return [];
  }
}

export const codexSource: Source = {
  // Bump whenever a parser change would give a different Session from the same rollout, so cached history is re-parsed.
  parserVersion: "7",
  harness: "codex",
  label: "Codex",
  defaultRoots,
  discover,
  parse,
  excerpt,
};
