# AI Insights for the menu bar and system tray

A small Tauri 2 app that shows today, this week and this month from your AI coding-agent history, with one
tip, in a popover under a menu bar (macOS) or tray (Windows, Linux) icon. It is a separate app, not part of
the `ai-insights` npm package: nothing in this folder ships in the package tarball, and the root `pnpm check`
and CI do not touch it (`.github/workflows/desktop.yml` builds it).

## How it gets its numbers

The app never parses history itself. It runs your own `ai-insights` CLI and reads `ai-insights summary --json`.
All knowledge of that JSON lives in one adapter, `src-tauri/src/summary.rs`, which tolerates missing or
mistyped fields so a CLI update cannot crash the app.

**Finding the CLI.** The app uses the copy you installed with `npm i -g ai-insights` (0.10.0 or newer, the first with `summary --json`; an older one gets an "update the CLI" notice), looked up in this order:

1. a path you set in Settings;
2. `AI_INSIGHTS_CLI` (for development);
3. the `PATH` your terminal would have (an interactive login shell, asked once with a 4 s limit, so nvm and fnm set up in `.zshrc` count), the app's own `PATH`, and the usual install
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
- The popover can call exactly eight commands (`src-tauri/capabilities/default.json`); no plugin is
  reachable from the page.
- Settings are one JSON file in the app's config folder, and `nudge-state.json` beside it records when the
  last nudge went out.

## Nudges and launch at login

Both are off by default. On first run the popover asks once whether you want a daily, weekly or monthly
nudge; "Not now" is a full answer. A nudge is a notification with counts only (sessions and active hours),
because it can show on a lock screen: no project names, prompts, tips or cost. A period with no sessions
sends nothing. The schedule lives in `src-tauri/src/schedule.rs` (pure, tested with a fixed clock and time
zone): a slot missed while the computer slept fires on wake within 12 hours, otherwise it is skipped, and
changing the schedule never fires a slot that already passed.

**Never two notifications.** `ai-insights schedule` (the CLI's own scheduled job) also notifies. With every
refresh the app reads `ai-insights schedule status --json`; while that reports `active: true`, the app sends no
nudges and Settings says "Scheduled notifications are already on (ai-insights schedule, every Monday at 09:00)"
with `ai-insights schedule off` as the way to switch. The app never turns the CLI schedule off itself. An older
CLI without `--json` counts as unknown, and the app's nudges work as before.

"Open at login" uses the OS's own mechanism and is created only when switched on: a per-user LaunchAgent
(`~/Library/LaunchAgents/AI Insights.plist`) on macOS, `~/.config/autostart/AI Insights.desktop` on Linux and
an entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` on Windows. Switching it off removes
it. A second launch only opens the running app's popover.

## Develop

Needs Node 20+, pnpm, Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS.

```bash
cd apps/desktop
pnpm install
pnpm dev                                                # your installed ai-insights (npm i -g ai-insights)
pnpm dev:fixture                                        # fixtures/fake-cli.mjs: fixed numbers, every error state
node scripts/synthetic-store.mjs /tmp/aii-synth "$(npm root -g)/ai-insights/dist/cli/main.js"
AI_INSIGHTS_CLI=/tmp/aii-synth/ai-insights pnpm dev     # your installed CLI on made-up transcripts
pnpm check                                              # typecheck, UI tests, UI build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Without the second argument, `synthetic-store.mjs` uses this checkout's `dist/cli/main.js` (run `pnpm build`
at the repo root first), for testing unreleased CLI changes. `fixtures/fake-cli.mjs` stands in for the CLI with the synthetic `fixtures/summary.json`;
`FAKE_CLI_MODE=slow|fail|garbage|empty|hang` exercises the error states. For screenshots,
`AI_INSIGHTS_DESKTOP_SHOW=1` opens the popover at start and `AI_INSIGHTS_DESKTOP_PIN=1` keeps it open when it
loses focus. On a headless Linux box, run it under `xvfb-run` and `dbus-run-session` (GTK waits for a
session bus).

## Distribution and signing

CI (`.github/workflows/desktop.yml`) produces **unsigned** builds as workflow artifacts: a universal macOS
`.dmg`, a Windows NSIS installer (per-user, no admin) and a Linux `.deb` and `.AppImage`. macOS builds are
ad-hoc signed (`signingIdentity: "-"`), which is not a Developer ID signature: it only lets the binary run on
Apple Silicon. Nothing is notarised, and there is no auto-update; both are separate decisions.

What people see with these builds today:

| System | First open | Way through |
| --- | --- | --- |
| macOS | Gatekeeper: "Apple could not verify 'AI Insights' is free of malware" | System Settings, Privacy & Security, Open Anyway (once) |
| Windows | SmartScreen: "Windows protected your PC" | More info, Run anyway |
| Linux | nothing | `apt install ./AI*.deb`, or `chmod +x` the AppImage |

To ship signed builds, the owner needs to provide (as GitHub Actions secrets; Tauri reads these names):

- **macOS signing**: an Apple Developer Program membership and a *Developer ID Application* certificate,
  exported as `.p12`: `APPLE_CERTIFICATE` (base64 of the .p12), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: Name (TEAMID)`).
- **macOS notarisation**: either an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, and the
  `.p8` file as `APPLE_API_KEY_PATH`) or an Apple ID with an app-specific password (`APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
- **Windows signing**: a code-signing certificate. New OV/EV certificates live on hardware or in a cloud HSM,
  so this is usually a cloud signing account (for example Azure Trusted Signing, or a CA's cloud signer)
  wired in through Tauri's `bundle.windows.signCommand`, plus its credentials. Without one, SmartScreen
  warns until the file builds reputation.
- **Linux** (optional): a GPG key to sign the AppImage or a package repository.
- **Where downloads live** (for example GitHub Releases) and, separately, whether to add an updater, which
  would be the app's first network request and needs its own wording on the site.
