# AI Insights for the menu bar and system tray

A small Tauri 2 app that shows today, this week and this month from your AI coding-agent history, with one
tip, in a popover under a menu bar (macOS) or tray (Windows, Linux) icon. It is a separate app, not part of
the `ai-insights` npm package: nothing in this folder ships in the package tarball, and the root `pnpm check`
and CI do not touch it (`.github/workflows/desktop.yml` builds it).

## How it gets its numbers

The app never parses history itself. It runs your own `ai-insights` CLI and reads `ai-insights summary --json`.
All knowledge of that JSON lives in one adapter, `src-tauri/src/summary.rs`, which tolerates missing or
mistyped fields so a CLI update cannot crash the app.

**Finding the CLI.** The app uses the copy you installed with `npm i -g ai-insights`, looked up in this order:

1. a path you set in Settings;
2. `AI_INSIGHTS_CLI` (for development);
3. your login shell's `PATH` (asked once, with a 4 s limit), the app's own `PATH`, and the usual install
   folders: Homebrew, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin`, Volta, fnm, the newest nvm
   version, pnpm, Bun, asdf, mise, and `%APPDATA%\npm` on Windows.

Why not bundle a copy: the CLI needs Node anyway, so a bundled copy would still depend on your Node while
adding a second version of the CLI that writes the same `~/.ai-insights` store as your agent plugin. Using
your install keeps one version, keeps the app a few MB, and means the app never downloads anything. It never
runs `npx`, which contacts the npm registry.

Every run has a deadline (2 min for the summary, 5 min to write a report), capped output and no stdin. A
failure shows a short explanation and keeps the last numbers on screen.

## Privacy

- No network requests: no update checks, no analytics, no web fonts (Bricolage Grotesque and Geist are
  bundled, SIL OFL). The page's CSP is `default-src 'none'` plus the app's own files and IPC.
- The popover can call exactly six commands (`src-tauri/capabilities/default.json`); no plugin is reachable
  from the page.
- Settings are one JSON file in the app's config folder.

## Develop

Needs Node 20+, pnpm, Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS.

```bash
cd apps/desktop
pnpm install
AI_INSIGHTS_CLI="$PWD/fixtures/fake-cli.mjs" pnpm dev   # synthetic numbers, no real history
pnpm check                                              # typecheck, UI tests, UI build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`fixtures/fake-cli.mjs` stands in for the CLI with the synthetic `fixtures/summary.json`;
`FAKE_CLI_MODE=slow|fail|garbage|empty|hang` exercises the error states. For screenshots,
`AI_INSIGHTS_DESKTOP_SHOW=1` opens the popover at start and `AI_INSIGHTS_DESKTOP_PIN=1` keeps it open when it
loses focus. On a headless Linux box, run it under `xvfb-run` and `dbus-run-session` (GTK waits for a
session bus).
