import type { Evidence, Finding, Harness, HarnessRetention, Session, Severity, SuggestionStep } from "../../schema/types.js";
import { historyDaysFrom } from "../history.js";
import { MATRIX_URL, PACKMEM_ACTION, PACKMEM_URL } from "../links.js";
import { parseMs } from "../time.js";
import { evidence, HARNESS_LABELS, plural, type DetectorContext } from "./context.js";

/**
 * Claude Code deletes transcripts after 30 days by default, so history that stops near that mark is usually the
 * deletion window, not the start of the person's real history.
 */
const SHORT_HISTORY_DAYS = 32;
/** The value the keep-longer step proposes: enough for a yearly look back. */
const KEEP_DAYS = 365;
const CLAUDE_DEFAULT_FILE = "~/.claude/settings.json";
const CLAUDE_URL = "https://code.claude.com/docs/en/settings";

export const RETENTION_TITLE = "Keep your history";

function keepLongerStep(entry: HarnessRetention): SuggestionStep | null {
  const label = HARNESS_LABELS[entry.harness];
  if (entry.source === "managed") {
    return {
      title: `Keep ${label} transcripts longer`,
      action: `Your organization's managed settings fix how long ${label} keeps transcripts (${plural(entry.days ?? 0, "day")}); only an administrator can raise it.`,
      ...(entry.url ? { url: entry.url } : {}),
    };
  }
  const file = entry.setting?.file;
  if (!file) return null;
  if (entry.harness === "claude-code") {
    const previous = typeof entry.setting?.value === "number" ? entry.setting.value : null;
    return {
      title: "Keep Claude Code transcripts longer",
      action: `Claude Code deletes transcripts ${plural(entry.days ?? 30, "day")} after they last changed. Add this line to the top-level object in ${file} to keep them for a year; it applies the next time Claude Code starts.`,
      command: `"cleanupPeriodDays": ${KEEP_DAYS}`,
      undo: previous === null ? "Remove the line to go back to the default of 30 days." : `Set it back to ${previous}.`,
      url: CLAUDE_URL,
    };
  }
  if (entry.harness === "gemini") {
    const previous = typeof entry.setting?.value === "string" ? entry.setting.value : null;
    return {
      title: "Keep Gemini CLI chats longer",
      action: `Gemini CLI deletes a project's chats ${plural(entry.days ?? 30, "day")} after their last update. Set this in ${file} to keep them for a year.`,
      command: `"general": { "sessionRetention": { "maxAge": "${KEEP_DAYS}d" } }`,
      undo: previous === null ? "Remove `maxAge` to go back to the default of 30 days." : `Set \`maxAge\` back to "${previous}".`,
      ...(entry.url ? { url: entry.url } : {}),
    };
  }
  return null;
}

/** The packmem step keeps the wording agreed for `history_disk_usage` word for word. */
function archiveStep(): SuggestionStep {
  return {
    title: "Archive them compactly",
    action: PACKMEM_ACTION,
    command: "npx packmem archive --dry-run",
    ...(PACKMEM_URL ? { url: PACKMEM_URL } : {}),
  };
}

/** Only what `matrix chats import` does today (Matrix CLI 0.3.21+, Claude Code and Codex transcripts). */
function matrixStep(): SuggestionStep {
  return {
    title: "Keep them for good across machines",
    action: `Matrix OS (${MATRIX_URL}) can hold a private copy: \`matrix chats import claude\` or \`matrix chats import codex\` with a transcript's path previews it, and adding \`--apply\` uploads it as a private chat.`,
    command: "matrix chats discover --json",
    url: MATRIX_URL,
  };
}

function oldestByHarness(sessions: Session[]): Map<Harness, Session> {
  const out = new Map<Harness, Session>();
  for (const session of sessions) {
    const ms = parseMs(session.startTime);
    if (ms === null) continue;
    const current = out.get(session.harness);
    if (!current || ms < (parseMs(current.startTime) ?? Number.POSITIVE_INFINITY)) out.set(session.harness, session);
  }
  return out;
}

interface Span {
  harness: Harness;
  session: Session;
  ms: number;
  days: number;
}

/** Days of history per harness, shortest first: a long Codex history must not hide that Claude Code kept only days. */
function historySpans({ sessions, coverage, now, clock }: DetectorContext): Span[] {
  const spans: Span[] = [];
  for (const [harness, session] of oldestByHarness(sessions)) {
    let ms = parseMs(session.startTime)!;
    const entry = coverage.find((item) => item.harness === harness);
    const scanned = parseMs(entry?.oldest);
    if (scanned !== null && scanned < ms) ms = scanned;
    spans.push({ harness, session, ms, days: entry?.historyDays ?? historyDaysFrom(ms, now.getTime(), clock) });
  }
  return spans.sort((a, b) => a.days - b.days || a.harness.localeCompare(b.harness));
}

/**
 * One idea, "keep your history": a harness is deleting transcripts this week, or deletes them at its default
 * age, or history here is short. Severity follows urgency. Without a measured `retention` (older callers) it
 * falls back to the short-history reading of coverage alone.
 */
