import type { Count } from "../../schema/types.js";
import { barList, compositionBar, type BarItem } from "../charts.js";
import { card, copyBlock, rich, sectionHead, type RenderContext } from "../components.js";
import { clip, count, plural } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { keyLabel } from "../labels.js";

const MAX_ITEMS = 12;
const MAX_TITLE = 160;
const MAX_TEXT = 1600;
const MAX_EXAMPLES = 5;

export function countItems(counts: Count[] | null | undefined): BarItem[] {
  return (counts ?? []).map((entry) => ({ label: keyLabel(String(entry.key)), value: count(entry.count) }));
}

/** Shown on the first, deterministic-only run in place of the narrative sections. */
export function insightsPromptSection(context: RenderContext): SafeHtml {
  const facets = context.report.facets;
  const partial = facets && count(facets.sessionsWithFacets) > 0;
  return html`<section id="insights-prompt">
<div class="callout">
<div class="eyebrow">Next step</div>
<h2>${partial ? "Finish the insights pass to add the story" : "Add the qualitative half of this report"}</h2>
<p>${
    partial
      ? `Your agent has read ${plural(count(facets.sessionsWithFacets), "session")} so far. Finish the insights skill so it can write what you work on, what went well and where things go wrong.`
      : "Everything below is counted straight from your transcripts. To add what you work on, what went well, where things go wrong and why, run the Hindsight insights skill in your own agent. It reads redacted excerpts of recent sessions and writes the analysis back here."
  }</p>
<p class="muted">The analysis runs in your agent with your existing account. Nothing is uploaded anywhere by Hindsight.</p>
${copyBlock(context, "Run the hindsight skill: analyse my recent sessions and update my Hindsight report.", "prompt for your agent")}
</div>
</section>`;
}

export function workSection(context: RenderContext): SafeHtml | null {
  const { narrative, facets } = context.report;
  if (!narrative && !facets) return null;
  const areas = (narrative?.workAreas ?? []).slice(0, MAX_ITEMS);
  const style = narrative?.interactionStyle ? clip(narrative.interactionStyle, MAX_TEXT) : null;
  const goals = countItems(facets?.goalCategories);
  const types = countItems(facets?.sessionTypes);
  return html`<section id="work">
${sectionHead("Work", "What you work on, and how", facets ? `Based on ${plural(count(facets.sessionsWithFacets), "session")} your agent read and classified.` : null)}
<div class="stack">
${areas.length > 0 ? html`<div class="grid">${areas.map((area) =>
    card(html`<h3>${rich(area.name, MAX_TITLE)}</h3><p class="count">${plural(count(area.sessions), "session")}</p><p class="muted" style="margin-top:10px">${rich(area.description, MAX_TEXT)}</p>`),
  )}</div>` : null}
${style ? card(html`<h4>Interaction style</h4><p class="quote">${rich(style, MAX_TEXT)}</p>`) : null}
${facets ? html`<div class="grid two">
${card(html`<h4>Goals</h4>${barList("goals", goals, { limit: MAX_ITEMS, emptyMessage: "No goals classified yet." })}`)}
${card(html`<h4>Session types</h4>${barList("session-types", types, { limit: MAX_ITEMS, emptyMessage: "No session types classified yet." })}`)}
</div>` : null}
</div>
</section>`;
}

export function winsSection(context: RenderContext): SafeHtml | null {
  const { narrative, facets } = context.report;
  if (!narrative && !facets) return null;
  const wins = (narrative?.wins ?? []).slice(0, MAX_ITEMS);
  return html`<section id="wins">
${sectionHead("What went well", "Where your agents earned their keep")}
<div class="stack">
${wins.length > 0 ? html`<div class="grid">${wins.map((win) => card(html`<h3>${rich(win.title, MAX_TITLE)}</h3><p class="muted">${rich(win.description, MAX_TEXT)}</p>`))}</div>` : null}
${facets ? html`<div class="grid two">
${card(html`<h4>Outcomes</h4>${compositionBar("outcomes", countItems(facets.outcomes), "No outcomes classified yet.")}`)}
${card(html`<h4>What worked best</h4>${barList("successes", countItems(facets.successes), { limit: MAX_ITEMS, emptyMessage: "No standout successes classified yet." })}`)}
${card(html`<h4>How helpful the agent was</h4>${compositionBar("helpfulness", countItems(facets.helpfulness), "Not classified yet.")}`)}
${card(html`<h4>Your satisfaction</h4>${compositionBar("satisfaction", countItems(facets.satisfaction), "Not classified yet.")}`)}
</div>` : null}
${wins.length === 0 && !facets ? html`<p class="muted">No wins recorded yet.</p>` : null}
</div>
</section>`;
}

export function narrativeFrictions(context: RenderContext): SafeHtml | null {
  const frictions = (context.report.narrative?.frictions ?? []).slice(0, MAX_ITEMS);
  if (frictions.length === 0) return null;
  return html`<div class="grid">${frictions.map((friction) => {
    const examples = (friction.examples ?? []).slice(0, MAX_EXAMPLES);
    return card(
      html`<h3>${rich(friction.title, MAX_TITLE)}</h3><p class="muted">${rich(friction.description, MAX_TEXT)}</p>${
        examples.length > 0 ? html`<ul class="examples">${examples.map((example) => html`<li>${rich(example, 400)}</li>`)}</ul>` : null
      }`,
    );
  })}</div>`;
}

export function horizonSection(context: RenderContext): SafeHtml | null {
  const narrative = context.report.narrative;
  if (!narrative) return null;
  const items = (narrative.horizon ?? []).slice(0, MAX_ITEMS);
  return html`<section id="horizon">
${sectionHead("On the horizon", "Bigger workflows worth trying next", "Each one builds on how you already work. Starter prompts are ready to paste into your agent.")}
${items.length > 0
    ? html`<div class="grid two">${items.map((item) =>
        card(html`<h3>${rich(item.title, MAX_TITLE)}</h3><p class="muted">${rich(item.description, MAX_TEXT)}</p>${item.starterPrompt ? copyBlock(context, item.starterPrompt, `starter prompt: ${clip(item.title, 80)}`) : null}`),
      )}</div>`
    : html`<p class="muted">Nothing on the horizon yet.</p>`}
</section>`;
}

