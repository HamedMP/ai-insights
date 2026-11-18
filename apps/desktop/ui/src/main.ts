// Wires the popover to the Rust side. Everything goes through the eight commands the capability file
// allows (src-tauri/capabilities/default.json) and one "state" event.

import { buildModel, nudgeFor, problemNotice } from "./model.js";
import { settingsView } from "./settings-view.js";
import type { Cadence, Problem, Settings, ViewState } from "./types.js";
import { mainView } from "./view.js";

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> };
}

const tauri = (window as unknown as { __TAURI__: TauriGlobal }).__TAURI__;
const root = document.getElementById("app")!;

let state: ViewState | null = null;
let screen: "main" | "settings" = "main";
let reportProblem: Problem | null = null;
let openingReport = false;

function typingInSettings(): boolean {
  const el = document.activeElement;
  return screen === "settings" && el instanceof HTMLInputElement && el.type === "text";
}

function render(): void {
  if (!state) return;
  // A background refresh must not wipe a path the person is still typing; it renders on blur instead.
  if (typingInSettings()) return;
  document.documentElement.dataset.platform = state.platform;
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.getAttribute("aria-label") ?? active?.textContent ?? null;
  if (screen === "settings") {
    root.replaceChildren(
      settingsView(state, {
        onBack: () => go("main"),
        onSave: (next: Settings) => void tauri.core.invoke<ViewState>("save_settings", { settings: next }).then(update),
        onLaunchAtLogin: (enabled: boolean) => void tauri.core.invoke<ViewState>("set_launch_at_login", { enabled }).then(update),
        onTestNudge: () => void tauri.core.invoke("send_test_nudge"),
        onQuit: () => void tauri.core.invoke("quit"),
      }),
    );
  } else {
    const model = buildModel(state, Date.now());
    if (reportProblem) model.notice = problemNotice(reportProblem);
    model.openingReport = openingReport;
    root.replaceChildren(
      mainView(model, {
        onRefresh: () => void tauri.core.invoke<ViewState>("refresh").then(update),
        onSettings: () => go("settings"),
        onOpenReport: openReport,
        onChooseNudge: chooseNudge,
      }),
    );
  }
  // Re-rendering replaces the elements; keep keyboard focus on the same control.
  if (focusKey) {
    const again = [...root.querySelectorAll<HTMLElement>("button, input")].find((el) => (el.getAttribute("aria-label") ?? el.textContent) === focusKey);
    again?.focus();
  }
}

function update(next: ViewState): void {
  state = next;
  render();
}

function go(next: "main" | "settings"): void {
  screen = next;
  render();
}

function chooseNudge(cadence: Cadence): void {
  if (!state) return;
  const settings: Settings = { ...state.settings, nudge: nudgeFor(cadence, state.settings.nudge), onboarded: true };
  void tauri.core.invoke<ViewState>("save_settings", { settings }).then(update);
}

async function openReport(): Promise<void> {
  openingReport = true;
  reportProblem = null;
  render();
  try {
    await tauri.core.invoke("open_report");
  } catch (problem) {
    reportProblem = typeof problem === "string" ? (problem as Problem) : "reportFailed";
  } finally {
    openingReport = false;
    render();
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (screen === "settings") go("main");
  else void tauri.core.invoke("hide_popover");
});

// "Updated 3 min ago" stays true while the popover is open.
setInterval(render, 60_000);

void tauri.event.listen<ViewState>("state", (event) => update(event.payload));
void tauri.core.invoke<ViewState>("get_state").then(update);
