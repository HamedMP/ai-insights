/** Formatting is pinned to en-US so the same report renders the same file on any machine. */

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Non-negative finite count; transcripts can produce garbage counters. */
export function count(value: unknown): number {
  return Math.max(0, num(value));
}

const intFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatInt(value: number): string {
  return intFormat.format(Math.round(num(value)));
}

/** 1.2K, 34M, 5.1B: for dense tiles and axes. */
export function formatCompact(value: number): string {
  const n = num(value);
  const abs = Math.abs(n);
  const units: Array<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = n / size;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${trimZeros(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return abs < 10 && !Number.isInteger(n) ? trimZeros(n.toFixed(1)) : formatInt(n);
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** Null means "could not be priced" and must never read as $0. */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `$${formatInt(value)}`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 0.01 || value === 0) return `$${value.toFixed(2)}`;
  return "<$0.01";
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(digits)}%`;
}

export function formatHours(minutes: number): string {
  const m = count(minutes);
  if (m < 60) return `${Math.round(m)} min`;
  const hours = m / 60;
  return hours >= 100 ? `${formatInt(hours)} h` : `${trimZeros(hours.toFixed(1))} h`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, seconds);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${trimZeros((s / 60).toFixed(1))} min`;
  return `${trimZeros((s / 3600).toFixed(1))} h`;
}

/** The cache hit rate everywhere on the page: one source (`usage.cacheHitRate`), one decimal. */
export function formatCacheRate(rate: number): string {
  return `${(Math.round(num(rate) * 1000) / 10).toFixed(1)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${Math.round(num(n)) === 1 ? one : many}`;
}

/** The report's zone, or UTC when it is missing or not a zone Intl knows. */
export function safeTimeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return "UTC";
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${zone}|${JSON.stringify(options)}`;
  let existing = formatters.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
    formatters.set(key, existing);
  }
  return existing;
}

export function parseInstant(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** "Nov 14, 2026" for an instant, in the report zone. */
export function formatDate(value: string | null | undefined, zone: string): string | null {
  const ms = parseInstant(value);
  return ms === null ? null : formatter(zone, { year: "numeric", month: "short", day: "numeric" }).format(ms);
}

export function formatDateTime(value: string | null | undefined, zone: string): string | null {
  const ms = parseInstant(value);
  return ms === null ? null : formatter(zone, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A local "YYYY-MM-DD" bucket as a UTC day number, or null when malformed. */
export function dayNumber(day: string): number | null {
  const match = DAY.exec(typeof day === "string" ? day : "");
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export function dayFromNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** Day buckets are already local, so format them as UTC to avoid shifting them again. */
export function formatDay(n: number, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return formatter("UTC", options).format(n * 86_400_000);
}

/** Replace the home directory with ~ so a shared screenshot does not show a username. */
export function shortenPath(path: string): string {
  return path
    .replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
}

export function clip(text: unknown, max: number): string {
  const value = typeof text === "string" ? text : "";
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** "snake_case_value" -> "Snake case value". */
export function humanize(key: string): string {
  const text = key.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

const BYTE_UNITS: Record<string, number> = { b: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };

/** Bytes for a metric whose unit is a size ("MB", "GB", "bytes"), else null. */
export function bytesFor(value: number, unit: string): number | null {
  const scale = BYTE_UNITS[unit.trim().toLowerCase()];
  return scale === undefined || !Number.isFinite(value) ? null : value * scale;
}

/** Decimal units, as disk tools report them: "2.4 GB", "512 MB". */
export function formatBytes(bytes: number): string {
  const b = count(bytes);
  const units: Array<[number, string]> = [
    [1e12, "TB"],
    [1e9, "GB"],
    [1e6, "MB"],
    [1e3, "KB"],
  ];
  for (const [size, suffix] of units) {
    if (b >= size) {
      const scaled = b / size;
      return `${trimZeros(scaled.toFixed(scaled >= 100 ? 0 : 1))} ${suffix}`;
    }
  }
  return `${formatInt(b)} B`;
}

function localParts(ms: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = formatter(zone, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** How far the zone's wall clock is ahead of UTC at an instant, in ms. */
export function zoneOffsetMs(ms: number, zone: string): number {
  const p = localParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000;
}

/** The instant of the local wall-clock time `local` (ms as if the zone were UTC); one correction step covers DST edges. */
export function fromLocal(local: number, zone: string): number {
  const guess = local - zoneOffsetMs(local, zone);
  return local - zoneOffsetMs(guess, zone);
}

/** Local midnight at or before an instant. */
export function localDayStart(ms: number, zone: string): number {
  const local = ms + zoneOffsetMs(ms, zone);
  return fromLocal(Math.floor(local / 86_400_000) * 86_400_000, zone);
}

/** "14:05" in the zone. */
export function formatClock(ms: number, zone: string): string {
  return formatter(zone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** "Nov 12" in the zone. */
export function formatLocalDay(ms: number, zone: string): string {
  return formatter(zone, { month: "short", day: "numeric" }).format(ms);
}
