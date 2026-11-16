import type { SessionSpan } from "../schema/types.js";
import { clip, count, formatClock, formatInt, formatLocalDay, fromLocal, localDayStart, parseInstant, plural, shortenPath, zoneOffsetMs } from "./format.js";
import { html, raw, type SafeHtml } from "./html.js";
import { harnessLabel } from "./labels.js";

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

function chooseWindow(spans: Span[], peakAt: number, zone: string): Timeline["window"] {
  const first = spans[0]!.start;
  const last = Math.max(...spans.map((span) => span.end));
  if (last - first <= READABLE_RANGE_MS) {
    const pad = Math.max(10 * 60_000, (last - first) * 0.03);
    return { start: first - pad, end: last + pad, kind: "all", days: 0, label: "" };
  }
  const cluster = clusterAround(spans, peakAt);
  let dayStart = localDayStart(cluster.start, zone);
  let dayEnd = localDayStart(cluster.end - 1, zone);
  if (Math.round((dayEnd - dayStart) / DAY) + 1 > MAX_WINDOW_DAYS) dayStart = dayEnd = localDayStart(peakAt, zone);
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
export function buildTimeline(rawSpans: unknown, zone: string, order: string[] = []): Timeline | null {
  const spans = normalise(rawSpans);
  if (spans.length < 2) return null;
  const overall = peakConcurrency(spans);
  if (overall.count < 2) return null;

  const window = chooseWindow(spans, overall.at, zone);
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
    peak: { at: local.at, count: local.count, x: (local.at - window.start) / length, label: formatClock(local.at, zone) },
    harnesses,
    agentDriven: inWindow.filter((span) => span.agentDriven).length,
    ticks: ticksFor(window.start, window.end, zone),
  };
}

function pct(share: number): string {
  return `${Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10}%`;
}

function r1(value: number): number {
  return Math.round(value * 10) / 10;
}

function projectName(project: string | null): string {
  return project ? clip(shortenPath(project), 60) : "No project";
}

function windowText(timeline: Timeline, zone: string): string {
  const { window } = timeline;
  if (window.kind === "all") return `All ${formatInt(timeline.total)} sessions, ${formatLocalDay(window.start, zone)} ${formatClock(window.start, zone)} to ${formatLocalDay(window.end, zone)} ${formatClock(window.end, zone)}`;
  return `${window.label}, ${window.days === 1 ? "the day" : "the days"} with the most sessions at once`;
}

/** The plain-language description used as the timeline's accessible name. */
export function timelineSummary(timeline: Timeline, zone: string): string {
  const parts = [
    `${windowText(timeline, zone)}.`,
    `${plural(timeline.inWindow, "session")} drawn in ${plural(timeline.lanes, "lane")}, one lane per session running at the same time.`,
    `At most ${formatInt(timeline.peak.count)} ran at once, at ${timeline.peak.label}.`,
  ];
  if (timeline.agentDriven > 0) parts.push(`${plural(timeline.agentDriven, "session")} ${timeline.agentDriven === 1 ? "was" : "were"} driven by another agent.`);
  if (timeline.hidden > 0) parts.push(`${plural(timeline.hidden, "session")} beyond ${MAX_LANES} lanes ${timeline.hidden === 1 ? "is" : "are"} not drawn.`);
  return parts.join(" ");
}

export function timelineCaption(timeline: Timeline, zone: string): string {
  return timeline.window.kind === "all" ? windowText(timeline, zone) : `Showing ${windowText(timeline, zone)} · ${formatInt(timeline.inWindow)} of ${formatInt(timeline.total)} sessions`;
}

/**
 * Draw the timeline. `sessions` is the report's session count, so the caption can say
 * when the spans are only the newest part of the history.
 */
