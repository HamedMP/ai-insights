import type { Count, Finding } from "../../schema/types.js";
import { compositionBar } from "../charts.js";
import { chapter, copyBlock, panel, rich, type RenderContext } from "../components.js";
import { bytesFor, clip, count, formatBytes, formatDate, formatDateTime, formatInt, formatUsd, num, plural } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel, keyLabel, severityLabel, severityRank, suggestionLabel } from "../labels.js";
import { externalLink } from "../links.js";
import { problemFindings, type Line, type RankedAction } from "../story.js";
import { frictionMap, pixelBars } from "../visuals.js";
import { tryThis } from "./common.js";
import type { ChapterInput } from "./data.js";

const MAX_FINDINGS = 12;
const MAX_EVIDENCE = 5;
const MAX_ITEMS = 12;
const MAX_TITLE = 160;
const MAX_TEXT = 1600;
/** Body text can carry a whole settings rule inline; only titles need short code spans. */
const MAX_INLINE_CODE = 160;

export const MATRIX_URL = "https://matrix-os.com";

/** Time units get printed next to the number; other units are carried by the label. */
const TIME_UNITS: Record<string, string> = { minutes: "min", minute: "min", min: "min", hours: "h", hour: "h", h: "h", seconds: "s", second: "s", s: "s" };

function countBars(id: string, counts: Count[] | null | undefined, limit = 10): SafeHtml | null {
  return pixelBars(
    id,
    (counts ?? []).map((entry) => ({ label: keyLabel(String(entry.key)), value: count(entry.count), display: formatInt(count(entry.count)) })),
    limit,
  );
}

function countItems(counts: Count[] | null | undefined) {
  return (counts ?? []).map((entry) => ({ label: keyLabel(String(entry.key)), value: count(entry.count) }));
}

export function metricText(finding: Finding): SafeHtml | null {
  const metric = finding.metric;
  if (!metric || !Number.isFinite(metric.value)) return null;
  const unit = String(metric.unit);
  const bytes = bytesFor(metric.value, unit);
  const plain = Number.isInteger(metric.value) ? formatInt(metric.value) : num(metric.value).toFixed(1);
  const time = TIME_UNITS[unit.trim().toLowerCase()];
  const value = bytes !== null ? formatBytes(bytes) : /^usd$/i.test(unit) ? formatUsd(metric.value) : time ? `${plain} ${time}` : plain;
  return html`<div class="metric"><b>${value}</b><span>${clip(String(metric.label || metric.unit || ""), 80)}</span></div>`;
}

