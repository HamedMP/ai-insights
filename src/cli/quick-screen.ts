import { isoInZone, type PeriodSummary } from "../analysis/periods.js";
import { isChatHarness } from "../schema/types.js";
import { formatUsd } from "../store/pipeline.js";
import { compact } from "./screen.js";
import { pad, painter, visibleWidth, wrapSegments, type Paint, type Style } from "./terminal.js";

/** How a quick view is drawn: what is shown, and the person's choices. */
export interface QuickScreen {
  title: string;
  summary: PeriodSummary;
  /** Rows of a --last or --since view, oldest first. */
  series?: { unit: "day" | "week" | "month"; rows: PeriodSummary[] };
  by: "project" | "model" | "agent";
  noCost: boolean;
  timeZone: string;
  now: number;
  reportPath: string | null;
}

export function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours >= 10 ? `${Math.round(hours)} h` : `${hours.toFixed(1)} h`;
}

/** Cost as people should read it: an estimate, never 0 or a guess for what was not measured or priced. */
export function costText(summary: Pick<PeriodSummary, "tokens" | "costUsd" | "requests" | "unpricedRequestShare" | "sessions">): string {
  if (summary.tokens === null) return "not measured";
  if (summary.costUsd === null) return summary.requests > 0 ? "unpriced" : summary.sessions > 0 ? "not measured" : "$0.00";
  const share = summary.unpricedRequestShare;
  const unpriced = share > 0 ? ` (${share < 0.01 ? "<1" : Math.round(share * 100)}% unpriced)` : "";
  return `${formatUsd(summary.costUsd)}${unpriced}`;
}

function rowCost(value: number | null, measured: boolean): string {
  if (!measured) return "not measured";
  return value === null ? "unpriced" : formatUsd(value);
}

function dayLabel(ms: number, timeZone: string, unit: "day" | "week" | "month"): string {
  const iso = isoInZone(ms, timeZone).slice(0, 10);
  if (unit === "month") return iso.slice(0, 7);
  const date = new Date(`${iso}T12:00:00Z`);
  const name = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return unit === "week" ? `wk of ${name}` : name;
}

