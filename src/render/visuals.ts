import { clip, count, dayNumber, formatCompact, formatDay, formatInt, plural } from "./format.js";
import { html, raw, type SafeHtml } from "./html.js";
import { weekday } from "./charts.js";

/**
 * Bespoke visuals, one per message. The pixel is the motif: activity, sessions,
 * tool calls and errors are all drawn as squares. Labels that must stay legible
 * are HTML; SVG holds only shapes, or text at a fixed, unscaled size.
 */

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pctText(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export interface DayValue {
  day: number;
  value: number;
  tooltip?: string;
}

/** Five intensity levels from quartiles of the non-zero values; the single busiest day gets its own. */
function levels(values: number[]): (value: number) => number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const [t1, t2, t3] = [q(0.25), q(0.5), q(0.75)];
  const max = sorted[sorted.length - 1]!;
  return (value) => (value <= 0 ? 0 : value >= max && sorted.length > 3 ? 5 : value <= t1 ? 1 : value <= t2 ? 2 : value <= t3 ? 3 : 4);
}

/** Dense day series from sparse buckets, capped to the newest `maxDays`. */
export function denseDays(entries: Array<{ day: string; value: number; tooltip?: string }>, maxDays: number): DayValue[] {
  const byDay = new Map<number, { value: number; tooltip?: string }>();
  for (const entry of entries) {
    const day = dayNumber(entry.day);
    if (day !== null) byDay.set(day, { value: count(entry.value), ...(entry.tooltip ? { tooltip: entry.tooltip } : {}) });
  }
  if (byDay.size === 0) return [];
  const last = Math.max(...byDay.keys());
  const first = Math.max(Math.min(...byDay.keys()), last - maxDays + 1);
  const out: DayValue[] = [];
  for (let day = first; day <= last; day += 1) {
    const entry = byDay.get(day);
    out.push({ day, value: entry?.value ?? 0, ...(entry?.tooltip ? { tooltip: entry.tooltip } : {}) });
  }
  return out;
}

/**
 * The first-screen art: every day as a big pixel, one column per week, Monday on
 * top. Long histories wrap into bands so the block keeps a strong shape.
 */
export function pixelHero(days: DayValue[]): SafeHtml | null {
  if (!days.some((entry) => entry.value > 0)) return null;
  const first = days[0]!.day;
  const last = days[days.length - 1]!.day;
  const start = first - weekday(first);
  const weeks = Math.floor((last - start) / 7) + 1;
  const bands = Math.ceil(weeks / 27);
  const perBand = Math.ceil(weeks / bands);
  const rows = bands * 7 + (bands - 1);
  const cell = Math.max(8, Math.min(46, Math.floor(440 / perBand), Math.floor(320 / rows)));
  const gap = Math.max(2, Math.round(cell * 0.16));
  const size = cell - gap;
  const level = levels(days.map((entry) => entry.value));
  const byDay = new Map(days.map((entry) => [entry.day, entry]));
  const groups: string[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const band = Math.floor(week / perBand);
    const column = week % perBand;
    const rects: string[] = [];
    for (let dow = 0; dow < 7; dow += 1) {
      const day = start + week * 7 + dow;
      if (day < first || day > last) continue;
      const value = byDay.get(day)?.value ?? 0;
      rects.push(`<rect class="p${level(value)}" x="${column * cell}" y="${(band * 8 + dow) * cell}" width="${size}" height="${size}"/>`);
    }
    groups.push(`<g style="--w:${week}">${rects.join("")}</g>`);
  }
  const width = perBand * cell - gap;
  const height = rows * cell - gap;
  const active = days.filter((entry) => entry.value > 0).length;
  return html`<figure class="hero-art"><svg class="px-hero" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${`${plural(active, "active day")} out of ${plural(days.length, "day")}, one square per day`}">${raw(groups.join(""))}</svg>
<figcaption class="micro">One square per day · brighter means more sessions</figcaption></figure>`;
}

