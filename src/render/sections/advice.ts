import type { Finding, Suggestion } from "../../schema/types.js";
import { barList } from "../charts.js";
import { card, copyBlock, rich, sectionHead, type RenderContext } from "../components.js";
import { bytesFor, clip, count, formatBytes, formatDateTime, formatInt, formatUsd, num, plural } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel, keyLabel, severityLabel, severityRank, suggestionLabel } from "../labels.js";
import { countItems, narrativeFrictions } from "./narrative.js";

const MAX_FINDINGS = 40;
const MAX_EVIDENCE = 5;
const MAX_SUGGESTIONS = 30;
const MAX_CHIPS = 12;
const MAX_TITLE = 160;
const MAX_TEXT = 1600;

/** Findings that are an opportunity rather than a problem; they are shown under features to try. */
const FEATURE_KINDS = new Set(["unused_feature", "history_disk_usage"]);
/** Kinds shown outside the problem list: feature kinds, and short history in the closing section. */
const NOT_A_PROBLEM = new Set([...FEATURE_KINDS, "short_history"]);
const MAX_URL = 2000;
const FEATURE_TYPES = new Set(["feature", "plugin"]);

export interface SuggestionItem {
  anchor: string;
  suggestion: Suggestion;
  finding: Finding | null;
}

export interface Advice {
  general: SuggestionItem[];
  features: SuggestionItem[];
  /** Unused-feature findings that came without a suggestion. */
  bareFeatureFindings: Finding[];
  anchorForFinding: Map<Finding, string>;
}

/** Narrative suggestions first, then finding suggestions, de-duplicated by title. */
export function collectAdvice(context: RenderContext): Advice {
  const seen = new Map<string, string>();
  const general: SuggestionItem[] = [];
  const features: SuggestionItem[] = [];
  const anchorForFinding = new Map<Finding, string>();
  const bareFeatureFindings: Finding[] = [];

  const add = (suggestion: Suggestion | undefined, finding: Finding | null) => {
    if (!suggestion || typeof suggestion.title !== "string" || suggestion.type === "matrix") return;
    const key = `${FEATURE_TYPES.has(suggestion.type) ? "f" : "g"}:${suggestion.title.trim().toLowerCase()}`;
    const existing = seen.get(key);
    if (existing) {
      if (finding) anchorForFinding.set(finding, existing);
      return;
    }
    const target = FEATURE_TYPES.has(suggestion.type) ? features : general;
    if (target.length >= MAX_SUGGESTIONS) return;
    const anchor = context.nextId("suggestion");
    seen.set(key, anchor);
    target.push({ anchor, suggestion, finding });
    if (finding) anchorForFinding.set(finding, anchor);
  };

  for (const suggestion of context.report.narrative?.suggestions ?? []) add(suggestion, null);
  for (const finding of context.report.findings ?? []) {
    if (FEATURE_KINDS.has(finding.kind) && !finding.suggestion) bareFeatureFindings.push(finding);
    add(finding.suggestion, finding);
  }
  return { general, features, bareFeatureFindings, anchorForFinding };
}

function metricText(finding: Finding): SafeHtml | null {
  const metric = finding.metric;
  if (!metric || !Number.isFinite(metric.value)) return null;
  const unit = String(metric.unit);
  const bytes = bytesFor(metric.value, unit);
  const value =
    bytes !== null
      ? formatBytes(bytes)
      : /^usd$/i.test(unit)
        ? formatUsd(metric.value)
        : Number.isInteger(metric.value)
          ? formatInt(metric.value)
          : num(metric.value).toFixed(1);
  return html`<div class="metric"><b>${value}</b><span>${clip(String(metric.label || metric.unit || ""), 80)}</span></div>`;
}

