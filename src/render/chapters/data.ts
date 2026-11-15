import type { UsageTotals } from "../../schema/types.js";
import { columnChart, monthTicks } from "../charts.js";
import { chapter, panel, type RenderContext } from "../components.js";
import { clip, count, dayNumber, formatBytes, formatCompact, formatDate, formatDay, formatHours, formatInt, formatSeconds, formatUsd, parseInstant, plural, shortenPath } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel, keyLabel } from "../labels.js";
import { peakWindow, pricingGap, unpricedModelsText, weekdayTotals, type Story } from "../story.js";
import { dayGrid, dayStacks, delegationFan, denseDays, dotColumns, hourClock, pixelBars, sessionField, splitBar, tokenFlow, waffle, weekStacks } from "../visuals.js";
import { tryThis, type ActionIndex } from "./common.js";
import type { ChapterId } from "../story.js";
import type { Finding } from "../../schema/types.js";

export interface ChapterInput {
  context: RenderContext;
  story: Story;
  tips: Record<ChapterId, Finding | null>;
  actions: ActionIndex;
  index: number;
}

const MAX_DAYS = 371;

const CATEGORY_LABELS: Record<string, string> = {
  shell: "Running commands",
  read: "Reading files",
  edit: "Editing files",
  search: "Searching code",
  web: "Searching the web",
  subagent: "Handing off to subagents",
  mcp: "MCP tools",
  skill: "Skills",
  plan: "Planning",
  ask_user: "Asking you",
  other: "Other tools",
};