/** A labelled calendar for the rhythm chapter: weeks as columns, months on top, hover for the day. */
export function dayGrid(id: string, days: DayValue[], unit: string): SafeHtml | null {
  if (!days.some((entry) => entry.value > 0)) return null;
  const first = days[0]!.day;
  const last = days[days.length - 1]!.day;
  const start = first - weekday(first);
  const weeks = Math.floor((last - start) / 7) + 1;
  const cell = 14;
  const size = 11;
  const left = 28;
  const top = 18;
  const level = levels(days.map((entry) => entry.value));
  const byDay = new Map(days.map((entry) => [entry.day, entry]));
  const parts: string[] = [];
  let lastMonth = -1;
  let lastLabel = -10;
  for (let week = 0; week < weeks; week += 1) {
    const labelDay = Math.max(start + week * 7, first);
    const month = new Date(labelDay * 86_400_000).getUTCMonth();
    if (month !== lastMonth && week < weeks - 1) {
      if (week - lastLabel < 3 && parts.length > 0 && parts[parts.length - 1]!.startsWith("<text")) parts.pop();
      parts.push(`<text class="lbl" x="${left + week * cell}" y="11">${formatDay(labelDay, { month: "short" })}</text>`);
      lastLabel = week;
      lastMonth = month;
    }
    for (let dow = 0; dow < 7; dow += 1) {
      const day = start + week * 7 + dow;
      if (day < first || day > last) continue;
      const entry = byDay.get(day);
      const tip = entry?.tooltip ?? `${formatDay(day, { weekday: "short", month: "short", day: "numeric" })}: no ${unit}`;
      parts.push(html`<rect class="p${level(entry?.value ?? 0)}" x="${left + week * cell}" y="${top + dow * cell}" width="${size}" height="${size}" rx="1.5"><title>${tip}</title></rect>`.value);
    }
  }
  for (const [dow, text] of [[0, "Mon"], [2, "Wed"], [4, "Fri"], [6, "Sun"]] as const) parts.push(`<text class="lbl" x="0" y="${top + dow * cell + 9}">${text}</text>`);
  const width = left + weeks * cell;
  const height = top + 7 * cell;
  return html`<div class="scroll-x" data-scroll-end><svg class="day-grid" data-chart="${id}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${`Calendar of ${unit} per day`}">${raw(parts.join(""))}</svg></div>`;
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [r2(cx + radius * Math.cos(angle)), r2(cy + radius * Math.sin(angle))];
}