/** With a narrative or facets: what the person's own agent read in their sessions. */
export function insightChapter({ context, index }: ChapterInput): SafeHtml | null {
  const { narrative, facets } = context.report;
  if (!narrative && !facets) return null;
  const areas = (narrative?.workAreas ?? []).slice(0, MAX_ITEMS);
  const wins = (narrative?.wins ?? []).slice(0, MAX_ITEMS);
  const read = facets ? count(facets.sessionsWithFacets) : 0;
  const lead: Line =
    read > 0
      ? [{ text: "Your agent read " }, { text: plural(read, "session"), strong: true }, { text: areas.length > 0 ? " and found " : "." }, ...(areas.length > 0 ? [{ text: plural(areas.length, "area"), strong: true }, { text: " of work." }] : [])]
      : [{ text: "Your agent read your sessions and found " }, { text: plural(areas.length, "area"), strong: true }, { text: " of work." }];
  const body = html`${areas.length > 0 ? html`<div class="cards">${areas.map(
    (area) => html`<article class="card reveal"><span class="micro">${plural(count(area.sessions), "session")}</span><h3>${rich(area.name, MAX_TITLE)}</h3><p>${rich(area.description, MAX_TEXT)}</p></article>`,
  )}</div>` : null}
${narrative?.interactionStyle ? html`<blockquote class="style-quote reveal"><span class="micro">How you work, in your agent's words</span>${rich(narrative.interactionStyle, MAX_TEXT)}</blockquote>` : null}
${facets ? html`<div class="row">${panel("Goals", countBars("goals", facets.goalCategories))}${panel("Session types", countBars("session-types", facets.sessionTypes))}</div>` : null}
${wins.length > 0 || facets
    ? html`<h3 class="sub-head reveal">What went well</h3>${wins.length > 0 ? html`<div class="cards">${wins.map((win) => html`<article class="card win reveal"><h3>${rich(win.title, MAX_TITLE)}</h3><p>${rich(win.description, MAX_TEXT)}</p></article>`)}</div>` : null}${
        facets
          ? html`<div class="row">${panel("Outcomes", compositionBar("outcomes", countItems(facets.outcomes), "No outcomes classified yet."))}${panel("What worked best", countBars("successes", facets.successes))}</div><div class="row">${panel("How helpful the agent was", compositionBar("helpfulness", countItems(facets.helpfulness), "Not classified yet."))}${panel("Your satisfaction", compositionBar("satisfaction", countItems(facets.satisfaction), "Not classified yet."))}</div>`
          : null
      }`
    : null}`;
  return chapter({ id: "story", index, kicker: "In your agent's words", lead, body });
}

/** Without a narrative: one short chapter that says how to get the rest of the story. */
export function insightsPromptChapter({ context, index }: ChapterInput): SafeHtml {
  const facets = context.report.facets;
  const partial = facets && count(facets.sessionsWithFacets) > 0;
  const lead: Line = partial
    ? [{ text: "Your agent has read " }, { text: plural(count(facets.sessionsWithFacets), "session"), strong: true }, { text: " so far. Finish the pass to add the story." }]
    : [{ text: "These are the numbers. " }, { text: "Your own agent", strong: true }, { text: " can add the why." }];
  const body = html`<div class="panel prompt-panel reveal"><p>Everything above is counted straight from your transcripts. Run the Hindsight insights skill in your own agent and it reads redacted excerpts of recent sessions, then writes back what you work on, what went well and where things go wrong. It runs with your existing account; Hindsight uploads nothing.</p>
${copyBlock(context, "Run the hindsight skill: analyse my recent sessions and update my Hindsight report.", "prompt for your agent")}</div>`;
  return chapter({ id: "insights-prompt", index, kicker: "The other half", lead, body, className: "compact" });
}

function findingCard(context: RenderContext, finding: Finding, anchor: string | undefined): SafeHtml {
  const evidence = (finding.evidence ?? []).slice(0, MAX_EVIDENCE);
  const hidden = (finding.evidence ?? []).length - evidence.length;
  const harnesses = [...new Set((finding.harnesses ?? []).map(harnessLabel))];
  const severity = ["high", "medium", "low", "info"].includes(String(finding.severity)) ? String(finding.severity) : "info";
  return html`<article class="finding reveal sev-${severity}">
<div class="finding-top micro"><span class="sev">${severityLabel(severity)}</span>${harnesses.map((name) => html`<span>${name}</span>`)}</div>
<h3>${rich(finding.title, MAX_TITLE)}</h3>
${metricText(finding)}
<p>${rich(finding.detail, MAX_TEXT)}</p>
${evidence.length > 0
    ? html`<details><summary class="micro">Evidence · ${plural((finding.evidence ?? []).length, "item")}</summary><ul class="evidence">${evidence.map((item) => {
        const when = formatDateTime(item.timestamp, context.zone);
        return html`<li><span>${rich(item.note, 300)}</span><span class="where">${harnessLabel(String(item.harness))}${when ? html` · ${when}` : null} · <code>${clip(String(item.sessionId), 40)}</code></span></li>`;
      })}</ul>${hidden > 0 ? html`<p class="micro more">and ${formatInt(hidden)} more</p>` : null}</details>`
    : null}
${anchor ? html`<a class="micro see" href="#${anchor}">What to do about it →</a>` : null}
</article>`;
}

export function frictionChapter(input: ChapterInput): SafeHtml | null {
  const { context, story, tips, actions, index } = input;
  const { report } = context;
  const problems = problemFindings(report)
    .map((finding, position) => ({ finding, position }))
    .sort((a, b) => severityRank(a.finding.severity) - severityRank(b.finding.severity) || a.position - b.position)
    .map((entry) => entry.finding);
  const map = frictionMap("friction-map", (report.activity.toolErrors ?? []).map((entry) => ({ label: keyLabel(String(entry.key)).toLowerCase(), value: count(entry.count) })));
  const narrative = (report.narrative?.frictions ?? []).slice(0, MAX_ITEMS);
  if (!story.friction && problems.length === 0 && narrative.length === 0 && !map) return null;
  const shown = problems.slice(0, MAX_FINDINGS);
  const body = html`${panel("Failed tool calls", map)}
${narrative.length > 0 ? html`<div class="cards">${narrative.map(
    (friction) => html`<article class="card reveal"><h3>${rich(friction.title, MAX_TITLE)}</h3><p>${rich(friction.description, MAX_TEXT)}</p>${
      (friction.examples ?? []).length > 0 ? html`<ul class="examples">${(friction.examples ?? []).slice(0, 5).map((example) => html`<li>${rich(example, 400)}</li>`)}</ul>` : null
    }</article>`,
  )}</div>` : null}
${report.facets ? panel("Friction your agent saw", countBars("frictions", report.facets.frictions)) : null}
${shown.length > 0 ? html`<div class="findings">${shown.map((finding) => findingCard(context, finding, finding.suggestion ? actions.get(finding.suggestion)?.anchor : undefined))}</div>` : html`<p class="quiet reveal">No recurring problems detected. That is a good sign.</p>`}
${problems.length > shown.length ? html`<p class="micro more">${plural(problems.length - shown.length, "more pattern")} not shown.</p>` : null}`;
  return chapter({ id: "friction", index, kicker: "Where time is lost", lead: story.friction, body, tip: tryThis(tips.friction, actions) });
}

/**
 * A suggestion without `instructionText` may still carry a settings fragment inline, such as
 * `"permissions": {"allow": [...]}` to add to `.claude/settings.json`. Offer the first fragment
 * that parses as a JSON object as a copyable, formatted block, named after the file it mentions.
 */
export function settingsSnippet(action: string): { text: string; file: string | null } | null {
  const spans = [...String(action ?? "").matchAll(/`([^`\n]{2,600})`/g)].map((match) => match[1]!.trim());
  for (const span of spans) {
    for (const candidate of [span, `{${span}}`]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
          const file = spans.find((other) => /^[\w.~/-]+\.(json|jsonc|toml|ya?ml)$/i.test(other)) ?? null;
          return { text: JSON.stringify(parsed, null, 2), file };
        }
      } catch {
        // Not JSON; try the next form.
      }
    }
  }
  return null;
}