function spanText(summary: PeriodSummary, timeZone: string, now: number): string {
  const from = isoInZone(summary.from, timeZone);
  const toMs = Math.min(summary.to, now);
  const to = isoInZone(toMs, timeZone);
  const same = from.slice(0, 10) === to.slice(0, 10);
  const fromDay = new Date(`${from.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (summary.to >= now) return same ? `${fromDay}, so far` : `${fromDay} to now`;
  const toDay = new Date(Date.parse(`${isoInZone(toMs - 1, timeZone).slice(0, 10)}T12:00:00Z`)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return same || fromDay === toDay ? fromDay : `${fromDay} to ${toDay}`;
}

type Align = "left" | "right";

/** A plain column table that fits `width`: the first column gives way first. */
function table(head: string[], rows: string[][], align: Align[], width: number, paint: Paint): string[] {
  const widths = head.map((cell, column) => Math.max(visibleWidth(cell), ...rows.map((row) => visibleWidth(row[column] ?? ""))));
  const gap = 2;
  const total = () => widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1) + 2;
  while (total() > width && widths[0]! > 8) widths[0]! -= 1;
  const fit = (text: string, column: number) => {
    const max = widths[column]!;
    const cut = visibleWidth(text) > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
    return align[column] === "right" ? " ".repeat(Math.max(0, max - visibleWidth(cut))) + cut : pad(cut, max);
  };
  const line = (cells: string[]) => `  ${cells.map((cell, column) => fit(cell, column)).join(" ".repeat(gap))}`.trimEnd();
  return [paint("muted", line(head)), ...rows.map(line)];
}

export function quickText(screen: QuickScreen, style: Style): string {
  const paint = painter(style);
  const width = Math.max(40, style.width);
  const { summary } = screen;
  const tipGlyph = style.unicode ? "✦" : "*";
  const lines: string[] = [];
  lines.push(`  ${paint("brand", screen.title, true)}  ${paint("muted", `${spanText(summary, screen.timeZone, screen.now)} · ${screen.timeZone}`)}`, "");

  // The tip comes first: it is what this tool is for. Cost is context.
  if (summary.tip) lines.push(...wrapSegments([{ text: "Tip", tone: "warn", bold: true, keep: true }, `  ${summary.tip.text}`], width - 2, style, `  ${paint("warn", tipGlyph)} `, "    "), "");
  else if (summary.sessions > 0) lines.push(`  ${paint("muted", `${tipGlyph} No tip for this period yet: tips come from patterns over several sessions.`)}`, "");

  const numbers = [`${summary.sessions.toLocaleString("en-US")} session${summary.sessions === 1 ? "" : "s"}`, `${minutesText(summary.activeMinutes)} active`, `${summary.prompts.toLocaleString("en-US")} prompt${summary.prompts === 1 ? "" : "s"}`];
  lines.push(`  ${numbers.join(paint("muted", style.unicode ? " · " : " - "))}`);
  const tokens = summary.tokens === null ? "tokens not measured (chat exports record none)" : `${compact(summary.tokens.total)} tokens`;
  const cost = costText(summary);
  // "$104 at API list prices (1% unpriced)": the note on what could not be priced reads last.
  const [amount, unpriced] = summary.costUsd !== null ? [cost.replace(/ \(.*\)$/u, ""), / \(.*\)$/u.exec(cost)?.[0] ?? ""] : [cost, ""];
  const priced = summary.costUsd !== null ? `${amount}${paint("muted", ` at API list prices${unpriced}`)}` : amount;
  lines.push(screen.noCost ? `  ${tokens}` : `  ${tokens}${paint("muted", style.unicode ? " · " : " - ")}${priced}`);

  if (screen.series && screen.series.rows.length > 1) {
    lines.push("");
    const unit = screen.series.unit;
    const head = [unit === "day" ? "Day" : unit === "week" ? "Week" : "Month", "Sessions", "Active", "Prompts", "Tokens", ...(screen.noCost ? [] : ["Cost"])];
    const rows = screen.series.rows.map((row) => [
      dayLabel(row.from, screen.timeZone, unit),
      String(row.sessions),
      minutesText(row.activeMinutes),
      String(row.prompts),
      row.tokens === null ? "-" : compact(row.tokens.total),
      ...(screen.noCost ? [] : [row.sessions === 0 && row.requests === 0 ? "-" : costText(row).replace(/ \(.*\)$/u, "")]),
    ]);
    lines.push(...table(head, rows, ["left", "right", "right", "right", "right", "right"], width, paint));
  }

  const breakdown = breakdownTable(screen, width, paint);
  if (breakdown.length) lines.push("", ...breakdown);
  if (screen.by !== "model" && summary.byModel.length) {
    const top = summary.byModel.slice(0, 3).map((row) => (screen.noCost || row.costUsd === null ? `${row.model} ${compact(row.tokens)}` : `${row.model} ${formatUsd(row.costUsd)}`));
    lines.push("", ...wrapSegments([{ text: "Models", tone: "muted", keep: true }, `  ${top.join(style.unicode ? " · " : ", ")}`], width - 2, style, "  ", "          "));
  }
  if (screen.reportPath) lines.push("", `  ${paint("muted", "Full report:")} ${screen.reportPath}`);
  else lines.push("", `  ${paint("muted", "Run ai-insights for the full report.")}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function breakdownTable(screen: QuickScreen, width: number, paint: Paint): string[] {
  const { summary, noCost } = screen;
  const costHead = noCost ? [] : ["Cost"];
  if (screen.by === "model") {
    if (!summary.byModel.length) return [];
    return table(["Model", "Tokens", ...costHead], summary.byModel.map((row) => [row.model, compact(row.tokens), ...(noCost ? [] : [rowCost(row.costUsd, true)])]), ["left", "right", "right"], width, paint);
  }
  if (screen.by === "project") {
    const rows = summary.byProject ?? [];
    if (!rows.length) return [];
    return table(["Project", "Sessions", "Active", ...costHead], rows.map((row) => [row.project, String(row.sessions), minutesText(row.activeMinutes), ...(noCost ? [] : [rowCost(row.costUsd, true)])]), ["left", "right", "right", "right"], width, paint);
  }
  if (!summary.byAgent.length) return [];
  return table(
    ["Agent", "Sessions", ...costHead],
    summary.byAgent.map((row) => [row.label, String(row.sessions), ...(noCost ? [] : [rowCost(row.costUsd, !isChatHarness(row.agent))])]),
    ["left", "right", "right"],
    width,
    paint,
  );
}

/** `summary` in the terminal: today, this week and this month side by side, then the tip. */
export function summaryText(periods: Array<{ title: string; summary: PeriodSummary }>, options: { noCost: boolean; timeZone: string; reportPath: string | null }, style: Style): string {
  const paint = painter(style);
  const width = Math.max(40, style.width);
  const head = ["", ...periods.map((period) => period.title)];
  const row = (label: string, value: (summary: PeriodSummary) => string) => [label, ...periods.map((period) => value(period.summary))];
  const rows = [
    row("Sessions", (s) => s.sessions.toLocaleString("en-US")),
    row("Active", (s) => minutesText(s.activeMinutes)),
    row("Prompts", (s) => s.prompts.toLocaleString("en-US")),
    row("Tokens", (s) => (s.tokens === null ? "not measured" : compact(s.tokens.total))),
    ...(options.noCost ? [] : [row("Cost", (s) => costText(s).replace(/ \(.*\)$/u, ""))]),
  ];
  const lines = [`  ${paint("brand", "AI Insights", true)}  ${paint("muted", options.timeZone)}`, ""];
  const tip = periods.map((period) => period.summary.tip).find((value) => value !== null);
  if (tip) lines.push(...wrapSegments([{ text: "Tip", tone: "warn", bold: true, keep: true }, `  ${tip.text}`], width - 2, style, `  ${paint("warn", style.unicode ? "✦" : "*")} `, "    "), "");
  lines.push(...table(head, rows, ["left", "right", "right", "right"], width, paint));
  const unpriced = periods.find((period) => period.summary.unpricedRequestShare > 0);
  if (!options.noCost) lines.push("", `  ${paint("muted", `Cost is an estimate at API list prices${unpriced ? `; ${Math.max(1, Math.round(unpriced.summary.unpricedRequestShare * 100))}% of ${unpriced.title.toLowerCase()}'s requests could not be priced` : ""}.`)}`);
  if (options.reportPath) lines.push(`  ${paint("muted", "Full report:")} ${options.reportPath}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