/** The day as a clock: one wedge per hour, midnight at the top, the busiest window lit. */
export function hourClock(hours: number[], peak: { start: number; width: number } | null, zone: string): SafeHtml | null {
  const values = Array.from({ length: 24 }, (_, hour) => count(hours[hour]));
  const max = Math.max(...values);
  if (max <= 0) return null;
  const c = 150;
  const inner = 56;
  const outer = 132;
  const step = (Math.PI * 2) / 24;
  const inPeak = (hour: number) => !!peak && (hour - peak.start + 24) % 24 < peak.width;
  const wedges = values.map((value, hour) => {
    const length = value > 0 ? 6 + (Math.sqrt(value / max) * (outer - inner - 6)) : 3;
    const a0 = hour * step - Math.PI / 2 + step * 0.12;
    const a1 = (hour + 1) * step - Math.PI / 2 - step * 0.12;
    const [x0, y0] = polar(c, c, inner, a0);
    const [x1, y1] = polar(c, c, inner + length, a0);
    const [x2, y2] = polar(c, c, inner + length, a1);
    const [x3, y3] = polar(c, c, inner, a1);
    const r = inner + length;
    const cls = value === 0 ? "p0" : inPeak(hour) ? "p4" : "p2";
    const label = `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00: ${plural(value, "message")}`;
    return html`<path class="${cls}" d="M${x0} ${y0}L${x1} ${y1}A${r2(r)} ${r2(r)} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${inner} ${inner} 0 0 0 ${x0} ${y0}Z" style="--h:${hour}"><title>${label}</title></path>`.value;
  });
  const ticks = [0, 6, 12, 18]
    .map((hour) => {
      const [x, y] = polar(c, c, outer + 12, hour * step - Math.PI / 2);
      return `<text class="lbl" x="${x}" y="${r2(y + 4)}" text-anchor="middle">${String(hour).padStart(2, "0")}</text>`;
    })
    .join("");
  const ring = `<circle class="ring" cx="${c}" cy="${c}" r="${inner - 6}"/>`;
  const center = peak
    ? html`<text class="clock-big" x="${c}" y="${c + 2}" text-anchor="middle">${String(peak.start).padStart(2, "0")}–${String((peak.start + peak.width) % 24).padStart(2, "0")}</text><text class="lbl" x="${c}" y="${c + 22}" text-anchor="middle">busiest</text>`
    : html``;
  return html`<figure class="viz clock"><svg data-chart="hours" viewBox="-6 -6 312 312" role="img" aria-label="${`Messages you sent by hour of day, ${zone}`}">${raw(ring)}${raw(wedges.join(""))}${raw(ticks)}${center}</svg>
<figcaption class="micro">Hour of day · ${zone}</figcaption></figure>`;
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Sessions per weekday as stacks of pixels; the busiest day lit. */
export function weekStacks(totals: number[]): SafeHtml | null {
  const max = Math.max(...totals);
  if (max <= 0) return null;
  const maxRows = 12;
  const unit = Math.max(1, Math.ceil(max / maxRows));
  const cell = 16;
  const gap = 4;
  const colWidth = 30;
  const height = maxRows * cell;
  const busiest = totals.indexOf(max);
  const cols = totals.map((total, index) => {
    const pixels = Math.ceil(total / unit);
    const x = index * colWidth + (index >= 5 ? 8 : 0);
    const rects: string[] = [];
    for (let row = 0; row < pixels; row += 1) {
      rects.push(`<rect x="${x}" y="${height - (row + 1) * cell}" width="${cell - gap}" height="${cell - gap}"/>`);
    }
    const cls = index === busiest ? "p4" : index >= 5 ? "p2" : "p3";
    return html`<g class="${cls}" style="--w:${index}"><title>${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][index]}: ${plural(total, "session")}</title>${raw(rects.join(""))}</g><text class="lbl" x="${x + (cell - gap) / 2}" y="${height + 16}" text-anchor="middle">${DAY_LETTERS[index]}</text>`.value;
  });
  const width = 6 * colWidth + 8 + cell - gap;
  return html`<figure class="viz week"><svg data-chart="weekdays" viewBox="0 0 ${width} ${height + 20}" role="img" aria-label="Sessions by day of the week">${raw(cols.join(""))}</svg>
<figcaption class="micro">Sessions by weekday · 1 square = ${plural(unit, "session")}</figcaption></figure>`;
}

/** One message in, many agent steps out. */
export function delegationFan(steps: number): SafeHtml {
  const shown = Math.max(1, Math.min(64, Math.round(steps)));
  const perRow = 8;
  const cell = 14;
  const size = 11;
  const gridX = 150;
  const rows = Math.ceil(shown / perRow);
  const height = Math.max(64, rows * cell + 8);
  const midY = height / 2;
  const gridTop = (height - rows * cell) / 2;
  const squares: string[] = [];
  for (let index = 0; index < shown; index += 1) {
    squares.push(`<rect class="p3" x="${gridX + (index % perRow) * cell}" y="${r2(gridTop + Math.floor(index / perRow) * cell)}" width="${size}" height="${size}" style="--i:${index}"/>`);
  }
  const lines: string[] = [];
  const fanTargets = Math.min(rows, 6);
  for (let index = 0; index < fanTargets; index += 1) {
    const y = r2(gridTop + (rows === 1 ? 0.5 : index / Math.max(1, fanTargets - 1)) * (rows * cell - cell) + size / 2);
    lines.push(`<path class="fan" d="M44 ${r2(midY)}C96 ${r2(midY)} 100 ${y} ${gridX - 8} ${y}"/>`);
  }
  const more = Math.round(steps) > shown ? html`<text class="lbl" x="${gridX + perRow * cell + 4}" y="${r2(height - 4)}">+${formatInt(Math.round(steps) - shown)}</text>` : html``;
  return html`<figure class="viz fan-viz"><svg data-chart="delegation" viewBox="0 0 ${gridX + perRow * cell + 34} ${height}" role="img" aria-label="${`One message from you leads to about ${formatInt(steps)} agent steps`}">${raw(lines.join(""))}<rect class="p5" x="12" y="${r2(midY - 16)}" width="32" height="32"/>${raw(squares.join(""))}${more}</svg>
<figcaption class="micro"><span>1 message from you</span><span>≈ ${formatInt(steps)} agent steps</span></figcaption></figure>`;
}

export interface WaffleItem {
  label: string;
  value: number;
}

/** A 10×10 field of tool calls: what your agents spend their steps on. */
export function waffle(id: string, items: WaffleItem[], ariaLabel: string): SafeHtml | null {
  const rows = items.filter((item) => count(item.value) > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, item) => sum + count(item.value), 0);
  if (total <= 0) return null;
  const top = rows.slice(0, 4);
  const rest = rows.slice(4).reduce((sum, item) => sum + item.value, 0);
  const groups = rest > 0 ? [...top, { label: "Everything else", value: rest }] : top;
  // Largest remainder, so the hundred cells add up exactly.
  const exact = groups.map((group) => (group.value / total) * 100);
  const cells = exact.map(Math.floor);
  let left = 100 - cells.reduce((sum, value) => sum + value, 0);
  exact.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac).forEach(({ index }) => {
    if (left > 0) {
      cells[index]! += 1;
      left -= 1;
    }
  });
  const rects: string[] = [];
  let cursor = 0;
  cells.forEach((n, group) => {
    for (let k = 0; k < n; k += 1, cursor += 1) {
      rects.push(`<rect class="w${group}" x="${(cursor % 10) * 18}" y="${Math.floor(cursor / 10) * 18}" width="15" height="15"/>`);
    }
  });
  return html`<figure class="viz waffle"><svg data-chart="${id}" viewBox="0 0 177 177" role="img" aria-label="${ariaLabel}">${raw(rects.join(""))}</svg>
<ul class="legend-list">${groups.map(
    (group, index) => html`<li><i class="sw w${index}"></i><span>${group.label}</span><b>${pctText(group.value / total)}</b></li>`,
  )}</ul></figure>`;
}

