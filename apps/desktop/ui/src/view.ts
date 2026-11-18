// Turns the model into elements. Text only ever goes in through textContent, never innerHTML, so nothing
// the CLI prints can become markup.

import type { Model, Notice } from "./model.js";
import type { Cadence } from "./types.js";

type Child = Node | string | null | false | undefined;

export function h(tag: string, attrs: Record<string, string | boolean> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    el.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A stroked 24x24 icon from path data; decorative, so hidden from screen readers. */
export function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export const ICONS = {
  refresh: ["M20 11a8 8 0 1 0-2.34 5.66", "M20 4v7h-7"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z",
  ],
  back: ["M15 18l-6-6 6-6"],
  lock: ["M6 11h12v10H6z", "M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"],
  arrow: ["M7 17 17 7", "M8 7h9v9"],
  spark: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4", "M5.6 5.6l2.8 2.8", "M15.6 15.6l2.8 2.8", "M5.6 18.4l2.8-2.8", "M15.6 8.4l2.8-2.8"],
};

export function rabbit(): HTMLElement {
  return h("span", { class: "rabbit", "aria-hidden": "true" });
}

export function noticeView(notice: Notice): HTMLElement {
  return h(
    "section",
    { class: `notice notice-${notice.tone}`, role: "status" },
    h("p", { class: "notice-title" }, notice.title),
    h("p", { class: "notice-body" }, notice.body),
    notice.command ? h("code", { class: "command" }, notice.command) : null,
  );
}

export interface MainHandlers {
  onRefresh(): void;
  onSettings(): void;
  onOpenReport(): void;
  onChooseNudge(cadence: Cadence): void;
}

/** Asked once on first run. Every answer, including "Not now", is final until changed in Settings. */
function askView(onChoose: (cadence: Cadence) => void): HTMLElement {
  const choice = (cadence: Cadence, label: string, cls = "chip") => {
    const button = h("button", { type: "button", class: cls }, label);
    button.addEventListener("click", () => onChoose(cadence));
    return button;
  };
  return h(
    "section",
    { class: "ask", "aria-label": "Nudges" },
    h("p", { class: "eyebrow" }, "Want a regular look back?"),
    h("p", { class: "ask-text" }, "Get a short notification with your counts. Sessions and hours only, never project names or prompts."),
    h("div", { class: "chips" }, choice("daily", "Daily"), choice("weekly", "Weekly"), choice("monthly", "Monthly"), choice("off", "Not now", "chip quiet")),
  );
}

export function header(model: Model, handlers: Pick<MainHandlers, "onRefresh" | "onSettings">): HTMLElement {
  const refresh = h("button", { class: "icon-button", type: "button", "aria-label": "Refresh", title: "Refresh", disabled: model.refreshing });
  refresh.append(icon(ICONS.refresh));
  refresh.classList.toggle("spinning", model.refreshing);
  refresh.addEventListener("click", handlers.onRefresh);
  const settings = h("button", { class: "icon-button", type: "button", "aria-label": "Settings", title: "Settings" });
  settings.append(icon(ICONS.settings));
  settings.addEventListener("click", handlers.onSettings);
  return h(
    "header",
    { class: "top" },
    h("div", { class: "brand" }, rabbit(), h("div", {}, h("p", { class: "wordmark" }, "AI Insights"), h("p", { class: "updated", "aria-live": "polite" }, model.updated))),
    h("div", { class: "top-actions" }, refresh, settings),
  );
}

function tipView(model: Model): HTMLElement | null {
  if (model.empty) {
    return h(
      "section",
      { class: "tip tip-empty" },
      h("p", { class: "eyebrow" }, "Nothing yet"),
      h("p", { class: "tip-text" }, "No agent sessions this month. Your numbers appear here after your next session with Claude Code, Codex or another supported agent."),
    );
  }
  if (!model.tip) return null;
  return h("section", { class: "tip" }, h("p", { class: "eyebrow" }, model.tip.scope), h("p", { class: "tip-text" }, model.tip.text));
}

function statsView(model: Model): HTMLElement {
  const head = h("tr", {}, h("th", { scope: "col" }, h("span", { class: "sr" }, "Measure")), ...model.columns.map((c) => h("th", { scope: "col" }, c.label)));
  const row = (label: string, values: string[], cls = "") =>
    h("tr", { class: cls }, h("th", { scope: "row" }, label), ...values.map((v) => h("td", { class: v === "–" ? "na" : "" }, v)));
  const rows = [
    row("Sessions", model.columns.map((c) => c.sessions), "big"),
    row("Active", model.columns.map((c) => c.active)),
    model.showCost ? row("Est. cost", model.columns.map((c) => c.cost), "cost") : null,
  ];
  return h(
    "section",
    { class: "stats" },
    h("table", {}, h("thead", {}, head), h("tbody", {}, ...rows)),
    model.costNote ? h("p", { class: "fine" }, model.costNote) : null,
  );
}

function agentsView(model: Model): HTMLElement | null {
  if (model.agents.length === 0) return null;
  return h(
    "section",
    { class: "agents" },
    h("p", { class: "eyebrow" }, model.agentsTitle),
    h(
      "ul",
      {},
      ...model.agents.map((a) =>
        h("li", {}, h("span", { class: "agent-name" }, a.label), h("span", { class: "agent-sessions" }, a.sessions), h("span", { class: a.measured ? "agent-cost" : "agent-cost unmeasured" }, a.cost)),
      ),
    ),
  );
}

function loadingView(): HTMLElement {
  return h(
    "section",
    { class: "loading", "aria-busy": "true" },
    h("p", { class: "eyebrow" }, "Reading your history"),
    h("p", { class: "tip-text" }, "Counting today, this week and this month on this computer. The first time can take a little while."),
    h("div", { class: "skeleton" }, h("span", {}), h("span", {}), h("span", {})),
  );
}

export function mainView(model: Model, handlers: MainHandlers): HTMLElement {
  // Without a CLI there is no report to open; the main action becomes checking again after installing it.
  const report = h("button", { class: "primary", type: "button" });
  if (model.canOpenReport) {
    report.append(model.openingReport ? "Opening report…" : "Open full report", icon(ICONS.arrow));
    report.toggleAttribute("disabled", model.openingReport);
    report.addEventListener("click", handlers.onOpenReport);
  } else {
    report.append(model.refreshing ? "Checking…" : "Check again", icon(ICONS.refresh));
    report.toggleAttribute("disabled", model.refreshing);
    report.addEventListener("click", handlers.onRefresh);
  }
  const hasData = !model.loading && model.columns.some((c) => c.sessions !== "–");
  return h(
    "div",
    { class: "view" },
    header(model, handlers),
    h(
      "main",
      { class: "body" },
      model.askAboutNudges ? askView(handlers.onChooseNudge) : null,
      model.notice ? noticeView(model.notice) : null,
      model.loading ? loadingView() : null,
      hasData ? tipView(model) : null,
      hasData ? statsView(model) : null,
      hasData ? agentsView(model) : null,
      model.footnote ? h("p", { class: "fine" }, model.footnote) : null,
    ),
    h("footer", { class: "bottom" }, report, h("p", { class: "privacy" }, icon(ICONS.lock), "Runs on this computer. Nothing leaves it.")),
  );
}