function actHow(context: RenderContext, action: RankedAction): SafeHtml | null {
  const { suggestion } = action;
  const link = externalLink(suggestion.url);
  const snippet = suggestion.instructionText ? null : settingsSnippet(suggestion.action);
  return html`${suggestion.instructionText ? copyBlock(context, suggestion.instructionText, `instructions: ${clip(suggestion.title, 80)}`) : null}${
    snippet ? html`<p class="micro copy-label">${snippet.file ? html`Merge into <code>${snippet.file}</code>` : "Settings to merge"}</p>${copyBlock(context, snippet.text, `settings: ${clip(suggestion.title, 80)}`)}` : null
  }${link ? html`<p class="learn">Learn more: ${link}</p>` : null}`;
}

export function improveChapter(input: ChapterInput & { ranked: { top: RankedAction[]; rest: RankedAction[] } }): SafeHtml | null {
  const { context, index, ranked } = input;
  const { top, rest } = ranked;
  const horizon = (context.report.narrative?.horizon ?? []).slice(0, MAX_ITEMS);
  if (top.length === 0 && horizon.length === 0) return null;
  const total = top.length + rest.length;
  const lead: Line =
    total > 0
      ? [{ text: "Hindsight ranked " }, { text: plural(total, "change"), strong: true }, { text: total > 3 ? "; start with these three." : " worth making." }]
      : [{ text: "Nothing urgent to fix. Here is what to try next." }];
  const body = html`${top.length > 0 ? html`<ol class="actions">${top.map((action, position) => html`<li class="action reveal" id="action-${position + 1}">
<span class="rank">${position + 1}</span>
<div class="action-body"><span class="micro">${suggestionLabel(String(action.suggestion.type))}</span><h3>${rich(action.suggestion.title, MAX_TITLE)}</h3>
<p class="why"><span class="micro">Why</span>${rich(action.why, MAX_TITLE)}${action.finding ? metricText(action.finding) : null}</p>
<p>${rich(action.suggestion.action, MAX_TEXT, MAX_INLINE_CODE)}</p>${actHow(context, action)}</div>
</li>`)}</ol>` : null}
${rest.length > 0 ? html`<h3 class="sub-head reveal">More ideas</h3><ul class="more-actions">${rest.map((action, position) => html`<li class="reveal" id="action-${position + 4}"><span class="micro">${suggestionLabel(String(action.suggestion.type))}</span><b>${rich(action.suggestion.title, MAX_TITLE)}</b><span>${rich(action.suggestion.action, MAX_TEXT, MAX_INLINE_CODE)}</span>${actHow(context, action)}</li>`)}</ul>` : null}
${horizon.length > 0 ? html`<h3 class="sub-head reveal">Bigger moves</h3><div class="cards">${horizon.map((item) => html`<article class="card reveal"><h3>${rich(item.title, MAX_TITLE)}</h3><p>${rich(item.description, MAX_TEXT)}</p>${item.starterPrompt ? copyBlock(context, item.starterPrompt, `starter prompt: ${clip(item.title, 80)}`) : null}</article>`)}</div>` : null}`;
  return chapter({ id: "improve", index, kicker: "What to improve", lead, body });
}