/** Response times as columns of dots, one column per bucket. */
export function dotColumns(id: string, buckets: Array<{ key: string; count: number }>, ariaLabel: string): SafeHtml | null {
  const rows = buckets.filter((bucket) => typeof bucket.key === "string").slice(0, 8);
  const max = Math.max(0, ...rows.map((bucket) => count(bucket.count)));
  if (max <= 0) return null;
  const maxDots = 10;
  const unit = Math.max(1, Math.ceil(max / maxDots));
  const colWidth = 48;
  const height = maxDots * 12;
  const peak = rows.findIndex((bucket) => count(bucket.count) === max);
  const cols = rows.map((bucket, index) => {
    const dots = Math.ceil(count(bucket.count) / unit);
    const cx = index * colWidth + colWidth / 2;
    const circles: string[] = [];
    for (let k = 0; k < dots; k += 1) circles.push(`<rect x="${cx - 4.5}" y="${height - (k + 1) * 12 + 1}" width="9" height="9" rx="4.5"/>`);
    return html`<g class="${index === peak ? "p4" : "p2"}"><title>${bucket.key}: ${plural(count(bucket.count), "turn")}</title>${raw(circles.join(""))}</g>`.value;
  });
  return html`<figure class="viz dots"><svg data-chart="${id}" viewBox="0 0 ${rows.length * colWidth} ${height}" preserveAspectRatio="xMidYMax meet" role="img" aria-label="${ariaLabel}">${raw(cols.join(""))}</svg>
<div class="dot-labels" style="grid-template-columns:repeat(${rows.length},1fr)">${rows.map((bucket) => html`<span>${bucket.key}</span>`)}</div></figure>`;
}

