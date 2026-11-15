import { truncate } from "../sources/shared.js";

/** Most a single tool result may carry, so one call cannot flood the agent's context. */
export const MAX_OUTPUT_CHARS = 60_000;

/** Arrays under these keys are time series; keep the newest end when cutting them. */
const TAIL_KEYS = new Set(["daily"]);

export interface BoundLimits {
  maxArray: number;
  maxString: number;
  maxDepth?: number;
}

/**
 * Copy of `value` with arrays and strings capped. Each cut array gets a sibling
 * `<key>Truncated` count so the agent knows there is more.
 */
export function bound(value: unknown, limits: BoundLimits, depth = 0): unknown {
  const maxDepth = limits.maxDepth ?? 12;
  if (typeof value === "string") return truncate(value, limits.maxString);
  if (value === null || typeof value !== "object") return value;
  if (depth >= maxDepth) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) return value.slice(0, limits.maxArray).map((item) => bound(item, limits, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child) && child.length > limits.maxArray) {
      const kept = TAIL_KEYS.has(key) ? child.slice(-limits.maxArray) : child.slice(0, limits.maxArray);
      out[key] = kept.map((item) => bound(item, limits, depth + 1));
      out[`${key}Truncated`] = child.length - limits.maxArray;
    } else {
      out[key] = bound(child, limits, depth + 1);
    }
  }
  return out;
}

const STEPS: BoundLimits[] = [
  { maxArray: 400, maxString: 4_000 },
  { maxArray: 100, maxString: 2_000 },
  { maxArray: 40, maxString: 1_000 },
  { maxArray: 15, maxString: 400 },
  { maxArray: 5, maxString: 200, maxDepth: 6 },
];

/** Serialise `value`, tightening limits until it fits in `maxChars`. */
export function fitJson(value: unknown, maxChars = MAX_OUTPUT_CHARS): string {
  for (const limits of STEPS) {
    const text = JSON.stringify(bound(value, limits));
    if (text.length <= maxChars) return text;
  }
  return JSON.stringify({ error: "Result too large to return. Ask for fewer sections or a smaller limit." });
}
