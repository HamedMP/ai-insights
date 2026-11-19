import { cliScheduleNotice, clock, describeNext, describeNudge, nudgeFor, weekdayName } from "./model.js";
import type { Cadence, Settings, ViewState } from "./types.js";
import { h, icon, ICONS } from "./view.js";

export interface SettingsHandlers {
  onBack(): void;
  onSave(next: Settings): void;
  onLaunchAtLogin(enabled: boolean): void;
  onTestNudge(): void;
  onQuit(): void;
}

function nudgeGroup(state: ViewState, save: (patch: Partial<Settings>) => void, onTest: () => void): HTMLElement {
  const lock = cliScheduleNotice(state);
  if (lock) {
    return h(
      "section",
      { class: "group" },
      h("div", { class: "row" }, h("span", { class: "row-text" }, h("span", { class: "row-label" }, "Nudges"), h("span", { class: "row-hint" }, lock.title))),
      h("p", { class: "row-hint" }, lock.body),
      h("code", { class: "command" }, lock.command),
    );
  }
  const nudge = state.settings.nudge;
  const next = describeNext(state.nextNudgeAt);
  const controls: HTMLElement[] = [];
  if (nudge.cadence === "weekly") {
    const day = h("select", { class: "select", "aria-label": "Day" }, ...[1, 2, 3, 4, 5, 6, 7].map((n) => h("option", { value: String(n), selected: n === nudge.weekday }, weekdayName(n)))) as HTMLSelectElement;
    day.addEventListener("change", () => save({ nudge: { ...nudge, weekday: Number(day.value) } }));
    controls.push(day);
  }
  if (nudge.cadence !== "off") {
    const time = h("input", { type: "time", class: "select", value: clock(nudge.hour, nudge.minute), "aria-label": "Time", required: true }) as HTMLInputElement;
    time.addEventListener("change", () => {
      const match = /^(\d{1,2}):(\d{2})/.exec(time.value);
      if (match) save({ nudge: { ...nudge, hour: Number(match[1]), minute: Number(match[2]) } });
    });
    controls.push(time);
    const test = h("button", { type: "button", class: "link" }, "Send a test notification");
    test.addEventListener("click", onTest);
    controls.push(test);
  }
  const hint = nudge.cadence === "off" ? "Off. Pick how often to get a notification with your counts." : `${describeNudge(nudge)}.${next ? ` ${next}.` : ""}`;
  return h(
    "section",
    { class: "group" },
    h("div", { class: "row" }, h("span", { class: "row-text" }, h("span", { class: "row-label" }, "Nudges"), h("span", { class: "row-hint" }, hint))),
    segmented<Cadence>("Nudges", [["off", "Off"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]], nudge.cadence, (c) => save({ nudge: nudgeFor(c, nudge), onboarded: true })),
    controls.length ? h("div", { class: "row-controls" }, ...controls) : null,
    h("p", { class: "row-hint" }, "Notifications can show on a lock screen, so they hold counts only: sessions and hours."),
  );
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
      nudgeGroup(state, save, handlers.onTestNudge),
      h(
        "section",
        { class: "group" },
        toggle(
          "Open at login",
          state.platform === "macos" ? "Off by default. Adds a login item for AI Insights; turning this off removes it." : "Off by default. Starts AI Insights when you sign in; turning this off removes that.",
          state.launchAtLogin,
          handlers.onLaunchAtLogin,
        ),
      ),
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