/** The closing pair: save disk space (when history is large) and keep history for the long term. */
export function closingChapter({ context }: ChapterInput): SafeHtml {
  const findings = context.report.findings ?? [];
  const disk = findings.find((finding) => finding.kind === "history_disk_usage");
  const short = findings.find((finding) => finding.kind === "short_history");
  const shortMetric = short?.metric && Number.isFinite(short.metric.value) ? short.metric : null;
  const oldest = (context.report.coverage ?? []).filter((entry) => entry.found && entry.oldest).map((entry) => entry.oldest!).sort()[0];
  const since = formatDate(oldest, context.zone);
  const diskLink = disk?.suggestion ? externalLink(disk.suggestion.url, "cta ghost") : null;
  const diskCard = disk
    ? html`<article class="closing-card reveal" id="packmem"><span class="micro">Your history on disk</span>${metricText(disk)}<h3>${rich(disk.suggestion?.title ?? "Compress and save disk space", MAX_TITLE)}</h3><p>${rich(disk.suggestion?.action ?? disk.detail, MAX_TEXT)}</p>${diskLink}</article>`
    : null;
  return html`<section id="closing" class="closing">
<div class="closing-grid${diskCard ? "" : " single"}">
${diskCard}
<article class="closing-card matrix reveal" id="matrix"><span class="micro">Long-term memory</span>${
    shortMetric
      ? html`<div class="metric"><b>${formatInt(shortMetric.value)}</b><span>${clip(String(shortMetric.label || shortMetric.unit), 80)}${since ? html`, back to ${since}` : null}</span></div>`
      : null
  }<h3>Store your conversations long term</h3><p>Your agents only remember about 30 days: local tools like Claude Code delete old transcripts after that by default, so the oldest part of this story disappears every month. Matrix OS keeps all of it and builds memory on top, so your agents recall past decisions and your next look back covers years, not weeks.</p><a class="cta" href="${MATRIX_URL}" rel="noopener noreferrer">Keep your history with Matrix OS <span aria-hidden="true">→</span></a></article>
</div>
</section>`;
}
