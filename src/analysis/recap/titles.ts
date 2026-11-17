import type { RecapTitle, WorkRatioKey, WorkRatios } from "../../schema/types.js";

/** Titles shown at once: more turns a badge into a list nobody reads. */
export const MAX_TITLES = 3;

interface TitleRule {
  key: string;
  title: string;
  ratio: WorkRatioKey;
  /** The denominator a ratio needs before it can earn anything: a share of four sessions is luck. */
  min: number;
  earns: (value: number) => boolean;
  rule: (value: number) => string;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const two = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const one = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

/**
 * Fixed wording, never a judgement of the person: each pair names two ways of working, both fine. In priority
 * order; a ratio earns at most one title.
 */
export const TITLE_RULES: TitleRule[] = [
  { key: "clear_briefer", title: "The Clear Briefer", ratio: "correctionsPerSession", min: 10, earns: (v) => v <= 0.1, rule: (v) => `${two(v)} mid-run corrections per session (0.10 or fewer earns it)` },
  { key: "hands_on_pilot", title: "The Hands-On Pilot", ratio: "correctionsPerSession", min: 10, earns: (v) => v >= 1, rule: (v) => `${two(v)} mid-run corrections per session (1 or more earns it)` },
  { key: "architect", title: "The Architect", ratio: "planFirstShare", min: 10, earns: (v) => v >= 0.5, rule: (v) => `${pct(v)} of sessions that edited files started with a plan (half or more earns it)` },
  { key: "improviser", title: "The Improviser", ratio: "planFirstShare", min: 10, earns: (v) => v <= 0.1, rule: (v) => `${pct(v)} of sessions that edited files started with a plan (10% or fewer earns it)` },
  { key: "conductor", title: "The Conductor", ratio: "parallelism", min: 5, earns: (v) => v >= 2, rule: (v) => `${one(v)} sessions running at once on average (2 or more earns it)` },
  { key: "deep_focuser", title: "The Deep Focuser", ratio: "parallelism", min: 5, earns: (v) => v <= 1.1, rule: (v) => `${one(v)} sessions running at once on average (1.1 or fewer earns it)` },
  { key: "context_keeper", title: "The Context Keeper", ratio: "contextResetShare", min: 10, earns: (v) => v <= 0.05, rule: (v) => `${pct(v)} of sessions hit a context reset (5% or fewer earns it)` },
  { key: "deep_diver", title: "The Deep Diver", ratio: "contextResetShare", min: 10, earns: (v) => v >= 0.3, rule: (v) => `${pct(v)} of sessions hit a context reset (30% or more earns it)` },
  { key: "smooth_operator", title: "The Smooth Operator", ratio: "toolErrorRate", min: 200, earns: (v) => v <= 0.03, rule: (v) => `${pct(v)} of tool calls failed (3% or fewer earns it)` },
  { key: "stress_tester", title: "The Stress Tester", ratio: "toolErrorRate", min: 200, earns: (v) => v >= 0.15, rule: (v) => `${pct(v)} of tool calls failed (15% or more earns it)` },
];

/** Titles earned from the ratios, deterministic from the numbers alone. */
export function titlesOf(ratios: WorkRatios): RecapTitle[] {
  const out: RecapTitle[] = [];
  const used = new Set<WorkRatioKey>();
  for (const rule of TITLE_RULES) {
    if (out.length >= MAX_TITLES) break;
    const ratio = ratios[rule.ratio];
    if (used.has(rule.ratio) || !ratio || ratio.value === null || !Number.isFinite(ratio.value) || ratio.denominator < rule.min) continue;
    if (!rule.earns(ratio.value)) continue;
    used.add(rule.ratio);
    out.push({ key: rule.key, title: rule.title, ratio: rule.ratio, value: ratio.value, rule: rule.rule(ratio.value) });
  }
  return out;
}
