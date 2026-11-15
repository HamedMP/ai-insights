import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, TranscriptTurn } from "../../schema/types.js";
import { clean } from "../shared.js";
import { expandRoots, rolloutIndex, rootForPath } from "./discover.js";
import { buildRollout, foldChild } from "./parse.js";

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
    for (const child of family?.children ?? []) {
      foldChild(session, await buildRollout(child.path, child.mtimeMs));
    }
    if (family?.children.length) session.requests.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return session;
  } catch {
    // Parsers never throw; an unreadable rollout simply holds no session.
    return null;
  }
}

/** Keep turns nearest an instant, or spread evenly across the session, always in time order. */
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
  const picked: TranscriptTurn[] = [];
  for (let step = 0; step < maxTurns; step += 1) picked.push(turns[Math.floor((step * turns.length) / maxTurns)]!);
  return picked;
}

async function excerpt(file: SessionFile, options: ExcerptOptions = {}): Promise<TranscriptTurn[]> {
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 40, 500));
  const maxChars = Math.max(20, Math.min(options.maxCharsPerTurn ?? 1200, 20_000));
  try {
    const built = await buildRollout(file.path, file.mtimeMs, { turnChars: maxChars });
    const turns = built.turns
      .map((turn) => ({ ...turn, text: clean(turn.text, maxChars) }))
      .filter((turn) => turn.text.length > 0);
    return selectTurns(turns, maxTurns, options.around);
  } catch {
    return [];
  }
}

export const codexSource: Source = {
  harness: "codex",
  label: "Codex",
  defaultRoots,
  discover,
  parse,
  excerpt,
};