function findingCard(context: RenderContext, finding: Finding, advice: Advice): SafeHtml {
  const evidence = (finding.evidence ?? []).slice(0, MAX_EVIDENCE);
  const hidden = (finding.evidence ?? []).length - evidence.length;
  const harnesses = [...new Set((finding.harnesses ?? []).map(harnessLabel))];
  const anchor = advice.anchorForFinding.get(finding);
  const severity = String(finding.severity);
  return html`<article class="card finding">
<div class="finding-top"><span class="badge ${["high", "medium", "low", "info"].includes(severity) ? severity : "info"}">${severityLabel(severity)}</span>${harnesses.map((name) => html`<span class="chip">${name}</span>`)}</div>
<h3>${rich(finding.title, MAX_TITLE)}</h3>
${metricText(finding)}
<p class="muted">${rich(finding.detail, MAX_TEXT)}</p>
${evidence.length > 0 ? html`<div><h4>Evidence</h4><ul class="evidence" style="margin-top:10px">${evidence.map((item) => {
    const when = formatDateTime(item.timestamp, context.zone);
    return html`<li><span>${rich(item.note, 300)}</span><span class="where">${harnessLabel(String(item.harness))}${when ? html` · ${when}` : null} · <code>${clip(String(item.sessionId), 40)}</code></span></li>`;
  })}</ul>${hidden > 0 ? html`<p class="more">and ${formatInt(hidden)} more</p>` : null}</div>` : null}
${anchor ? html`<p class="see"><a href="#${anchor}">See the suggestion</a></p>` : null}
</article>`;
}

export function frictionSection(context: RenderContext, advice: Advice): SafeHtml {
  const { facets, activity } = context.report;
  const findings = (context.report.findings ?? [])
    .filter((finding) => !NOT_A_PROBLEM.has(finding.kind))
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => severityRank(a.finding.severity) - severityRank(b.finding.severity) || a.index - b.index)
    .map((entry) => entry.finding);
  const shown = findings.slice(0, MAX_FINDINGS);
  const errors = (activity.toolErrors ?? []).map((entry) => ({ label: keyLabel(String(entry.key)), value: count(entry.count) }));
  const story = narrativeFrictions(context);

  return html`<section id="friction">
${sectionHead("Where things go wrong", "Friction worth fixing", "Patterns found in your transcripts, each with evidence you can check against the session it came from.")}
<div class="stack">
${story}
<div class="grid two">
${facets ? card(html`<h4>Friction your agent saw</h4>${barList("frictions", countItems(facets.frictions), { limit: 12, emptyMessage: "No friction recorded in classified sessions." })}`) : null}
${card(html`<h4>Tool errors</h4>${barList("tool-errors", errors, { limit: 10, emptyMessage: "No tool errors recorded." })}`)}
</div>
${shown.length > 0
    ? html`<div class="grid two">${shown.map((finding) => findingCard(context, finding, advice))}</div>${findings.length > shown.length ? html`<p class="more">${plural(findings.length - shown.length, "more finding")} not shown.</p>` : null}`
    : html`<div class="chart-empty">No recurring problems detected. That is a good sign.</div>`}
</div>
</section>`;
}

/**
 * A suggestion's URL as a parsed http(s) URL, or null. Anything else (javascript:,
 * data:, protocol-relative, credentials, garbage) is never rendered at all.
 */
export function safeLink(url: unknown): URL | null {
  if (typeof url !== "string" || url.length > MAX_URL) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed;
}

