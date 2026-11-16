import type { Activity, Coverage, Evidence, Finding, Harness, Session, Severity, UsageSummary } from "../../schema/types.js";
import { clean } from "../../sources/shared.js";
import type { Clock } from "../time.js";
import type { OwnedRequest } from "../usage.js";

export { isAgentDriven, isBriefDriven, projectKey } from "../sessions.js";

export interface DetectorContext {
  /** Sorted by start time, then harness and id. */
  sessions: Session[];
  /** De-duplicated, each owned by the first session that reported it. */
  requests: OwnedRequest[];
  usage: UsageSummary;
  activity: Activity;
  coverage: Coverage[];
  now: Date;
  clock: Clock;
}

export type Detector = (context: DetectorContext) => Finding[];

/** A finding lists enough evidence to check it, not every occurrence. */
export const MAX_EVIDENCE = 5;
/** Beyond this, more findings of one kind read as noise rather than signal. */
export const MAX_FINDINGS_PER_KIND = 5;
/** Ids and quoted commands stay short enough to read on one line. */
const MAX_LABEL_CHARS = 120;

export function evidence(session: Session, note: string, timestamp?: string): Evidence {
  const out: Evidence = { sessionId: session.id, harness: session.harness, note: clean(note, 240) };
  const at = timestamp ?? session.startTime;
  if (at) out.timestamp = at;
  return out;
}

export function harnessesOf(sessions: Iterable<Session>): Harness[] {
  return [...new Set([...sessions].map((session) => session.harness))].sort();
}

export function label(text: string): string {
  return clean(text, MAX_LABEL_CHARS);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function usd(value: number): string {
  return value >= 100 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function minutes(value: number): string {
  if (value < 90) return `${Math.round(value)} min`;
  const hours = value / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

export const HARNESS_LABELS: Record<Harness, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
};

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

/** Severity first, then the size of the number behind it, then id so the order never depends on input order. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (b.metric?.value ?? Number.NEGATIVE_INFINITY) - (a.metric?.value ?? Number.NEGATIVE_INFINITY) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
