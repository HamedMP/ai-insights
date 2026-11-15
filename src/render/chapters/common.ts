import type { Finding, Suggestion } from "../../schema/types.js";
import { rich } from "../components.js";
import { html, type SafeHtml } from "../html.js";
import type { RankedAction } from "../story.js";

/** Position of each suggestion in the ranked action list, so a chapter tip can point to it. */
export type ActionIndex = Map<Suggestion, { anchor: string; rank: number }>;

export function indexActions(actions: RankedAction[]): ActionIndex {
  const index: ActionIndex = new Map();
  actions.forEach((action, position) => index.set(action.suggestion, { anchor: `action-${position + 1}`, rank: position + 1 }));
  return index;
}

/** The "try this" line under a chapter, drawn from the finding that chapter is about. */
export function tryThis(finding: Finding | null | undefined, actions: ActionIndex): SafeHtml | null {
  const suggestion = finding?.suggestion;
  if (!finding || !suggestion) return null;
  const ranked = actions.get(suggestion);
  return html`<aside class="tip reveal"><span class="micro tip-label">Try this</span><div class="tip-body"><b>${rich(suggestion.title, 160)}</b><span>${rich(suggestion.action, 400)}</span></div>${
    ranked ? html`<a class="tip-link micro" href="#${ranked.anchor}">${ranked.rank <= 3 ? `#${ranked.rank} in what to improve` : "See how"} →</a>` : null
  }</aside>`;
}
