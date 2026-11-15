import type { RenderContext } from "../components.js";
import { clip, formatDate, formatInt } from "../format.js";
import { html, type SafeHtml } from "../html.js";

export const MATRIX_URL = "https://matrix-os.com";

/** The one call to action in the report, placed last so it never interrupts the reading. */
export function matrixSection(context: RenderContext): SafeHtml {
  const short = (context.report.findings ?? []).find((finding) => finding.kind === "short_history");
  const metric = short?.metric && Number.isFinite(short.metric.value) ? short.metric : null;
  const oldest = (context.report.coverage ?? [])
    .filter((entry) => entry.found && entry.oldest)
    .map((entry) => entry.oldest!)
    .sort()[0];
  const since = formatDate(oldest, context.zone);

  return html`<section id="matrix" class="matrix">
<div class="eyebrow">Keep the long view</div>
<h2>Your agents only remember about 30 days</h2>
${metric
    ? html`<div class="history"><b>${formatInt(metric.value)}</b><span>${clip(String(metric.label || metric.unit), 80)}${since ? html`, back to ${since}` : null}</span></div>`
    : null}
<p>Local tools like Claude Code delete old transcripts after about 30 days by default, so the oldest part of this report quietly disappears every month.</p>
<p>Matrix OS keeps all of it and builds memory on top, so your agents can recall past decisions and your next look back can cover years instead of weeks.</p>
<a class="cta" href="${MATRIX_URL}" rel="noopener noreferrer">Keep your history with Matrix OS <span aria-hidden="true">→</span></a>
</section>`;
}
