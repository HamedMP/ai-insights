import type { Finding, Harness, Session } from "../../schema/types.js";
import { cacheHitRate, ratesFor } from "../usage.js";
import { evidence, HARNESS_LABELS, MAX_EVIDENCE, percent, plural, round, usd, type Detector } from "./context.js";

/** Agent loops resend the same prefix every turn, so healthy sessions read most input from cache; under half means the cache keeps breaking. */
const LOW_HIT_RATE = 0.5;
/** The hit rate well-behaved agent sessions reach, used to price what the misses cost. */
const TARGET_HIT_RATE = 0.8;
/** Below this the possible saving is not worth changing habits for. */
const MIN_SAVING_USD = 5;
/** Small samples swing wildly; only judge a harness with real volume. */
const MIN_INPUT_TOKENS = 1_000_000;
/** Severity follows the money: tens of dollars is medium, a hundred or more is high. */
const MEDIUM_SAVING_USD = 25;
const HIGH_SAVING_USD = 100;

interface Bucket {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  /** Cost of the missing cache reads, priced per model: full input price minus cache-read price. */
  missPremium: number;
  pricedInput: number;
  sessions: Map<Session, { input: number; cachedInput: number; cacheWrite: number }>;
}

const SUGGESTIONS: Partial<Record<Harness, string>> = {
  "claude-code":
    "The prompt cache expires after about five minutes idle, and switching models or editing CLAUDE.md mid-session invalidates it. After a long break, start a fresh session with a short summary instead of resuming a huge one.",
  codex:
    "Codex caches the shared prefix of each request; resuming very old sessions, changing the model or reasoning settings mid-session, and editing AGENTS.md all force a cold start.",
};

export const cacheMissCost: Detector = ({ requests }) => {
  const buckets = new Map<Harness, Bucket>();
  for (const { session, request } of requests) {
    const rates = ratesFor(request.model, request.usage);
    let bucket = buckets.get(session.harness);
    if (!bucket) {
      bucket = { input: 0, cachedInput: 0, cacheWrite: 0, missPremium: 0, pricedInput: 0, sessions: new Map() };
      buckets.set(session.harness, bucket);
    }
    const { input, cachedInput, cacheWrite } = request.usage;
    bucket.input += input;
    bucket.cachedInput += cachedInput;
    bucket.cacheWrite += cacheWrite;
    const row = bucket.sessions.get(session) ?? { input: 0, cachedInput: 0, cacheWrite: 0 };
    row.input += input;
    row.cachedInput += cachedInput;
    row.cacheWrite += cacheWrite;
    bucket.sessions.set(session, row);
    if (rates) {
      const prompt = input + cachedInput + cacheWrite;
      const missing = Math.max(0, TARGET_HIT_RATE * prompt - cachedInput);
      bucket.missPremium += (missing * (rates.input - rates.cacheRead)) / 1e6;
      bucket.pricedInput += prompt;
    }
  }

  const findings: Finding[] = [];
  for (const [harness, bucket] of [...buckets].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rate = cacheHitRate(bucket);
    const promptTokens = bucket.input + bucket.cachedInput + bucket.cacheWrite;
    if (rate === null || rate >= LOW_HIT_RATE || promptTokens < MIN_INPUT_TOKENS || bucket.missPremium < MIN_SAVING_USD) continue;
    const uncached = (row: { input: number; cacheWrite: number }) => row.input + row.cacheWrite;
    const items = [...bucket.sessions]
      .filter(([, row]) => uncached(row) > 0)
      .sort((a, b) => uncached(b[1]) - uncached(a[1]) || a[0].startTime.localeCompare(b[0].startTime))
      .slice(0, MAX_EVIDENCE)
      .map(([session, row]) =>
        evidence(
          session,
          `${(uncached(row) / 1e6).toFixed(2)}M input tokens not read from cache (${percent(cacheHitRate(row) ?? 0)} cache hits)`,
        ),
      );
    if (items.length < 2) continue;
    const label = HARNESS_LABELS[harness];
    const severity = bucket.missPremium >= HIGH_SAVING_USD ? "high" : bucket.missPremium >= MEDIUM_SAVING_USD ? "medium" : "low";
    findings.push({
      id: `cache_miss_cost:${harness}`,
      kind: "cache_miss_cost",
      severity,
      title: `${label} reads little from the prompt cache`,
      detail: `Only ${percent(rate)} of ${label} input came from the cache, across ${plural(bucket.sessions.size, "session")}. At a ${percent(TARGET_HIT_RATE)} hit rate the same work would have cost about ${usd(bucket.missPremium)} less at API list prices${bucket.pricedInput < promptTokens ? " (models without a known price are left out)" : ""}.`,
      harnesses: [harness],
      metric: { value: round(bucket.missPremium), unit: "USD", label: "estimated cost of cache misses" },
      evidence: items,
      suggestion: {
        type: "habit",
        title: "Keep the cache warm",
        action: SUGGESTIONS[harness] ?? "Keep sessions continuous and avoid changing the model or system instructions mid-session, both of which discard the prompt cache.",
      },
    });
  }
  return findings;
};