export function historyRetention(context: DetectorContext): Finding[] {
  const { retention, sessions, clock } = context;
  const spans = historySpans(context);
  const short = spans.filter((span) => span.days < SHORT_HISTORY_DAYS);
  const byId = new Map(sessions.map((session) => [`${session.harness}\u0000${session.id}`, session]));
  const oldest = oldestByHarness(sessions);

  const deleting = (retention?.harnesses ?? []).filter((entry) => entry.policy === "deletes" && entry.transcripts > 0);
  const atRisk = deleting.filter((entry) => (entry.atRisk?.sessions ?? 0) > 0).sort((a, b) => b.atRisk!.sessions - a.atRisk!.sessions || a.harness.localeCompare(b.harness));
  const atDefault = deleting.filter((entry) => entry.source === "default");

  let severity: Severity;
  if (atRisk.length) severity = "medium";
  else if (atDefault.length) severity = "low";
  else if (short.length) severity = "info";
  else return [];

  const items: Evidence[] = [];
  for (const entry of atRisk) {
    for (const due of entry.due ?? []) {
      const session = byId.get(`${entry.harness}\u0000${due.sessionId}`);
      if (session) items.push(evidence(session, `${HARNESS_LABELS[entry.harness]} can delete this transcript from ${clock.dayOfMs(Date.parse(due.eligibleAt))}`, due.eligibleAt));
    }
  }
  for (const entry of retention?.harnesses ?? []) {
    const session = oldest.get(entry.harness);
    if (!session) continue;
    const kept = entry.policy === "deletes" ? `deletes transcripts after ${plural(entry.days ?? 0, "day")}` : entry.policy === "kept" ? "keeps transcripts until you delete them" : "may or may not delete old transcripts";
    const cached = entry.cachedOnly ? `; ${plural(entry.cachedOnly, "session")} survive only in AI Insights' cache` : "";
    items.push(evidence(session, `${HARNESS_LABELS[entry.harness]} ${kept}${cached}`));
  }
  if (!retention) for (const span of spans) items.push(evidence(span.session, `${HARNESS_LABELS[span.harness]} history goes back to ${clock.dayOfMs(span.ms)} (${plural(span.days, "day")})`));

  let title: string;
  let metric: Finding["metric"];
  let detail: string;
  const harnesses = new Set<Harness>();
  if (atRisk.length) {
    const lead = atRisk[0]!;
    const total = atRisk.reduce((sum, entry) => sum + entry.atRisk!.sessions, 0);
    const next = retention!.atRisk.nextDeletion;
    title = `${plural(total, `${HARNESS_LABELS[lead.harness]} session`)} can be deleted within ${plural(retention!.windowDays, "day")}`;
    if (atRisk.length > 1) title = `${plural(total, "session")} can be deleted within ${plural(retention!.windowDays, "day")}`;
    metric = { value: total, unit: "sessions", label: `sessions due for deletion within ${retention!.windowDays} days` };
    detail =
      `${atRisk.map((entry) => `${HARNESS_LABELS[entry.harness]} deletes transcripts ${plural(entry.days ?? 0, "day")} after they last changed; ${plural(entry.atRisk!.sessions, "transcript")} reach that age within ${retention!.windowDays} days`).join(". ")}` +
      `${next ? `, the first from ${clock.dayOfMs(Date.parse(next))}` : ""}. AI Insights keeps the stats it already read from them; the full transcripts go unless you keep or archive them.`;
    for (const entry of atRisk) harnesses.add(entry.harness);
  } else if (atDefault.length) {
    const lead = atDefault[0]!;
    title = `${HARNESS_LABELS[lead.harness]} deletes transcripts after ${plural(lead.days ?? 30, "day")}`;
    metric = { value: lead.days ?? 30, unit: "days", label: `days ${HARNESS_LABELS[lead.harness]} keeps transcripts` };
    detail = `${atDefault.map((entry) => `${HARNESS_LABELS[entry.harness]} keeps transcripts for ${plural(entry.days ?? 30, "day")}, its default`).join(". ")}. A look back over months needs the transcripts to last; AI Insights' cache keeps the stats, not the transcripts.`;
    for (const entry of atDefault) harnesses.add(entry.harness);
  } else {
    const lead = short[0]!;
    const perHarness = spans.map((span) => `${HARNESS_LABELS[span.harness]} ${plural(span.days, "day")} (since ${clock.dayOfMs(span.ms)})`).join(", ");
    title = `Only ${plural(lead.days, "day")} of ${HARNESS_LABELS[lead.harness]} history`;
    metric = { value: lead.days, unit: "days", label: `days of ${HARNESS_LABELS[lead.harness]} history` };
    detail = `History on this machine goes back: ${perHarness}. Agents that delete old transcripts (Claude Code after 30 days unless \`cleanupPeriodDays\` is raised), a new machine or a fresh install all start history late; trends over months cannot be seen from here.`;
    for (const span of short) harnesses.add(span.harness);
  }

  const steps: SuggestionStep[] = [];
  const longer = [...atRisk, ...atDefault.filter((entry) => !atRisk.includes(entry))];
  for (const entry of longer) {
    const step = keepLongerStep(entry);
    if (step) steps.push(step);
  }
  if (!retention && short.some((span) => span.harness === "claude-code")) {
    steps.push(keepLongerStep({ harness: "claude-code", policy: "deletes", days: 30, source: "default", setting: { name: "cleanupPeriodDays", file: CLAUDE_DEFAULT_FILE, value: null }, basis: "", transcripts: 0, bytes: 0, oldestOnDisk: null, cachedOnly: 0, coversFrom: null })!);
  }
  steps.push(archiveStep(), matrixStep());

  return [
    {
      id: "history_retention",
      kind: "history_retention",
      severity,
      title,
      detail,
      harnesses: [...harnesses].sort(),
      metric,
      evidence: items,
      suggestion: {
        type: "feature",
        title: RETENTION_TITLE,
        action: "Back up your transcripts so you can still analyse them later: keep them longer, archive them compactly, or keep a private copy across machines.",
        url: CLAUDE_URL,
        steps,
      },
    },
  ];
}