/** Every session as a square; lit squares ran alongside another session. */
export function sessionField(sessions: number, involved: number, maxConcurrent: number, overlapEvents = 0): SafeHtml | null {
  const total = count(sessions);
  if (total < 2) return null;
  const perCell = Math.max(1, Math.ceil(total / 300));
  const cells = Math.ceil(total / perCell);
  const lit = Math.min(cells, Math.round(count(involved) / perCell));
  const columns = Math.min(30, Math.max(10, Math.ceil(Math.sqrt(cells * 2.4))));
  const cell = 14;
  const rects: string[] = [];
  for (let index = 0; index < cells; index += 1) {
    rects.push(`<rect class="${index < lit ? "p4" : "p0"}" x="${(index % columns) * cell}" y="${Math.floor(index / columns) * cell}" width="11" height="11" style="--i:${index % 40}"/>`);
  }
  const height = Math.ceil(cells / columns) * cell;
  // Few sessions get bigger squares; hundreds keep 14px cells.
  const scale = cells <= 80 ? 2 : cells <= 200 ? 1.5 : 1.2;
  const tower = Math.min(24, count(maxConcurrent));
  const towerRects: string[] = [];
  for (let k = 0; k < tower; k += 1) towerRects.push(`<rect class="p5" x="0" y="${(tower - k - 1) * 14}" width="40" height="11" style="--i:${k}"/>`);
  return html`<div class="parallel-viz">
<figure class="viz field"><svg data-chart="parallel" viewBox="0 0 ${columns * cell - 3} ${height - 3}" width="${Math.round((columns * cell - 3) * scale)}" height="${Math.round((height - 3) * scale)}" role="img" aria-label="${`${formatInt(involved)} of ${formatInt(total)} sessions overlapped with another`}">${raw(rects.join(""))}</svg>
<figcaption class="micro">${perCell === 1 ? "One square per session" : `One square per ${formatInt(perCell)} sessions`} · lit squares overlapped with another session</figcaption></figure>
${tower > 0
    ? html`<figure class="viz tower"><svg viewBox="0 0 40 ${tower * 14 - 3}" role="img" aria-label="${`At most ${formatInt(maxConcurrent)} sessions ran at the same time`}">${raw(towerRects.join(""))}</svg><figcaption class="micro"><b>${formatInt(maxConcurrent)}</b> at once, at the peak</figcaption></figure>`
    : null}
${parallelFacts(total, involved, maxConcurrent, overlapEvents)}
</div>`;
}

/** The overlap counts as plain facts; they come from every session, not just the drawn ones. */
export function parallelFacts(sessions: number, involved: number, maxConcurrent: number, overlapEvents: number): SafeHtml {
  const total = count(sessions);
  return html`<dl class="facts parallel-facts"><dt>Sessions that overlapped</dt><dd>${formatInt(Math.min(count(involved), total))} <span>of ${formatInt(total)}</span></dd><dt>Times sessions overlapped</dt><dd>${formatInt(overlapEvents)}</dd><dt>Most at once</dt><dd>${formatInt(maxConcurrent)}</dd></dl>`;
}

export interface PixelBarItem {
  label: string;
  value: number;
  display: string;
  title?: string;
  /** A quiet aside after the label, such as a worktree count. */
  note?: string;
}