export function rhythmChapter({ context, story, tips, actions, index }: ChapterInput): SafeHtml | null {
  const { activity } = context.report;
  const days = denseDays(
    (activity.daily ?? []).map((entry) => ({
      day: entry.day,
      value: entry.sessions,
      tooltip: `${entry.day}: ${plural(count(entry.sessions), "session")}, ${plural(count(entry.userMessages), "message")}, ${formatHours(entry.activeMinutes)} agent time`,
    })),
    MAX_DAYS,
  ).map((entry) => {
    const day = entry.day;
    return { ...entry, tooltip: entry.tooltip ? entry.tooltip.replace(/^\d{4}-\d{2}-\d{2}/, formatDay(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" })) : undefined };
  });
  const peak = peakWindow(activity.hourHistogram ?? []);
  const clock = hourClock(activity.hourHistogram ?? [], peak ? { start: peak.start, width: 4 } : null, context.zone);
  const { totals } = weekdayTotals(context.report);
  const week = weekStacks(totals);
  const series = days.map((entry) => ({ day: entry.day, value: entry.value, ...(entry.tooltip ? { tooltip: entry.tooltip } : {}) }));
  // A calendar needs months to read as one; a few weeks read better as day columns.
  const grid = series.length <= 92 ? dayStacks("calendar", series) : dayGrid("calendar", series, "sessions");
  if (!story.hours && !story.week && !clock && !grid) return null;
  const pair = [panel("Hour by hour", clock), panel("Week by week", week)].filter(Boolean);
  const body = html`${pair.length > 0 ? html`<div class="row${pair.length === 1 ? " one" : ""}">${pair}</div>` : null}${panel("Every day", grid, {
    aside: `${plural(count(activity.activeDays), "active day")} · longest streak ${plural(count(activity.longestStreakDays), "day")}`,
  })}`;
  return chapter({ id: "rhythm", index, kicker: "When you work", lead: story.hours ?? story.week, second: story.hours ? story.week : null, body, tip: tryThis(tips.rhythm, actions) });
}

export function delegationChapter({ context, story, tips, actions, index }: ChapterInput): SafeHtml | null {
  const { activity } = context.report;
  if (!story.delegation) return null;
  const steps = count(activity.assistantMessages) / Math.max(1, count(activity.userMessages));
  const mix = waffle(
    "tool-mix",
    (activity.toolCategories ?? []).map((entry) => ({ label: CATEGORY_LABELS[entry.key] ?? keyLabel(String(entry.key)), value: count(entry.count) })),
    "What your agents spent their tool calls on",
  );
  const replies = dotColumns(
    "response-times",
    (activity.responseTimeBuckets ?? []).map((bucket) => ({ key: clip(String(bucket.key), 12), count: count(bucket.count) })),
    "How long you took to reply after the agent finished a turn",
  );
  const features = activity.features;
  const sessions = count(activity.sessions);
  const chips = [
    ...(features?.mcpServers ?? []).slice(0, 8).map((entry) => ({ label: clip(String(entry.key), 40), value: count(entry.count) })),
    ...(features?.skills ?? []).slice(0, 8).map((entry) => ({ label: clip(String(entry.key), 40), value: count(entry.count) })),
    ...(features?.slashCommands ?? []).slice(0, 8).map((entry) => ({ label: clip(String(entry.key), 40), value: count(entry.count) })),
  ]
    .filter((chip) => chip.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const using = html`<dl class="facts">
<dt>Sessions with subagents</dt><dd>${formatInt(features?.sessionsWithSubagents ?? 0)} <span>of ${formatInt(sessions)}</span></dd>
<dt>Sessions with plan mode</dt><dd>${formatInt(features?.sessionsWithPlanMode ?? 0)} <span>of ${formatInt(sessions)}</span></dd>
<dt>Sessions with web search</dt><dd>${formatInt(features?.sessionsWithWeb ?? 0)} <span>of ${formatInt(sessions)}</span></dd>
<dt>Context compactions</dt><dd>${formatInt(features?.compactions ?? 0)}</dd>
</dl>${chips.length > 0 ? html`<div class="chips">${chips.map((chip) => html`<span class="chip">${chip.label}<b>${formatInt(chip.value)}</b></span>`)}</div>` : null}`;
  const body = html`<div class="row">${panel("One message in", delegationFan(steps))}${panel("Where the steps go", mix)}</div>
<div class="row">${panel("When the agent stops", replies, { aside: `median ${formatSeconds(activity.medianResponseTimeSec)} before you reply` })}${panel("What you already use", using, { className: "features-in-use" })}</div>`;
  return chapter({ id: "delegation", index, kicker: "How you delegate", lead: story.delegation, body, tip: tryThis(tips.delegation, actions) });
}

export function parallelChapter({ context, story, tips, actions, index }: ChapterInput): SafeHtml | null {
  if (!story.parallel) return null;
  const parallel = context.report.activity.parallelSessions;
  const field = sessionField(count(context.report.activity.sessions), count(parallel?.sessionsInvolved), count(parallel?.maxConcurrent), count(parallel?.overlapEvents));
  const wall = context.report.activity.wallClockActiveMinutes;
  const hours =
    typeof wall === "number" && Number.isFinite(wall) && wall > 0
      ? html`<div class="versus reveal"><div><b>${formatHours(wall)}</b><span class="micro">your hours with AI at work</span></div><div class="vs-bar"><span class="you" style="width:${Math.max(4, Math.round((wall / Math.max(wall, count(context.report.activity.totalActiveMinutes))) * 100))}%"></span><span class="agents"></span></div><div><b>${formatHours(context.report.activity.totalActiveMinutes)}</b><span class="micro">agent-hours, summed across sessions</span></div></div>`
      : null;
  return chapter({ id: "parallel", index, kicker: "Several at once", lead: story.parallel, body: html`${hours}${field ? panel("Every session", field) : null}`, tip: tryThis(tips.parallel, actions) });
}

export function coverageChapter({ context, story, tips, actions, index }: ChapterInput): SafeHtml | null {
  const { report } = context;
  const coverage = report.coverage ?? [];
  const found = coverage.filter((entry) => entry.found);
  const missing = coverage.filter((entry) => !entry.found);
  const split = splitBar(
    "harness",
    (report.activity.byHarness ?? []).map((entry) => ({ label: harnessLabel(entry.harness), value: count(entry.sessions), display: plural(count(entry.sessions), "session") })),
  );
  const rows = found.map((entry) => {
    const oldest = parseInstant(entry.oldest);
    const newest = parseInstant(entry.newest);
    const days = oldest !== null && newest !== null ? Math.max(1, Math.round((newest - oldest) / 86_400_000) + 1) : null;
    return html`<li><b>${entry.label || harnessLabel(entry.harness)}</b><span>${plural(count(entry.sessions), "session")}</span><span>${days !== null ? `${plural(days, "day")} back, to ${formatDate(entry.oldest, context.zone)}` : "—"}</span><span>${typeof entry.bytes === "number" && Number.isFinite(entry.bytes) && entry.bytes > 0 ? html`On disk ${formatBytes(entry.bytes)}` : ""}</span>${count(entry.issues) > 0 ? html`<span class="muted">${plural(count(entry.issues), "record")} skipped</span>` : html`<span></span>`}</li>`;
  });
  const tools = html`${split}${rows.length > 0 ? html`<ul class="sources-list">${rows}</ul>` : html`<p class="muted">No coding-agent history was found on this machine.</p>`}${
    missing.length > 0 ? html`<p class="not-found micro"><span>Not found</span>${missing.map((entry) => html`<span class="chip">${entry.label || harnessLabel(entry.harness)}</span>`)}</p>` : null
  }`;
  const projects = pixelBars(
    "projects",
    (report.activity.projects ?? []).map((entry) => {
      const label = clip(shortenPath(String(entry.projectPath ?? "")), 60);
      return { label, title: label, value: count(entry.activeMinutes) || count(entry.sessions), display: plural(count(entry.sessions), "session") };
    }),
    8,
    { mono: true },
  );
  const languages = pixelBars(
    "languages",
    (report.activity.languages ?? []).map((entry) => ({ label: clip(String(entry.key), 40), value: count(entry.count), display: formatCompact(count(entry.count)) })),
    8,
  );
  const body = html`${panel("Tools found", tools, { aside: "home folder shown as ~" })}<div class="row">${panel("Projects", projects, { aside: "by agent time" })}${panel("Languages", languages, { aside: "file-tool calls" })}</div>`;
  return chapter({ id: "coverage", index, kicker: "Where your work lives", lead: story.where ?? [{ text: "No coding-agent history was found on this machine yet." }], second: story.history, body, tip: tryThis(tips.coverage, actions) });
}

function costCell(row: UsageTotals): string {
  const cost = typeof row.estimatedUsd === "number" && Number.isFinite(row.estimatedUsd) ? row.estimatedUsd : null;
  if (cost === null) return "Unpriced";
  return count(row.unpriced) > 0 ? `${formatUsd(cost)} + unpriced` : formatUsd(cost);
}

export function usageChapter({ context, story, tips, actions, index }: ChapterInput): SafeHtml | null {
  const { usage } = context.report;
  if (!story.tokens) return null;
  const usd = typeof usage.estimatedUsd === "number" && Number.isFinite(usage.estimatedUsd) ? usage.estimatedUsd : null;
  const gap = pricingGap(context.report);
  const costLabel = usd === null ? "no known price" : gap ? `≈ ${formatUsd(usd)} for the ${Math.round(gap.pricedShare * 100)}% priced` : `≈ ${formatUsd(usd)} at API list prices`;
  const flow = tokenFlow(
    count(usage.tokens),
    [
      { key: "cached", label: "Read from cache", value: count(usage.cachedInput), note: "context re-read at a fraction of the price" },
      { key: "input", label: "Fresh input", value: count(usage.input), note: "context sent in full" },
      { key: "write", label: "Written to cache", value: count(usage.cacheWrite), note: "stored so the next turn can reuse it" },
      { key: "output", label: "Output", value: count(usage.output), note: "what the models wrote" },
    ],
    costLabel,
  );

  const daily = usage.daily ?? [];
  const byDay = new Map<number, (typeof daily)[number]>();
  for (const entry of daily) {
    const day = dayNumber(entry.day);
    if (day !== null) byDay.set(day, entry);
  }
  const days = denseDays(daily.map((entry) => ({ day: entry.day, value: count(entry.tokens) })), MAX_DAYS);
  const pick = (key: "cachedInput" | "input" | "cacheWrite" | "output") => days.map((entry) => count(byDay.get(entry.day)?.[key]));
  const cached = pick("cachedInput");
  const fresh = pick("input");
  const write = pick("cacheWrite");
  const output = pick("output");
  const chart =
    days.length > 0
      ? columnChart({
          id: "daily-tokens",
          series: [
            { className: "s1", label: "Read from cache", values: cached },
            { className: "s2", label: "Fresh input and cache writes", values: fresh.map((value, i) => value + (write[i] ?? 0)) },
            { className: "s3", label: "Output", values: output },
          ],
          xTicks: monthTicks(days[0]!.day, days.length),
          yTitle: "Tokens per day",
          xTitle: "Day",
          tooltips: days.map((entry, i) => `${formatDay(entry.day, { weekday: "short", month: "short", day: "numeric" })}: ${formatCompact(entry.value)} tokens, ${formatCompact(output[i] ?? 0)} output`),
          ariaLabel: "Tokens per day by kind",
          emptyMessage: "No token usage recorded yet.",
        })
      : null;

  const models = [...(usage.models ?? [])].sort((a, b) => count(b.tokens) - count(a.tokens)).slice(0, 12);
  const table =
    models.length > 0
      ? html`<div class="table-wrap" data-chart="models"><table><thead><tr><th scope="col">Model</th><th scope="col">Tool</th><th scope="col">Requests</th><th scope="col">Tokens</th><th scope="col">Output</th><th scope="col">Est. cost</th></tr></thead><tbody>${models.map(
          (row) => html`<tr${count(row.unpriced) > 0 ? html` class="unpriced"` : null}><td class="model">${clip(String(row.model), 60)}</td><td>${harnessLabel(row.harness)}</td><td>${formatInt(row.requests)}</td><td>${formatCompact(row.tokens)}</td><td>${formatCompact(row.output)}</td><td>${costCell(row)}</td></tr>`,
        )}</tbody></table></div>`
      : null;
  const pricing = clip(String(usage.pricingVersion ?? ""), 40);
  const note = html`<p class="note">All costs are estimated at API list prices${pricing ? ` (pricing table ${pricing})` : ""}; a subscription bills differently.${
    gap
      ? html` <b>${Math.round(gap.unpricedShare * 100)}% of requests (${formatInt(count(usage.unpriced))}) have no known price</b>${gap.models.length > 0 ? html`: ${unpricedModelsText(gap.models, 6)}` : null}. They are left out of the estimate, not counted as free, so the real figure is higher.`
      : null
  }</p>`;
  const body = html`${panel("Where the tokens went", flow)}${panel("Day by day", chart)}${panel("By model", table ? html`${table}${note}` : note)}`;
  return chapter({ id: "usage", index, kicker: "What it cost", lead: story.tokens, second: story.cost, body, tip: tryThis(tips.usage, actions) });
}
