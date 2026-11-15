import { formatCompact, formatDate, formatHours, formatInt, formatUsd, parseInstant, plural, count, clip, dayNumber, dayFromNumber } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel } from "../labels.js";
import { tiles, type RenderContext } from "../components.js";

export interface NavItem {
  id: string;
  label: string;
}

/** First and last instant covered, falling back to the daily buckets when `range` is empty. */
export function reportRange(context: RenderContext): { from: string | null; to: string | null } {
  const { report } = context;
  let from = parseInstant(report.range?.from) !== null ? report.range.from : null;
  let to = parseInstant(report.range?.to) !== null ? report.range.to : null;
  const days = (report.activity?.daily ?? []).map((entry) => dayNumber(entry.day)).filter((day): day is number => day !== null);
  if (!from && days.length > 0) from = `${dayFromNumber(Math.min(...days))}T12:00:00Z`;
  if (!to && days.length > 0) to = `${dayFromNumber(Math.max(...days))}T12:00:00Z`;
  return { from, to };
}

export function rangeText(context: RenderContext): string | null {
  const { from, to } = reportRange(context);
  const end = formatDate(to, context.zone);
  const start = formatDate(from, context.zone);
  if (!start || !end) return start ?? end;
  if (start === end) return end;
  const sameYear = start.slice(-4) === end.slice(-4);
  return `${sameYear ? start.replace(/, \d{4}$/, "") : start} – ${end}`;
}

function summaryLine(context: RenderContext): string {
  const { activity } = context.report;
  const sessions = count(activity.sessions);
  if (sessions === 0) return "Hindsight did not find any coding-agent history on this machine yet. Use your agents for a while, then run it again.";
  const harnesses = activity.byHarness.filter((entry) => count(entry.sessions) > 0).map((entry) => harnessLabel(entry.harness));
  const across = harnesses.length === 0 ? "" : harnesses.length === 1 ? ` in ${harnesses[0]}` : ` across ${harnesses.slice(0, -1).join(", ")} and ${harnesses[harnesses.length - 1]}`;
  return `${plural(sessions, "session")}${across} on ${plural(count(activity.activeDays), "active day")}, with ${formatHours(activity.totalActiveMinutes)} of hands-on time.`;
}

export function overviewSection(context: RenderContext, nav: NavItem[]): SafeHtml {
  const { report } = context;
  const { activity, usage } = report;
  const range = rangeText(context);
  const generated = formatDate(report.generatedAt, context.zone);
  const headline = report.narrative?.headline ? clip(report.narrative.headline, 900) : null;

  const items = [
    { value: formatInt(activity.sessions), label: "Sessions", sub: plural(count(activity.activeDays), "active day") },
    { value: formatHours(activity.totalActiveMinutes), label: "Active time", sub: `Longest streak ${plural(count(activity.longestStreakDays), "day")}` },
    { value: formatInt(activity.userMessages), label: "Messages you sent", sub: `${formatCompact(activity.assistantMessages)} agent replies` },
    { value: `+${formatCompact(activity.linesAdded)}`, label: "Lines added", sub: `−${formatCompact(activity.linesRemoved)} removed, ${plural(count(activity.filesModified), "file")}` },
    { value: formatInt(activity.gitCommits), label: "Commits" },
    { value: formatCompact(usage.tokens), label: "Tokens", sub: `${formatCompact(usage.requests)} model requests` },
    { value: formatUsd(usage.estimatedUsd), label: "Estimated cost", sub: "at API list prices" },
  ];

  return html`<section id="overview" class="masthead" aria-label="Overview">
<div class="brand"><span><b>Hindsight</b> · a look back at how you work with AI coding agents</span>${generated ? html`<span>Generated ${generated}</span>` : null}</div>
<div class="eyebrow">Your agent history</div>
<h1>${range ?? "No history yet"}</h1>
${headline ? html`<p class="lead">${headline}</p><p class="lead small" style="margin-top:12px">${summaryLine(context)}</p>` : html`<p class="lead">${summaryLine(context)}</p>`}
${tiles(items, "Headline numbers")}
${nav.length > 0 ? html`<nav class="toc" aria-label="Sections">${nav.map((item) => html`<a href="#${item.id}">${item.label}</a>`)}</nav>` : null}
</section>`;
}