/** Ranked rows drawn as runs of pixels (a CSS gradient), sharing one scale. */
export function pixelBars(id: string, items: PixelBarItem[], limit: number, options: { mono?: boolean } = {}): SafeHtml | null {
  const rows = items.filter((item) => count(item.value) > 0).sort((a, b) => b.value - a.value);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, limit);
  const max = count(shown[0]!.value);
  return html`<ol class="px-bars${options.mono ? " mono" : ""}" data-chart="${id}">${shown.map(
    (row, index) => html`<li>${row.note ? html`<span class="px-label noted" title="${`${row.title ?? row.label} · ${row.note}`}"><span class="px-name">${row.label}</span><span class="px-note">· ${row.note}</span></span>` : html`<span class="px-label" title="${row.title ?? row.label}">${row.label}</span>`}<span class="px-track"><span class="px-run${index === 0 ? " lead" : ""}" style="width:${pctText(Math.max(0.015, count(row.value) / max))}"></span></span><span class="px-value">${row.display}</span></li>`,
  )}</ol>${rows.length > shown.length ? html`<p class="micro more">+ ${formatInt(rows.length - shown.length)} more</p>` : null}`;
}

/** One 100% bar in pixel runs, for a split between a few parts. */
export function splitBar(id: string, items: PixelBarItem[]): SafeHtml | null {
  const rows = items.filter((item) => count(item.value) > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, item) => sum + count(item.value), 0);
  if (total <= 0) return null;
  return html`<div class="split" data-chart="${id}"><div class="split-bar">${rows.map(
    (row, index) => html`<span class="px-run s${Math.min(index, 3)}" style="width:${pctText(count(row.value) / total)}" title="${row.label}: ${row.display}"></span>`,
  )}</div><ul class="legend-list inline">${rows.map((row, index) => html`<li><i class="sw s${Math.min(index, 3)}"></i><span>${row.label}</span><b>${pctText(count(row.value) / total)}</b></li>`)}</ul></div>`;
}

export interface FlowStream {
  key: string;
  label: string;
  value: number;
  note: string;
}

/**
 * Where the tokens went: one total on the left fanning into streams on the right.
 * Band thickness uses a square-root scale so a 97% stream does not erase the rest;
 * the exact numbers sit beside every band.
 */
export function tokenFlow(total: number, streams: FlowStream[], costLabel: string | null): SafeHtml | null {
  const rows = streams.filter((stream) => count(stream.value) > 0);
  const sum = rows.reduce((acc, stream) => acc + count(stream.value), 0);
  if (sum <= 0) return null;
  const rowHeight = 72;
  const height = rows.length * rowHeight;
  const roots = rows.map((stream) => Math.sqrt(count(stream.value)));
  const rootSum = roots.reduce((acc, value) => acc + value, 0);
  const span = Math.min(height - 24, rows.length * 46);
  const thickness = roots.map((value) => Math.max(3, (value / rootSum) * span));
  const leftTotal = thickness.reduce((acc, value) => acc + value, 0);
  let leftY = (height - leftTotal) / 2;
  const paths = rows.map((_, index) => {
    const t = thickness[index]!;
    const top = leftY;
    leftY += t;
    const rightMid = index * rowHeight + rowHeight / 2;
    const rTop = rightMid - Math.min(t, rowHeight - 14) / 2;
    const rBottom = rightMid + Math.min(t, rowHeight - 14) / 2;
    return `<path class="flow f${index}" d="M0 ${r2(top)}C50 ${r2(top)} 50 ${r2(rTop)} 100 ${r2(rTop)}L100 ${r2(rBottom)}C50 ${r2(rBottom)} 50 ${r2(top + t)} 0 ${r2(top + t)}Z"/>`;
  });
  return html`<div class="flow-viz" data-chart="token-flow" style="--rows:${rows.length}">
<div class="flow-total"><span class="flow-bar" style="height:${r2(leftTotal)}px"></span><div><b>${formatCompact(total)}</b><span class="micro">tokens</span>${costLabel ? html`<span class="flow-cost">${costLabel}</span>` : null}</div></div>
<svg class="flow-bands" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">${raw(paths.join(""))}</svg>
<ol class="flow-rows">${rows.map(
    (stream, index) => html`<li style="height:${rowHeight}px"><i class="sw f${index}"></i><div><b>${stream.label}</b><span class="flow-num">${formatCompact(stream.value)} · ${pctText(count(stream.value) / sum)}</span><span class="micro">${stream.note}</span></div></li>`,
  )}</ol>
</div>`;
}

