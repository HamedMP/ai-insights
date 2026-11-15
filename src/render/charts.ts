import { count, dayFromNumber, formatCompact, formatDay, formatInt } from "./format.js";
import { html, raw, type SafeHtml } from "./html.js";

/**
 * Charts are drawn here as inline SVG or plain HTML. Axis text lives in HTML,
 * not inside a scaled SVG, so it stays readable at phone width.
 */

const MAX_TOOLTIP_COLUMNS = 400;

export function emptyChart(id: string, message: string): SafeHtml {
  return html`<div class="chart-empty" data-chart="${id}">${message}</div>`;
}

/** 1, 2, 5 x 10^k steps so axis labels are round numbers. */
export function niceScale(max: number, targetTicks = 4): { top: number; ticks: number[] } {
  const value = Math.max(count(max), 1);
  const rough = value / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const top = Math.ceil(value / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + step / 2; tick += step) ticks.push(tick);
  return { top, ticks };
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export interface Series {
  /** CSS class that colours the series; one of s1..s3. */
  className: string;
  label: string;
  values: number[];
}

export interface ColumnChartOptions {
  id: string;
  /** Bottom-to-top stack order. */
  series: Series[];
  xTicks: Array<{ index: number; text: string }>;
  yTitle: string;
  xTitle: string;
  /** One line per column for the hover tooltip. */
  tooltips?: string[];
  ariaLabel: string;
  formatTick?: (value: number) => string;
  emptyMessage: string;
  tall?: boolean;
}

export function columnChart(options: ColumnChartOptions): SafeHtml {
  const columns = Math.max(0, ...options.series.map((series) => series.values.length));
  const totals = Array.from({ length: columns }, (_, index) =>
    options.series.reduce((sum, series) => sum + count(series.values[index]), 0),
  );
  const max = Math.max(0, ...totals);
  if (columns === 0 || max <= 0) return emptyChart(options.id, options.emptyMessage);

  const { top, ticks } = niceScale(max);
  const unit = 10;
  const gap = columns > 120 ? 1.5 : columns > 40 ? 2.5 : 3;
  const width = columns * unit;
  const format = options.formatTick ?? formatCompact;

  const grid = ticks
    .map((tick) => {
      const y = 100 - (tick / top) * 100;
      return `<line class="gl${tick === 0 ? " base" : ""}" x1="0" x2="${width}" y1="${y}" y2="${y}" vector-effect="non-scaling-stroke"/>`;
    })
    .join("");

  const stacks = new Array<number>(columns).fill(0);
  const groups = options.series
    .map((series) => {
      const rects: string[] = [];
      for (let index = 0; index < columns; index += 1) {
        const value = count(series.values[index]);
        if (value <= 0) continue;
        let height = (value / top) * 100;
        const base = stacks[index]!;
        if (base === 0) height = Math.max(height, 0.8);
        stacks[index] = base + height;
        const y = 100 - base - height;
        rects.push(`<rect x="${index * unit + gap / 2}" y="${round(y)}" width="${unit - gap}" height="${round(height)}"/>`);
      }
      return `<g class="${series.className}">${rects.join("")}</g>`;
    })
    .join("");

  const tooltips = options.tooltips && columns <= MAX_TOOLTIP_COLUMNS ? options.tooltips : null;
  const hits = tooltips
    ? `<g class="hits">${tooltips
        .slice(0, columns)
        .map((tip, index) => html`<rect x="${index * unit}" y="0" width="${unit}" height="100"><title>${tip}</title></rect>`.value)
        .join("")}</g>`
    : "";

  const yLabels = ticks.map((tick) => html`<span style="bottom:${pct(tick / top)}">${format(tick)}</span>`);
  const xLabels = options.xTicks
    .filter((tick) => tick.index >= 0 && tick.index < columns)
    .map((tick) => html`<span style="left:${pct((tick.index + 0.5) / columns)}">${tick.text}</span>`);

  const legend =
    options.series.length > 1
      ? html`<div class="legend">${options.series.map((series) => html`<span><i class="key ${series.className}"></i>${series.label}</span>`)}</div>`
      : null;

  return html`<figure class="col-chart${options.tall ? " tall" : ""}">
<div class="y-title">${options.yTitle}</div>
<div class="col-body">
<div class="y-axis" aria-hidden="true">${yLabels}</div>
<div class="plot">
<svg data-chart="${options.id}" viewBox="0 0 ${width} 100" preserveAspectRatio="none" role="img" aria-label="${options.ariaLabel}">${raw(grid)}${raw(groups)}${raw(hits)}</svg>
<div class="x-axis" aria-hidden="true">${xLabels}</div>
</div>
</div>
<figcaption class="x-title">${options.xTitle}</figcaption>
${legend}
</figure>`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface BarItem {
  label: string;
  value: number;
  /** Shown on hover, e.g. a full path behind a shortened label. */
  title?: string;
  /** Pre-formatted value text; defaults to the integer value. */
  display?: string;
}

export function barList(id: string, items: BarItem[], options: { limit: number; emptyMessage: string; mono?: boolean }): SafeHtml {
  const rows = items.filter((item) => count(item.value) > 0).slice(0, options.limit);
  if (rows.length === 0) return emptyChart(id, options.emptyMessage);
  const max = Math.max(...rows.map((row) => count(row.value)));
  const hidden = items.filter((item) => count(item.value) > 0).length - rows.length;
  return html`<ol class="bars${options.mono ? " mono" : ""}" data-chart="${id}">${rows.map(
    (row) => html`<li><span class="bar-label" title="${row.title ?? row.label}">${row.label}</span><span class="bar-track"><span class="bar-fill" style="width:${pct(count(row.value) / max)}"></span></span><span class="bar-value">${row.display ?? formatInt(row.value)}</span></li>`,
  )}</ol>${hidden > 0 ? html`<p class="more">and ${formatInt(hidden)} more</p>` : null}`;
}

/** A single 100% bar for ordered judgements (best first), with a legend. */
export function compositionBar(id: string, items: BarItem[], emptyMessage: string): SafeHtml {
  const rows = items.filter((item) => count(item.value) > 0);
  const total = rows.reduce((sum, row) => sum + count(row.value), 0);
  if (total <= 0) return emptyChart(id, emptyMessage);
  return html`<div class="composition" data-chart="${id}">
<div class="comp-bar" role="img" aria-label="${rows.map((row) => `${row.label}: ${formatInt(row.value)}`).join(", ")}">${rows.map(
    (row, index) => html`<span class="q${Math.min(index, 4)}" style="width:${pct(count(row.value) / total)}" title="${row.label}: ${formatInt(row.value)}"></span>`,
  )}</div>
<ul class="comp-legend">${rows.map(
    (row, index) => html`<li><i class="key q${Math.min(index, 4)}"></i>${row.label} <b>${formatInt(row.value)}</b> <span class="muted">${pct(count(row.value) / total)}</span></li>`,
  )}</ul>
</div>`;
}

export interface HeatmapDay {
  day: number;
  value: number;
  tooltip: string;
}

/**
 * GitHub-style calendar: one column per week, Monday at the top. Shows at most
 * the last 53 weeks so a multi-year history stays small.
 */
export function calendarHeatmap(id: string, days: HeatmapDay[], options: { emptyMessage: string; unit: string }): SafeHtml {
  const active = days.filter((entry) => count(entry.value) > 0);
  if (active.length === 0) return emptyChart(id, options.emptyMessage);
  const byDay = new Map(days.map((entry) => [entry.day, entry]));
  const last = Math.max(...days.map((entry) => entry.day));
  const first = Math.max(Math.min(...days.map((entry) => entry.day)), last - 52 * 7 - weekday(last));
  const start = first - weekday(first);
  const weeks = Math.floor((last - start) / 7) + 1;

  const sorted = active.map((entry) => count(entry.value)).sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];
  const level = (value: number) => (value <= 0 ? 0 : value <= thresholds[0]! ? 1 : value <= thresholds[1]! ? 2 : value <= thresholds[2]! ? 3 : 4);

  const cell = 13;
  const step = 16;
  const left = 30;
  const topPad = 18;
  const width = left + weeks * step;
  const height = topPad + 7 * step;

  const cells: string[] = [];
  const months: string[] = [];
  let lastMonth = -1;
  let lastLabelWeek = -10;
  for (let week = 0; week < weeks; week += 1) {
    const weekStart = start + week * 7;
    const labelDay = Math.max(weekStart, first);
    const month = new Date(labelDay * 86_400_000).getUTCMonth();
    if (month !== lastMonth) {
      // A partial first month would collide with the next label; the full month wins.
      if (week < weeks - 1) {
        if (week - lastLabelWeek < 3) months.pop();
        months.push(html`<text class="axis" x="${left + week * step}" y="11">${formatDay(labelDay, { month: "short" })}</text>`.value);
        lastLabelWeek = week;
      }
      lastMonth = month;
    }
    for (let dow = 0; dow < 7; dow += 1) {
      const day = weekStart + dow;
      if (day < first || day > last) continue;
      const entry = byDay.get(day);
      const value = count(entry?.value);
      const tip = entry?.tooltip ?? `${formatDay(day, { month: "short", day: "numeric", year: "numeric" })}: no ${options.unit}`;
      cells.push(html`<rect class="h${level(value)}" x="${left + week * step}" y="${topPad + dow * step}" width="${cell}" height="${cell}" rx="2"><title>${tip}</title></rect>`.value);
    }
  }
  const labels = [
    [0, "Mon"],
    [2, "Wed"],
    [4, "Fri"],
  ]
    .map(([dow, text]) => `<text class="axis" x="0" y="${topPad + (dow as number) * step + 9}">${text}</text>`)
    .join("");

  const summary = `${formatInt(active.length)} active days between ${formatDay(first, { month: "short", day: "numeric", year: "numeric" })} and ${formatDay(last, { month: "short", day: "numeric", year: "numeric" })}`;
  return html`<figure class="heatmap">
<div class="scroll-x" data-scroll-end><svg data-chart="${id}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${summary}">${raw(months.join(""))}${raw(labels)}${raw(cells.join(""))}</svg></div>
<figcaption class="heat-legend"><span>${summary}</span><span class="scale">Less ${raw([0, 1, 2, 3, 4].map((n) => `<i class="key h${n}"></i>`).join(""))} More</span></figcaption>
</figure>`;
}

/** Monday = 0. Day 0 (1970-01-01) was a Thursday. */
export function weekday(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

/** Month-start ticks for a run of days, thinned so labels never collide. */
export function monthTicks(firstDay: number, columns: number): Array<{ index: number; text: string }> {
  const ticks: Array<{ index: number; text: string }> = [];
  for (let index = 0; index < columns; index += 1) {
    const day = firstDay + index;
    if (dayFromNumber(day).endsWith("-01")) ticks.push({ index, text: formatDay(day, { month: "short" }) });
  }
  if (ticks.length === 0 && columns > 0) {
    ticks.push({ index: 0, text: formatDay(firstDay) });
    if (columns > 6) ticks.push({ index: columns - 1, text: formatDay(firstDay + columns - 1) });
  }
  const stride = Math.ceil(ticks.length / 8);
  return ticks.filter((_, index) => index % stride === 0);
}

export function meter(ratio: number | null, label: string): SafeHtml {
  if (ratio === null || !Number.isFinite(ratio)) return html`<div class="meter empty" aria-label="${label}: unknown"><span></span></div>`;
  const clamped = Math.min(1, Math.max(0, ratio));
  return html`<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamped * 100)}" aria-label="${label}"><span style="width:${pct(clamped)}"></span></div>`;
}
