const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

/**
 * Accepts a relative window (`90d`, `12w`, `6m`, `1y`) or an ISO date.
 * Returns null for anything else so callers can say what is accepted.
 */
export function parseSince(value: string, now: Date = new Date()): Date | null {
  const trimmed = value.trim().toLowerCase();
  const relative = /^(\d{1,5})\s*([dwmy])$/.exec(trimmed);
  if (relative) {
    const days = Number(relative[1]) * UNIT_DAYS[relative[2]!]!;
    if (days <= 0) return null;
    return new Date(now.getTime() - days * 86_400_000);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export const SINCE_HELP = "a window like 30d, 12w, 6m or 1y, or an ISO date like 2026-01-31";
