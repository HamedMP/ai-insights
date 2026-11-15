import type { Report } from "../schema/types.js";
import { clip } from "./format.js";
import { html, type SafeHtml } from "./html.js";

/** Per-render state, so ids are deterministic and unique within one document. */
export interface RenderContext {
  report: Report;
  zone: string;
  nextId(prefix: string): string;
}

export function createContext(report: Report, zone: string): RenderContext {
  const counters = new Map<string, number>();
  return {
    report,
    zone,
    nextId(prefix) {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}-${next}`;
    },
  };
}

export function sectionHead(eyebrow: string, title: string, intro?: string | SafeHtml | null): SafeHtml {
  return html`<header class="section-head"><div class="eyebrow">${eyebrow}</div><h2>${title}</h2>${intro ? html`<p>${intro}</p>` : null}</header>`;
}

export interface Tile {
  value: string;
  label: string;
  sub?: string | null;
}

export function tiles(items: Tile[], label: string): SafeHtml {
  return html`<div class="tiles" role="list" aria-label="${label}">${items.map(
    (item) => html`<div class="tile" role="listitem"><span class="value">${item.value}</span><span class="label">${item.label}</span>${item.sub ? html`<span class="sub">${item.sub}</span>` : null}</div>`,
  )}</div>`;
}

export const MAX_COPY_CHARS = 6000;

/** A <pre> with a copy button; the script copies the element's text, never markup. */
export function copyBlock(context: RenderContext, text: string, label: string): SafeHtml {
  const id = context.nextId("copy");
  return html`<div class="copy"><pre id="${id}" tabindex="0" aria-label="${label}">${clip(text, MAX_COPY_CHARS)}</pre><button type="button" data-copy="${id}" aria-label="Copy ${label}">Copy</button></div>`;
}

export function card(content: SafeHtml, className = ""): SafeHtml {
  return html`<div class="card${className ? ` ${className}` : ""}">${content}</div>`;
}