export interface Island {
  label: string;
  value: number;
}

/** Friction map: each error kind is an island of pixels sized by how often it happened. */
export function frictionMap(id: string, islands: Island[]): SafeHtml | null {
  const rows = islands.filter((island) => count(island.value) > 0).sort((a, b) => b.value - a.value).slice(0, 9);
  if (rows.length === 0) return null;
  const max = count(rows[0]!.value);
  const maxCells = 144;
  const unit = Math.max(1, Math.ceil(max / maxCells));
  return html`<div class="islands" data-chart="${id}">${rows.map((island, index) => {
    const cells = Math.max(1, Math.round(count(island.value) / unit));
    const columns = Math.max(1, Math.ceil(Math.sqrt(cells)));
    const fullRows = Math.floor(cells / columns);
    const remainder = cells - fullRows * columns;
    return html`<figure class="island${index === 0 ? " lead" : ""}"><span class="island-px" style="--c:${columns};--r:${fullRows};--rem:${remainder}" title="${island.label}: ${formatInt(island.value)}"><span class="island-body"></span>${remainder > 0 ? html`<span class="island-tail"></span>` : null}</span><figcaption><b>${formatInt(island.value)}</b> ${clip(island.label, 40)}</figcaption></figure>`;
  })}<p class="micro islands-key">1 square = ${plural(unit, "error")}</p></div>`;
}


/**
 * Short histories: each day is a column of pixels, one square per few sessions.
 * Reads better than a calendar when there are only a few weeks to show.
 */
export function dayStacks(id: string, days: DayValue[]): SafeHtml | null {
  const max = Math.max(0, ...days.map((entry) => entry.value));
  if (days.length === 0 || max <= 0) return null;
  const maxRows = 8;
  const unit = Math.max(1, Math.ceil(max / maxRows));
  const cell = Math.max(10, Math.min(28, Math.floor(1040 / days.length)));
  const size = cell - Math.max(2, Math.round(cell * 0.18));
  const height = maxRows * cell;
  const level = levels(days.map((entry) => entry.value));
  const columns = days.map((entry, index) => {
    const pixels = entry.value > 0 ? Math.max(1, Math.ceil(entry.value / unit)) : 0;
    const x = index * cell;
    const rects: string[] = [];
    if (pixels === 0) rects.push(`<rect class="p0" x="${x}" y="${height - size}" width="${size}" height="${size}"/>`);
    for (let row = 0; row < pixels; row += 1) rects.push(`<rect x="${x}" y="${height - (row + 1) * cell + (cell - size)}" width="${size}" height="${size}"/>`);
    const tip = entry.tooltip ?? `${formatDay(entry.day, { weekday: "short", month: "short", day: "numeric" })}: ${plural(entry.value, "session")}`;
    return html`<g class="p${Math.max(2, level(entry.value))}" style="--w:${index}"><title>${tip}</title>${raw(rects.join(""))}</g>`.value;
  });
  const width = days.length * cell - (cell - size);
  const labels: Array<{ index: number; text: string }> = [];
  days.forEach((entry, index) => {
    const isMonday = weekday(entry.day) === 0;
    const isMonthStart = formatDay(entry.day, { day: "numeric" }) === "1";
    if (days.length <= 45 ? isMonday : isMonthStart) labels.push({ index, text: formatDay(entry.day, days.length <= 45 ? { month: "short", day: "numeric" } : { month: "short" }) });
  });
  return html`<figure class="viz day-stacks"><div class="stack-wrap" style="width:${width}px"><svg data-chart="${id}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${`Sessions per day over ${plural(days.length, "day")}`}">${raw(columns.join(""))}</svg>
<div class="stack-axis" aria-hidden="true">${labels.map((label) => html`<span style="left:${pctText((label.index * cell) / width)}">${label.text}</span>`)}</div></div>
<figcaption class="micro">Sessions per day · 1 square = ${plural(unit, "session")}${days.length <= 45 ? " · labels mark Mondays" : ""}</figcaption></figure>`;
}
