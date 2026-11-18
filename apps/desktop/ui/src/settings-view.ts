import type { Settings, ViewState } from "./types.js";
import { h, icon, ICONS } from "./view.js";

export interface SettingsHandlers {
  onBack(): void;
  onSave(next: Settings): void;
  onQuit(): void;
}

function toggle(label: string, hint: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", role: "switch", checked }) as HTMLInputElement;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "row toggle" }, h("span", { class: "row-text" }, h("span", { class: "row-label" }, label), h("span", { class: "row-hint" }, hint)), input);
}

function segmented<T extends string | number>(name: string, options: Array<[T, string]>, value: T, onChange: (value: T) => void): HTMLElement {
  return h(
    "div",
    { class: "seg", role: "radiogroup", "aria-label": name },
    ...options.map(([option, label]) => {
      const button = h("button", { type: "button", role: "radio", "aria-checked": String(option === value) }, label);
      button.addEventListener("click", () => onChange(option));
      return button;
    }),
  );
}

export function settingsView(state: ViewState, handlers: SettingsHandlers): HTMLElement {
  const settings = state.settings;
  const save = (patch: Partial<Settings>) => handlers.onSave({ ...settings, ...patch });

  const back = h("button", { class: "icon-button", type: "button", "aria-label": "Back" });
  back.append(icon(ICONS.back));
  back.addEventListener("click", handlers.onBack);

  const cliInput = h("input", {
    type: "text",
    class: "text-input",
    spellcheck: "false",
    placeholder: "Found automatically",
    value: settings.cliPath ?? "",
    "aria-label": "Path to the ai-insights command",
  }) as HTMLInputElement;
  cliInput.addEventListener("change", () => save({ cliPath: cliInput.value.trim() || null }));

  const quit = h("button", { class: "secondary danger", type: "button" }, "Quit AI Insights");
  quit.addEventListener("click", handlers.onQuit);

  const found = state.snapshot.cliLocation;
  return h(
    "div",
    { class: "view" },
    h("header", { class: "top" }, h("div", { class: "brand" }, back, h("p", { class: "wordmark" }, "Settings"))),
    h(
      "main",
      { class: "body settings" },
      h("section", { class: "group" }, toggle("Hide cost", "Leave estimated cost out of the popover, for screens others can see.", settings.hideCost, (v) => save({ hideCost: v }))),
      h(
        "section",
        { class: "group" },
        h("div", { class: "row" }, h("span", { class: "row-text" }, h("span", { class: "row-label" }, "Refresh every"), h("span", { class: "row-hint" }, "Also refreshes when you open this window."))),
        segmented("Refresh every", [[15, "15 min"], [30, "30 min"], [60, "1 h"]], settings.refreshMinutes, (v) => save({ refreshMinutes: v })),
      ),
      h(
        "section",
        { class: "group" },
        h("div", { class: "row" }, h("span", { class: "row-text" }, h("span", { class: "row-label" }, "AI Insights CLI"), h("span", { class: "row-hint" }, found ? `Using ${found}` : "Not found yet. Install it with npm i -g ai-insights, or enter its full path."))),
        cliInput,
      ),
      h(
        "section",
        { class: "group privacy-copy" },
        h("p", { class: "eyebrow" }, "Privacy"),
        h(
          "ul",
          {},
          h("li", {}, "This app runs the ai-insights command on this computer to count your sessions. It reads nothing else."),
          h("li", {}, "It makes no network requests: no analytics, no update checks, no fonts from the web."),
          h("li", {}, "Your settings are one small file in this app's own folder. Quit stops everything; the docs at ai-insights.app/docs/desktop show how to remove it all."),
        ),
      ),
      quit,
    ),
  );
}
