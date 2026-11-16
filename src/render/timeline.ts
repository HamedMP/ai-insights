import type { SessionSpan } from "../schema/types.js";
import { clip, count, formatClock, formatInt, formatLocalDay, fromLocal, localDayStart, parseInstant, plural, zoneOffsetMs } from "./format.js";

/**
 * Which sessions ran side by side, from `activity.sessionSpans`. Layout is pure and
 * tested on its own; the drawing is inline SVG stretched to the panel width, so lanes
 * keep a fixed pixel height on a phone while time compresses. Labels are HTML.
 */

/** The contract caps spans at 400; a renderer still bounds what it is handed. */
export const MAX_SPANS = 400;
/** Lanes beyond this are not drawn and are counted in the caption instead. */
export const MAX_LANES = 24;
export const MAX_LIST_ROWS = 60;
/** A whole history this short stays readable at phone width (about 10 px an hour). */
const READABLE_RANGE_MS = 36 * 3_600_000;
const MAX_WINDOW_DAYS = 3;
/** Shortest bar, as a share of the window, so a two-minute session is still a visible pixel. */
const MIN_BAR = 0.004;
const VIEW_WIDTH = 1000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface Span {
  sessionId: string;
  harness: string;
  project: string | null;
  start: number;
  end: number;
  agentDriven: boolean;
  /** Epoch-ms stretches with activity, when the report has them. */
  active: Array<[number, number]>;
}

export interface Bar extends Span {
  lane: number;
  /** Start and width as shares of the window, 0..1. */
  x: number;
  width: number;
}

export interface Tick {
  at: number;
  x: number;
  label: string;
  /** Local midnight: labelled with the date. */
  major: boolean;
}

export interface Timeline {
  window: { start: number; end: number; kind: "all" | "busiest"; days: number; label: string };
  bars: Bar[];
  lanes: number;
  /** Spans in the window that did not fit under MAX_LANES. */
  hidden: number;
  /** Valid spans considered, and how many of them fall in the window. */
  total: number;
  inWindow: number;
  peak: { at: number; count: number; x: number; label: string };
  harnesses: string[];
  agentDriven: number;
  ticks: Tick[];
}

