import { rich, type RenderContext } from "../components.js";
import { count, formatDate } from "../format.js";
import { html, raw, type SafeHtml } from "../html.js";
import { harnessLabel } from "../labels.js";
import type { Story } from "../story.js";
import { denseDays, pixelHero } from "../visuals.js";

export interface NavItem {
  id: string;
  label: string;
}

/** The mark: a trail of pixels rising to the right, brightest at the newest end. */
export const MARK = raw(
  `<svg class="mark" viewBox="0 0 26 26" aria-hidden="true">${[
    [0, 3, 1],
    [1, 3, 1],
    [1, 2, 2],
    [2, 2, 2],
    [2, 1, 3],
    [3, 1, 4],
    [3, 0, 5],
  ]
    .map(([x, y, level]) => `<rect class="p${level}" x="${x! * 7}" y="${y! * 7}" width="5" height="5"/>`)
    .join("")}</svg>`,
);

export function hookSection(context: RenderContext, story: Story, nav: NavItem[]): SafeHtml {
  const { report } = context;
  const generated = formatDate(report.generatedAt, context.zone);
  const art = pixelHero(denseDays((report.activity.daily ?? []).map((entry) => ({ day: entry.day, value: entry.sessions })), 371));
  const found = (report.coverage ?? []).filter((entry) => entry.found).map((entry) => entry.label || harnessLabel(entry.harness));
  const quote = report.narrative?.headline ? rich(report.narrative.headline, 600) : null;
  const sessions = count(report.activity.sessions);

  return html`<section id="overview" class="hook">
<div class="topbar"><span class="brand">${MARK}<span>hindsight</span></span><span class="micro">${generated ?? "Local report"}</span></div>
<div class="hook-grid${art ? "" : " no-art"}">
<div class="hook-copy">
<p class="micro eyebrow rise" style="--d:0">How you work with AI coding agents</p>
<h1 class="headline rise" style="--d:1">${story.headline.map((segment) => (segment.strong ? html`<em>${segment.text}</em>` : segment.text))}</h1>
${story.subline ? html`<p class="subline rise" style="--d:2">${story.subline.map((segment) => (segment.strong ? html`<b>${segment.text}</b>` : segment.text))}</p>` : null}
${story.numbers.length > 0
    ? html`<div class="numbers rise" style="--d:3" role="list">${story.numbers.map(
        (number) => html`<div class="number" role="listitem"><span class="n-value">${number.value}</span><span class="n-label">${number.label}</span>${number.note ? html`<span class="n-note">${number.note}</span>` : null}</div>`,
      )}</div>`
    : null}
${quote ? html`<blockquote class="agent-quote rise" style="--d:4"><span class="micro">Your agent's read</span>${quote}</blockquote>` : null}
<p class="micro sources rise" style="--d:4">${
    sessions > 0 && found.length > 0
      ? html`Read from ${found.map((name, index) => html`${index > 0 ? (index === found.length - 1 ? " and " : ", ") : ""}<b>${name}</b>`)} on this machine · nothing was uploaded`
      : "Nothing was uploaded · nothing left this machine"
  }</p>
</div>
${art ? html`<div class="hook-art rise" style="--d:2">${art}</div>` : null}
</div>
${nav.length > 0 ? html`<nav class="chapter-nav micro" aria-label="Chapters">${nav.map((item, index) => html`<a href="#${item.id}"><span>${String(index + 1).padStart(2, "0")}</span>${item.label}</a>`)}</nav>` : null}
</section>`;
}