export function spanTimeline(timeline: Timeline, zone: string, sessions: number): SafeHtml {
  const laneHeight = timeline.lanes <= 6 ? 18 : timeline.lanes <= 12 ? 12 : 9;
  const gap = timeline.lanes <= 12 ? 4 : 3;
  const height = timeline.lanes * (laneHeight + gap) - gap;
  const harnessClass = (harness: string) => `hz${Math.min(3, Math.max(0, timeline.harnesses.indexOf(harness)))}`;
  const time = (ms: number) => `${formatLocalDay(ms, zone)} ${formatClock(ms, zone)}`;

  const grid = timeline.ticks.map((tick) => `<line class="tl-grid${tick.major ? " major" : ""}" x1="${r1(tick.x * VIEW_WIDTH)}" x2="${r1(tick.x * VIEW_WIDTH)}" y1="0" y2="${height}" vector-effect="non-scaling-stroke"/>`);
  const bars = timeline.bars.map(
    (bar) =>
      html`<rect class="${harnessClass(bar.harness)}${bar.agentDriven ? " ad" : ""}" x="${r1(bar.x * VIEW_WIDTH)}" y="${bar.lane * (laneHeight + gap)}" width="${Math.max(1, r1(bar.width * VIEW_WIDTH))}" height="${laneHeight}" vector-effect="non-scaling-stroke"><title>${`${harnessLabel(bar.harness)} · ${projectName(bar.project)} · ${formatClock(bar.start, zone)} to ${formatClock(bar.end, zone)}${bar.agentDriven ? " · driven by another agent" : ""}`}</title></rect>`,
  );
  const peakX = r1(timeline.peak.x * VIEW_WIDTH);
  const peakSide = timeline.peak.x > 0.62 ? " end" : timeline.peak.x < 0.12 ? " start" : "";
  const spansOnly = count(sessions) > timeline.total;

  const rows = [...timeline.bars].sort((a, b) => a.start - b.start).slice(0, MAX_LIST_ROWS);
  const list = html`<details class="tl-list"><summary class="micro">The sessions as a table</summary><div class="table-wrap"><table><thead><tr><th>Start</th><th>End</th><th>Tool</th><th>Project</th><th>Driven by</th></tr></thead><tbody>${rows.map(
    (bar) => html`<tr><td>${time(bar.start)}</td><td>${time(bar.end)}</td><td>${harnessLabel(bar.harness)}</td><td class="mono">${projectName(bar.project)}</td><td>${bar.agentDriven ? "Another agent" : "You"}</td></tr>`,
  )}</tbody></table></div>${timeline.bars.length > rows.length ? html`<p class="micro more">+ ${formatInt(timeline.bars.length - rows.length)} more in the timeline</p>` : null}</details>`;

  return html`<figure class="viz timeline" data-chart="timeline">
<ul class="legend-list inline tl-legend micro">${timeline.harnesses.map((harness) => html`<li><i class="sw ${harnessClass(harness)}"></i><span>${harnessLabel(harness)}</span></li>`)}${
    timeline.agentDriven > 0 ? html`<li><i class="sw ad"></i><span>Driven by another agent</span></li>` : null
  }</ul>
<div class="tl-plot">
<span class="tl-peak-label micro${peakSide}" style="left:${pct(timeline.peak.x)}"><b>${formatInt(timeline.peak.count)}</b> at once · ${timeline.peak.label}</span>
<svg viewBox="0 0 ${VIEW_WIDTH} ${height}" preserveAspectRatio="none" style="height:${height}px" role="img" aria-label="${timelineSummary(timeline, zone)}">${raw(grid.join(""))}${bars}<line class="tl-peak" x1="${peakX}" x2="${peakX}" y1="0" y2="${height}" vector-effect="non-scaling-stroke"/></svg>
<div class="tl-axis micro" aria-hidden="true">${timeline.ticks.map((tick, index) => html`<span class="${[tick.major ? "major" : "", index % 2 === 1 ? "odd" : "", tick.x < 0.05 ? "first" : tick.x > 0.95 ? "last" : ""].filter(Boolean).join(" ")}" style="left:${pct(tick.x)}">${tick.label}</span>`)}</div>
</div>
<figcaption class="micro"><span>${timelineCaption(timeline, zone)}</span><span>One bar per session · one lane per session running at the same time${
    timeline.hidden > 0 ? ` · ${plural(timeline.hidden, "more session")} beyond ${MAX_LANES} lanes not drawn` : ""
  }${spansOnly ? ` · drawn from the newest ${formatInt(timeline.total)} sessions` : ""}</span></figcaption>
${list}
</figure>`;
}