function normalise(raw: unknown): Span[] {
  if (!Array.isArray(raw)) return [];
  const spans: Span[] = [];
  for (const entry of raw.slice(-MAX_SPANS) as Array<Partial<SessionSpan> | null>) {
    if (!entry || typeof entry !== "object") continue;
    const start = parseInstant(entry.start);
    const end = parseInstant(entry.end);
    if (start === null || end === null || end < start) continue;
    spans.push({
      sessionId: clip(typeof entry.sessionId === "string" ? entry.sessionId : "", 80),
      harness: typeof entry.harness === "string" && entry.harness ? clip(entry.harness, 40) : "other",
      project: typeof entry.project === "string" && entry.project ? entry.project : null,
      start,
      end,
      agentDriven: entry.agentDriven === true,
      active: Array.isArray(entry.active) ? entry.active.slice(0, 50).filter((pair): pair is [number, number] => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[1] >= pair[0]) : [],
    });
  }
  return spans.sort((a, b) => a.start - b.start || a.end - b.end || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

/** The earliest moment the most spans run at once. Spans that only touch do not overlap. */
export function peakConcurrency(spans: Array<{ start: number; end: number }>): { at: number; count: number } {
  const events: Array<[number, number]> = [];
  for (const span of spans) {
    if (span.end <= span.start) continue;
    events.push([span.start, 1], [span.end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let best = { at: events[0]?.[0] ?? 0, count: 0 };
  for (const [at, delta] of events) {
    running += delta;
    if (running > best.count) best = { at, count: running };
  }
  return best;
}

/** The stretch of continuous activity (spans chained by overlap) around an instant. */
function clusterAround(spans: Span[], at: number): { start: number; end: number } {
  let start = at;
  let end = at;
  let grew = true;
  while (grew) {
    grew = false;
    for (const span of spans) {
      if (span.end > start && span.start < end && (span.start < start || span.end > end)) {
        start = Math.min(start, span.start);
        end = Math.max(end, span.end);
        grew = true;
      }
    }
  }
  return { start, end };
}

function chooseWindow(spans: Span[], peakAt: number, zone: string, focus = false): Timeline["window"] {
  const first = spans[0]!.start;
  const last = Math.max(...spans.map((span) => span.end));
  if (!focus && last - first <= READABLE_RANGE_MS) {
    const pad = Math.max(10 * 60_000, (last - first) * 0.03);
    return { start: first - pad, end: last + pad, kind: "all", days: 0, label: "" };
  }
  const cluster = clusterAround(spans, peakAt);
  let dayStart = localDayStart(cluster.start, zone);
  let dayEnd = localDayStart(cluster.end - 1, zone);
  if (focus || Math.round((dayEnd - dayStart) / DAY) + 1 > MAX_WINDOW_DAYS) dayStart = dayEnd = localDayStart(peakAt, zone);
  const windowStart = dayStart;
  const windowEnd = fromLocal(dayEnd + zoneOffsetMs(dayEnd, zone) + DAY, zone);
  // Trim to the hours that held activity, so the busy part fills the width.
  const inside = spans.filter((span) => span.end > windowStart && span.start < windowEnd);
  const from = Math.max(windowStart, Math.min(...inside.map((span) => span.start)));
  const to = Math.min(windowEnd, Math.max(...inside.map((span) => span.end)));
  let start = Math.max(windowStart, Math.floor(from / HOUR) * HOUR);
  let end = Math.min(windowEnd, Math.ceil(to / HOUR) * HOUR);
  if (end - start < 3 * HOUR) {
    const grow = (3 * HOUR - (end - start)) / 2;
    start = Math.max(windowStart, start - grow);
    end = Math.min(windowEnd, end + grow);
  }
  const days = Math.round((dayEnd - dayStart) / DAY) + 1;
  return { start, end, kind: "busiest", days, label: days === 1 ? formatLocalDay(dayStart + HOUR * 12, zone) : `${formatLocalDay(dayStart + HOUR * 12, zone)} to ${formatLocalDay(dayEnd + HOUR * 12, zone)}` };
}

function ticksFor(start: number, end: number, zone: string): Tick[] {
  const span = end - start;
  const step = [1, 2, 3, 6, 12, 24].find((hours) => span / (hours * HOUR) <= 8) ?? 24;
  const ticks: Tick[] = [];
  let local = Math.ceil((start + zoneOffsetMs(start, zone)) / HOUR) * HOUR;
  for (let guard = 0; guard < 120; guard += 1, local += HOUR) {
    const at = fromLocal(local, zone);
    if (at > end) break;
    if (at < start) continue;
    const hour = Math.round(((local % DAY) + DAY) % DAY / HOUR) % 24;
    if (hour % step !== 0) continue;
    const major = hour === 0;
    ticks.push({ at, x: (at - start) / span, label: major ? formatLocalDay(at + HOUR, zone) : formatClock(at, zone), major });
  }
  return ticks;
}

/**
 * Lay out the spans, or return null when there is nothing side by side to show
 * (no spans, or no two of them overlap), so the caller keeps the aggregate visual.
 */
export function buildTimeline(rawSpans: unknown, zone: string, order: string[] = [], focusAt?: number): Timeline | null {
  const spans = normalise(rawSpans);
  if (spans.length < 2) return null;
  const overall = peakConcurrency(spans);
  if (overall.count < 2) return null;

  const window = chooseWindow(spans, focusAt ?? overall.at, zone, focusAt !== undefined);
  const length = window.end - window.start;
  const minimum = length * MIN_BAR;
  const inWindow = spans.filter((span) => (span.end > window.start && span.start < window.end) || (span.start === span.end && span.start >= window.start && span.start <= window.end));

  // First fit in start order uses exactly as many lanes as the most spans open at once.
  const laneEnds: number[] = [];
  const bars: Bar[] = [];
  let hidden = 0;
  for (const span of inWindow) {
    const from = Math.max(span.start, window.start);
    const to = Math.min(window.end, Math.max(span.end, from + minimum));
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= from);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= MAX_LANES) {
      hidden += 1;
      continue;
    }
    laneEnds[lane] = to;
    bars.push({ ...span, lane, x: (from - window.start) / length, width: (to - from) / length });
  }

  const local = peakConcurrency(inWindow.map((span) => ({ start: Math.max(span.start, window.start), end: Math.min(span.end, window.end) })));
  const seen = [...new Set(inWindow.map((span) => span.harness))];
  const rank = (harness: string) => {
    const index = order.indexOf(harness);
    return index === -1 ? order.length : index;
  };
  const harnesses = seen.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));

  return {
    window,
    bars,
    lanes: laneEnds.length,
    hidden,
    total: spans.length,
    inWindow: inWindow.length,
    // A window over several days needs the date on the peak, or "13:42" could be any of them.
    peak: { at: local.at, count: local.count, x: (local.at - window.start) / length, label: localDayStart(window.start, zone) === localDayStart(window.end - 1, zone) ? formatClock(local.at, zone) : `${formatLocalDay(local.at, zone)} ${formatClock(local.at, zone)}` },
    harnesses,
    agentDriven: inWindow.filter((span) => span.agentDriven).length,
    ticks: ticksFor(window.start, window.end, zone),
  };
}

/** "Nov 15 21:14 to 23:02", or "Nov 15 21:14 to Nov 16 19:58" when the session ran past midnight. */
export function spanText(start: number, end: number, zone: string): string {
  const sameDay = localDayStart(start, zone) === localDayStart(end, zone);
  return `${formatLocalDay(start, zone)} ${formatClock(start, zone)} to ${sameDay ? "" : `${formatLocalDay(end, zone)} `}${formatClock(end, zone)}`;
}

function windowText(timeline: Timeline, zone: string): string {
  const { window } = timeline;
  if (window.kind === "all") return `All ${formatInt(timeline.total)} sessions, ${formatLocalDay(window.start, zone)} ${formatClock(window.start, zone)} to ${formatLocalDay(window.end, zone)} ${formatClock(window.end, zone)}`;
  return `${window.label}, ${window.days === 1 ? "the day" : "the days"} with the most sessions open at once`;
}

/** The plain-language description used as the timeline's accessible name. */
export function timelineSummary(timeline: Timeline, zone: string, working?: number | null): string {
  const parts = [
    `${windowText(timeline, zone)}.`,
    `${plural(timeline.inWindow, "session")} drawn in ${plural(timeline.lanes, "lane")}, one lane per session open at the same time.`,
    `At most ${formatInt(timeline.peak.count)} were open at once, at ${timeline.peak.label}.`,
  ];
  const idleNote = openVersusWorking(timeline, working);
  if (idleNote) parts.push(idleNote);
  if (timeline.agentDriven > 0) parts.push(`${plural(timeline.agentDriven, "session")} ${timeline.agentDriven === 1 ? "was" : "were"} driven by another agent.`);
  if (timeline.hidden > 0) parts.push(`${plural(timeline.hidden, "session")} beyond ${MAX_LANES} lanes ${timeline.hidden === 1 ? "is" : "are"} not drawn.`);
  return parts.join(" ");
}

export function timelineCaption(timeline: Timeline, zone: string): string {
  return timeline.window.kind === "all" ? windowText(timeline, zone) : `Showing ${windowText(timeline, zone)} · ${formatInt(timeline.inWindow)} of ${formatInt(timeline.total)} sessions`;
}

/**
 * Why the marker can show more than the headline: a span runs from a session's first to
 * last entry, idle time included, while `working` (the report's `maxConcurrent`) counts
 * only sessions active at the same moment. Null when the two agree or `working` is unknown.
 */
export function openVersusWorking(timeline: Timeline, working: number | null | undefined): string | null {
  const active = count(working);
  if (active <= 0 || active === timeline.peak.count) return null;
  return `A bar runs from a session's first to last message, idle time included; at most ${plural(active, "session was", "sessions were")} actively working at the same moment.`;
}

/**
 * The busiest days, each as its own one-day timeline, oldest first, so a person can step between them.
 * A day qualifies when two or more sessions were open at once in it. The first entry of `busiest` is the
 * index of the day with the most at once.
 */
export function busiestDays(rawSpans: unknown, zone: string, order: string[] = [], max = 8): { days: Timeline[]; busiest: number } {
  const spans = normalise(rawSpans);
  const byDay = new Map<number, Span[]>();
  for (const span of spans) {
    let day = localDayStart(span.start, zone);
    for (let guard = 0; guard < 60 && day < span.end; guard += 1) {
      const list = byDay.get(day) ?? [];
      list.push(span);
      byDay.set(day, list);
      day = localDayStart(day + DAY + HOUR * 3, zone);
    }
  }
  const ranked = [...byDay.entries()]
    .map(([day, list]) => {
      const next = localDayStart(day + DAY + HOUR * 3, zone);
      const peak = peakConcurrency(list.map((span) => ({ start: Math.max(span.start, day), end: Math.min(span.end, next) })));
      return { day, peak };
    })
    .filter((entry) => entry.peak.count >= 2)
    .sort((a, b) => b.peak.count - a.peak.count || b.day - a.day)
    .slice(0, Math.max(1, max));
  const chosen = ranked.sort((a, b) => a.day - b.day);
  const days: Timeline[] = [];
  let busiest = 0;
  for (const entry of chosen) {
    const timeline = buildTimeline(rawSpans, zone, order, entry.peak.at);
    if (!timeline) continue;
    if (days.length > 0 && timeline.peak.count > days[busiest]!.peak.count) busiest = days.length;
    days.push(timeline);
  }
  return { days, busiest };
}