function learnMore(url: string | undefined): SafeHtml | null {
  const link = safeLink(url);
  if (!link) return null;
  // The normalised href percent-encodes quotes and spaces; the html tag escapes it again anyway.
  const label = clip(link.href.replace(/^https?:\/\//i, "").replace(/\/$/, ""), 120);
  return html`<p class="learn">Learn more: <a href="${link.href}" target="_blank" rel="noopener noreferrer">${label}</a></p>`;
}

function suggestionCard(context: RenderContext, item: SuggestionItem, showMetric = false): SafeHtml {
  const { suggestion, finding } = item;
  return html`<article class="card suggestion" id="${item.anchor}">
<div class="type">${suggestionLabel(String(suggestion.type))}</div>
<h3>${rich(suggestion.title, MAX_TITLE)}</h3>
${showMetric && finding ? html`<div style="margin-top:10px">${metricText(finding)}</div>` : null}
<p class="muted" style="margin-top:8px">${rich(suggestion.action, MAX_TEXT)}</p>
${suggestion.instructionText ? copyBlock(context, suggestion.instructionText, `instructions: ${clip(suggestion.title, 80)}`) : null}
${learnMore(suggestion.url)}
${finding ? html`<p class="from">From: ${rich(finding.title, MAX_TITLE)}</p>` : null}
</article>`;
}

export function suggestionsSection(context: RenderContext, advice: Advice): SafeHtml {
  return html`<section id="suggestions">
${sectionHead("Suggestions", "Changes that pay off every session", "Instruction blocks are ready to paste into CLAUDE.md or AGENTS.md. Review them first; they are suggestions, not facts.")}
${advice.general.length > 0
    ? html`<div class="grid two">${advice.general.map((item) => suggestionCard(context, item))}</div>`
    : html`<div class="chart-empty">No suggestions yet.</div>`}
</section>`;
}

function chips(label: string, counts: Array<{ key: string; count: number }> | undefined): SafeHtml | null {
  const items = (counts ?? []).filter((entry) => count(entry.count) > 0).slice(0, MAX_CHIPS);
  if (items.length === 0) return null;
  return html`<div><h4>${label}</h4><div class="chips">${items.map((entry) => html`<span class="chip">${clip(String(entry.key), 60)}<b>${formatInt(entry.count)}</b></span>`)}</div></div>`;
}

export function featuresSection(context: RenderContext, advice: Advice): SafeHtml {
  const features = context.report.activity.features;
  const inUse = [
    chips("MCP servers", features?.mcpServers),
    chips("Skills", features?.skills),
    chips("Slash commands", features?.slashCommands),
  ].filter((part): part is SafeHtml => part !== null);
  const sessions = context.report.activity.sessions;
  return html`<section id="features">
${sectionHead("Features to try", "What you use, and what you are missing")}
<div class="stack">
${card(html`<div class="card-head"><h3>What you use today</h3></div><div class="grid two"><dl class="facts" style="align-self:start">
<dt>Sessions with subagents</dt><dd>${formatInt(features?.sessionsWithSubagents ?? 0)} of ${formatInt(sessions)}</dd>
<dt>Sessions with plan mode</dt><dd>${formatInt(features?.sessionsWithPlanMode ?? 0)} of ${formatInt(sessions)}</dd>
<dt>Sessions with web search or fetch</dt><dd>${formatInt(features?.sessionsWithWeb ?? 0)} of ${formatInt(sessions)}</dd>
<dt>Context compactions</dt><dd>${formatInt(features?.compactions ?? 0)}</dd>
</dl>${inUse.length > 0 ? html`<div class="stack">${inUse}</div>` : html`<p class="muted" style="margin-top:14px">No MCP servers, skills or slash commands used yet.</p>`}</div>`)}
${advice.features.length > 0 || advice.bareFeatureFindings.length > 0
    ? html`<div class="grid two">${advice.features.map((item) => suggestionCard(context, item, true))}${advice.bareFeatureFindings.slice(0, MAX_SUGGESTIONS).map((finding) =>
        card(html`<div class="type eyebrow">Feature</div><h3 style="margin-top:6px">${rich(finding.title, MAX_TITLE)}</h3>${metricText(finding)}<p class="muted" style="margin-top:8px">${rich(finding.detail, MAX_TEXT)}</p>`, "suggestion"),
      )}</div>`
    : html`<div class="chart-empty">Nothing new to try right now. You are using the main features already.</div>`}
</div>
</section>`;
}
