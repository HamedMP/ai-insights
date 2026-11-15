import { barList, calendarHeatmap, columnChart, monthTicks, type HeatmapDay } from "../charts.js";
import { card, sectionHead, tiles, type RenderContext } from "../components.js";
import { clip, count, dayNumber, formatDay, formatHours, formatInt, formatSeconds, plural, shortenPath } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel } from "../labels.js";

/** About a year of columns: enough for trends, small enough to stay light. */
export const MAX_DAYS = 371;
const MAX_LANGUAGES = 10;
const MAX_TOOLS = 12;
const MAX_PROJECTS = 10;
const MAX_LABEL = 80;
const EMPTY = "No activity yet.";

export interface DayWindow {
  first: number;
  columns: number;
}

/** A dense window of days ending at the newest bucket, so gaps show as gaps. */
export function dayWindow(dayStrings: string[]): DayWindow | null {
  const days = dayStrings.map(dayNumber).filter((day): day is number => day !== null);
  if (days.length === 0) return null;
  const last = Math.max(...days);
  const first = Math.max(Math.min(...days), last - MAX_DAYS + 1);
  return { first, columns: last - first + 1 };
}

function dailyTooltip(day: number, entry: { sessions: number; userMessages: number; activeMinutes: number } | undefined): string {
  const date = formatDay(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (!entry || count(entry.sessions) === 0) return `${date}: no sessions`;
  return `${date}: ${plural(count(entry.sessions), "session")}, ${plural(count(entry.userMessages), "message")}, ${formatHours(entry.activeMinutes)}`;
}

export function activitySection(context: RenderContext): SafeHtml {
  const { activity } = context.report;
  const daily = activity.daily ?? [];
  const byDay = new Map<number, (typeof daily)[number]>();
  for (const entry of daily) {
    const day = dayNumber(entry.day);
    if (day !== null) byDay.set(day, entry);
  }
  const window = dayWindow(daily.map((entry) => entry.day));

  const heatDays: HeatmapDay[] = window
    ? Array.from({ length: window.columns }, (_, index) => {
        const day = window.first + index;
        const entry = byDay.get(day);
        return { day, value: count(entry?.sessions), tooltip: dailyTooltip(day, entry) };
      })
    : [];

  const sessionsChart = window
    ? columnChart({
        id: "daily-sessions",
        series: [{ className: "s3", label: "Sessions", values: heatDays.map((entry) => entry.value) }],
        xTicks: monthTicks(window.first, window.columns),
        yTitle: "Sessions",
        xTitle: "Day",
        tooltips: heatDays.map((entry) => entry.tooltip),
        ariaLabel: `Sessions per day, ${formatDay(window.first, { month: "short", day: "numeric", year: "numeric" })} to ${formatDay(window.first + window.columns - 1, { month: "short", day: "numeric", year: "numeric" })}`,
        emptyMessage: EMPTY,
        formatTick: formatInt,
      })
    : columnChart({ id: "daily-sessions", series: [], xTicks: [], yTitle: "", xTitle: "", ariaLabel: "", emptyMessage: EMPTY });

  const hours = Array.from({ length: 24 }, (_, hour) => count(activity.hourHistogram?.[hour]));
  const hoursChart = columnChart({
    id: "hours",
    series: [{ className: "s3", label: "Messages", values: hours }],
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({ index: hour, text: String(hour).padStart(2, "0") })),
    yTitle: "Messages you sent",
    xTitle: `Hour of day (${context.zone})`,
    tooltips: hours.map((value, hour) => `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00: ${plural(value, "message")}`),
    ariaLabel: "Messages you sent by hour of day",
    emptyMessage: EMPTY,
  });
  const peakHour = hours.some((value) => value > 0) ? hours.indexOf(Math.max(...hours)) : null;

  const buckets = (activity.responseTimeBuckets ?? []).slice(0, 12);
  const responseChart = columnChart({
    id: "response-times",
    series: [{ className: "s3", label: "Turns", values: buckets.map((bucket) => count(bucket.count)) }],
    xTicks: buckets.map((bucket, index) => ({ index, text: clip(String(bucket.key), 12) })),
    yTitle: "Turns",
    xTitle: "Time before your next prompt",
    tooltips: buckets.map((bucket) => `${clip(String(bucket.key), 12)}: ${plural(count(bucket.count), "turn")}`),
    ariaLabel: "How long you took to reply after the agent finished a turn",
    emptyMessage: "No response times recorded yet.",
  });

  const harnessItems = (activity.byHarness ?? []).map((entry) => ({
    label: harnessLabel(entry.harness),
    value: count(entry.sessions),
    display: `${formatInt(entry.sessions)} · ${formatHours(entry.activeMinutes)}`,
  }));
  const parallel = activity.parallelSessions ?? { overlapEvents: 0, maxConcurrent: 0, sessionsInvolved: 0 };
  const projects = (activity.projects ?? []).map((entry) => {
    const label = clip(shortenPath(String(entry.projectPath ?? "")), MAX_LABEL);
    return { label, title: label, value: count(entry.sessions), display: plural(count(entry.sessions), "session") };
  });

  return html`<section id="activity">
${sectionHead("Activity", "When and how much you work with agents", window ? `${plural(count(activity.activeDays), "active day")}, longest streak ${plural(count(activity.longestStreakDays), "day")}.` : null)}
<div class="stack">
${card(html`<div class="card-head"><h3>Every day</h3><span class="muted">Sessions per day</span></div>${calendarHeatmap("heatmap", heatDays, { emptyMessage: EMPTY, unit: "sessions" })}`)}
${card(html`<div class="card-head"><h3>Sessions per day</h3></div>${sessionsChart}`)}
<div class="grid two">
${card(html`<div class="card-head"><h3>Time of day</h3>${peakHour !== null ? html`<span class="muted">Busiest at ${String(peakHour).padStart(2, "0")}:00</span>` : null}</div>${hoursChart}`)}
${card(html`<div class="card-head"><h3>How fast you reply</h3><span class="muted">Median ${formatSeconds(activity.medianResponseTimeSec)}</span></div>${responseChart}`)}
</div>
<div class="grid two">
${card(html`<div class="card-head"><h3>By tool</h3><span class="muted">Sessions · active time</span></div>${barList("harness", harnessItems, { limit: 8, emptyMessage: EMPTY })}`)}
${card(html`<div class="card-head"><h3>Parallel sessions</h3></div><div data-chart="parallel">${
    count(parallel.overlapEvents) > 0
      ? html`${tiles(
          [
            { value: formatInt(parallel.maxConcurrent), label: "Most at once" },
            { value: formatInt(parallel.overlapEvents), label: "Overlaps" },
            { value: formatInt(parallel.sessionsInvolved), label: "Sessions involved" },
          ],
          "Parallel sessions",
        )}<p class="note">Times two or more sessions were running side by side.</p>`
      : html`<div class="chart-empty">No overlapping sessions. Everything ran one at a time.</div>`
  }</div>`)}
</div>
<div class="grid two">
${card(html`<div class="card-head"><h3>Languages</h3><span class="muted">File-tool calls</span></div>${barList("languages", (activity.languages ?? []).map((entry) => ({ label: clip(String(entry.key), MAX_LABEL), value: count(entry.count) })), { limit: MAX_LANGUAGES, emptyMessage: "No files touched yet." })}`)}
${card(html`<div class="card-head"><h3>Top tools</h3><span class="muted">Calls</span></div>${barList("tools", (activity.tools ?? []).map((entry) => ({ label: clip(String(entry.key), MAX_LABEL), value: count(entry.count) })), { limit: MAX_TOOLS, emptyMessage: "No tool calls yet.", mono: true })}`)}
</div>
${card(html`<div class="card-head"><h3>Projects</h3><span class="muted">Home folder shown as ~</span></div>${barList("projects", projects, { limit: MAX_PROJECTS, emptyMessage: "No projects yet.", mono: true })}`)}
</div>
</section>`;
}
