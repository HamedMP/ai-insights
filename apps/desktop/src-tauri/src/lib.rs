//! The tray app: a tray icon, one popover window, and a background loop that refreshes the numbers by
//! running the person's own `ai-insights` CLI. The app makes no network requests of its own.

mod cli;
mod nudge;
mod placement;
mod schedule;
mod settings;
mod summary;

use serde::Serialize;
use settings::{NudgeState, Settings};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use summary::Summary;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const POPOVER: &str = "popover";
/// Logical size, as in tauri.conf.json.
const POPOVER_SIZE: (f64, f64) = (360.0, 560.0);
const SUMMARY_TIMEOUT: Duration = Duration::from_secs(120);
const REPORT_TIMEOUT: Duration = Duration::from_secs(300);
/// Opening the popover refreshes only when the numbers are older than this.
const STALE_ON_OPEN: Duration = Duration::from_secs(120);
/// The loop wakes once a minute to see whether anything is due; it never spins.
const TICK: Duration = Duration::from_secs(60);
/// A click on the tray icon right after the popover hid itself (the click took its focus) must not reopen it.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Problem {
    CliMissing,
    /// The CLI rejected `summary --json` as a usage error: it predates the command.
    CliTooOld,
    Timeout,
    Failed,
    BadOutput,
    ReportFailed,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    summary: Option<Summary>,
    problem: Option<Problem>,
    /// When the shown summary was read (milliseconds since the epoch).
    fetched_at: Option<u64>,
    refreshing: bool,
    /// Where the CLI was found, shown in settings so a person can tell which install is used.
    cli_location: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ViewState {
    snapshot: Snapshot,
    settings: Settings,
    platform: &'static str,
    /// Read from the OS (login item / autostart entry), which is the source of truth.
    launch_at_login: bool,
    /// The next nudge in local time (RFC 3339), when one is scheduled.
    next_nudge_at: Option<String>,
}

struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    nudge_state_path: PathBuf,
    nudge_state: Mutex<NudgeState>,
    launch_at_login: AtomicBool,
    snapshot: Mutex<Snapshot>,
    busy: AtomicBool,
    last_attempt: Mutex<Option<SystemTime>>,
    last_hidden: Mutex<Option<Instant>>,
    shell_path: OnceLock<Option<OsString>>,
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A panic elsewhere must not leave the popover unable to read state; the data is still usable.
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn view_state(state: &AppState) -> ViewState {
    let settings = lock(&state.settings).clone();
    let next_nudge_at = schedule::next_slot(&settings.nudge, &chrono::Local::now()).map(|t| t.to_rfc3339());
    ViewState {
        snapshot: lock(&state.snapshot).clone(),
        settings,
        platform: platform(),
        launch_at_login: state.launch_at_login.load(Ordering::SeqCst),
        next_nudge_at,
    }
}

fn emit_state<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let _ = app.emit("state", view_state(&state));
}

fn find_cli(state: &AppState) -> Option<cli::Cli> {
    let override_path = lock(&state.settings).cli_path.clone().map(PathBuf::from);
    let shell_path = state.shell_path.get_or_init(cli::login_shell_path).clone();
    cli::locate(&cli::Search {
        override_path: override_path.as_deref(),
        env_override: std::env::var_os("AI_INSIGHTS_CLI").filter(|v| !v.is_empty()),
        path: std::env::var_os("PATH"),
        shell_path,
        home: home_dir(),
        appdata: std::env::var_os("APPDATA").map(PathBuf::from),
    })
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).filter(|h| !h.is_empty()).map(PathBuf::from)
}

/// Runs `ai-insights summary --json` once. Concurrent callers get the current state instead of a second run.
fn refresh_now<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    *lock(&state.last_attempt) = Some(SystemTime::now());
    lock(&state.snapshot).refreshing = true;
    emit_state(app);

    let found = find_cli(&state);
    let result = match &found {
        None => Err(Problem::CliMissing),
        Some(cli) => match cli.run(&["summary", "--json"], SUMMARY_TIMEOUT) {
            Ok(out) => summary::parse(&String::from_utf8_lossy(&out)).map_err(|_| Problem::BadOutput),
            Err(cli::RunError::Timeout) => Err(Problem::Timeout),
            Err(cli::RunError::Spawn) => Err(Problem::CliMissing),
            Err(cli::RunError::Failed(code)) => Err(problem_for_exit(code)),
            Err(cli::RunError::TooLarge) => Err(Problem::BadOutput),
        },
    };
    {
        let mut snap = lock(&state.snapshot);
        snap.refreshing = false;
        snap.cli_location = found.map(|c| c.program.to_string_lossy().to_string());
        match result {
            Ok(summary) => {
                snap.summary = Some(summary);
                snap.problem = None;
                snap.fetched_at = Some(now_ms());
            }
            // The last good numbers stay on screen, marked with the problem; a failure never blanks them.
            Err(problem) => snap.problem = Some(problem),
        }
    }
    state.busy.store(false, Ordering::SeqCst);
    emit_state(app);
}

/// The CLI exits 2 on a usage error (src/cli/main.ts), which for `summary --json` means a version from before
/// the command existed.
fn problem_for_exit(code: Option<i32>) -> Problem {
    if code == Some(2) {
        Problem::CliTooOld
    } else {
        Problem::Failed
    }
}

fn refresh_in_background<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || refresh_now(&app));
}

fn due(last: Option<SystemTime>, every: Duration) -> bool {
    match last {
        None => true,
        // A clock set backwards counts as due, so a refresh is never skipped for good.
        Some(at) => SystemTime::now().duration_since(at).map(|age| age >= every).unwrap_or(true),
    }
}

/// Sends the nudge when its slot has come. The numbers are refreshed first; if that fails, numbers read in
/// the last day are used, and with none the slot passes silently (a nudge is never an error message).
fn nudge_if_due<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let nudge = lock(&state.settings).nudge;
    let not_before = lock(&state.nudge_state).not_before();
    if schedule::due(&nudge, &chrono::Local::now(), not_before).is_none() {
        return;
    }
    {
        let mut ns = lock(&state.nudge_state);
        ns.last_fired_at = Some(chrono::Utc::now());
        if settings::save(&state.nudge_state_path, &*ns).is_err() {
            eprintln!("ai-insights-desktop: could not save nudge state");
        }
    }
    refresh_now(app);
    let snap = lock(&state.snapshot).clone();
    let fresh = snap.fetched_at.is_some_and(|at| now_ms().saturating_sub(at) < 24 * 3600 * 1000);
    let Some(summary) = snap.summary.filter(|_| fresh) else { return };
    if let Some(message) = nudge::message(nudge.cadence, &summary, cfg!(target_os = "macos")) {
        notify(app, message);
    }
}

fn notify<R: Runtime>(app: &AppHandle<R>, message: nudge::Message) {
    if app.notification().builder().title(message.title).body(message.body).show().is_err() {
        eprintln!("ai-insights-desktop: could not show a notification");
    }
}

fn start_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        let state = app.state::<AppState>();
        let every = Duration::from_secs(u64::from(lock(&state.settings).refresh_minutes) * 60);
        let last = *lock(&state.last_attempt);
        if due(last, every) {
            refresh_now(&app);
        }
        nudge_if_due(&app);
        std::thread::sleep(TICK);
    });
}

/// The report path from the CLI, only if it is an existing local .html file: nothing else is ever opened.
fn existing_report(path: Option<&str>) -> Option<PathBuf> {
    let path = Path::new(path?);
    let is_html = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("html"));
    (path.is_absolute() && is_html && path.is_file()).then(|| path.to_path_buf())
}

fn current_report(state: &AppState) -> Option<PathBuf> {
    let snap = lock(&state.snapshot);
    existing_report(snap.summary.as_ref().and_then(|s| s.report_path.as_deref()))
}

fn open_report_now<R: Runtime>(app: &AppHandle<R>) -> Result<(), Problem> {
    let state = app.state::<AppState>();
    let report = match current_report(&state) {
        Some(path) => path,
        None => {
            let cli = find_cli(&state).ok_or(Problem::CliMissing)?;
            cli.run(&["report", "--no-open", "--no-install-prompt"], REPORT_TIMEOUT).map_err(|e| match e {
                cli::RunError::Timeout => Problem::Timeout,
                _ => Problem::ReportFailed,
            })?;
            refresh_now(app);
            current_report(&state).ok_or(Problem::ReportFailed)?
        }
    };
    app.opener().open_path(report.to_string_lossy(), None::<&str>).map_err(|_| Problem::ReportFailed)
}

fn popover<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(POPOVER)
}

fn place<R: Runtime>(window: &WebviewWindow<R>, icon: Option<placement::Rect>) {
    // Before the window is first shown some platforms report 0x0; fall back to the configured size.
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = match window.outer_size() {
        Ok(s) if s.width > 0 && s.height > 0 => (f64::from(s.width), f64::from(s.height)),
        _ => (POPOVER_SIZE.0 * scale, POPOVER_SIZE.1 * scale),
    };
    let monitor = icon
        .and_then(|i| window.monitor_from_point(i.x, i.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let area = monitor.work_area();
    let screen = placement::Rect {
        x: f64::from(area.position.x),
        y: f64::from(area.position.y),
        width: f64::from(area.size.width),
        height: f64::from(area.size.height),
    };
    let (x, y) = match icon {
        Some(icon) => placement::below_or_above(icon, size, screen),
        None => placement::top_right(size, screen),
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_popover<R: Runtime>(app: &AppHandle<R>, icon: Option<placement::Rect>) {
    let Some(window) = popover(app) else { return };
    place(&window, icon);
    let _ = window.show();
    let _ = window.set_focus();
    let state = app.state::<AppState>();
    let stale = due(*lock(&state.last_attempt), STALE_ON_OPEN) || lock(&state.snapshot).problem.is_some();
    if stale {
        refresh_in_background(app);
    }
}

fn toggle_popover<R: Runtime>(app: &AppHandle<R>, icon: Option<placement::Rect>) {
    let Some(window) = popover(app) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let state = app.state::<AppState>();
    let just_hidden = lock(&state.last_hidden).is_some_and(|at| at.elapsed() < REOPEN_GUARD);
    if !just_hidden {
        show_popover(app, icon);
    }
}

fn icon_rect(rect: &tauri::Rect, scale: f64) -> placement::Rect {
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    placement::Rect { x: pos.x, y: pos.y, width: size.width, height: size.height }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open AI Insights", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
    let report = MenuItem::with_id(app, "report", "Open full report", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AI Insights", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &report, &PredefinedMenuItem::separator(app)?, &quit])?;

    let icon = if cfg!(target_os = "macos") {
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
    } else {
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?
    };
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("AI Insights")
        .menu(&menu)
        // Left click opens the popover; the menu is on right click (on Linux trays it is the only way in).
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_popover(app, None),
            "refresh" => refresh_in_background(app),
            "report" => {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = open_report_now(&app);
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left, button_state: MouseButtonState::Up, rect, ..
            } = event
            {
                let app = tray.app_handle();
                let scale = popover(app).and_then(|w| w.scale_factor().ok()).unwrap_or(1.0);
                toggle_popover(app, Some(icon_rect(&rect, scale)));
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> ViewState {
    view_state(&state)
}

#[tauri::command]
async fn refresh(app: AppHandle) -> ViewState {
    let worker = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || refresh_now(&worker)).await;
    view_state(&app.state::<AppState>())
}

#[tauri::command]
async fn open_report(app: AppHandle) -> Result<(), Problem> {
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || open_report_now(&worker))
        .await
        .unwrap_or(Err(Problem::ReportFailed));
    if result.is_ok() {
        if let Some(window) = popover(&app) {
            let _ = window.hide();
        }
    }
    result
}

#[tauri::command]
fn save_settings(app: AppHandle, state: tauri::State<'_, AppState>, settings: Settings) -> ViewState {
    let settings = settings.sanitized();
    let (cli_changed, nudge_changed) = {
        let old = lock(&state.settings);
        (old.cli_path != settings.cli_path, old.nudge != settings.nudge)
    };
    if settings::save(&state.settings_path, &settings).is_err() {
        eprintln!("ai-insights-desktop: could not save settings");
    }
    if nudge_changed {
        // A changed schedule starts from now: a slot that already passed today does not fire at once.
        let mut ns = lock(&state.nudge_state);
        ns.armed_at = Some(chrono::Utc::now());
        if settings::save(&state.nudge_state_path, &*ns).is_err() {
            eprintln!("ai-insights-desktop: could not save nudge state");
        }
    }
    *lock(&state.settings) = settings;
    if cli_changed {
        refresh_in_background(&app);
    }
    let view = view_state(&state);
    let _ = app.emit("state", view.clone());
    view
}

#[tauri::command]
fn set_launch_at_login(app: AppHandle, state: tauri::State<'_, AppState>, enabled: bool) -> ViewState {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    if result.is_err() {
        eprintln!("ai-insights-desktop: could not change launch at login");
    }
    state.launch_at_login.store(launcher.is_enabled().unwrap_or(false), Ordering::SeqCst);
    view_state(&state)
}

#[tauri::command]
fn send_test_nudge(app: AppHandle) {
    notify(&app, nudge::sample(cfg!(target_os = "macos")));
}

#[tauri::command]
fn hide_popover(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        // First, so a second launch (say, from the login item and by hand) only opens the running app's popover.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_popover(app, None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // A per-user LaunchAgent on macOS, an autostart .desktop entry on Linux, a Run key on Windows; all
        // created only when the person turns "Open at login" on, and removed when they turn it off.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            get_state,
            refresh,
            open_report,
            save_settings,
            set_launch_at_login,
            send_test_nudge,
            hide_popover,
            quit
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir()?;
            let settings_path = settings::file_in(&config_dir);
            let nudge_state_path = settings::state_file_in(&config_dir);
            let launch_at_login = app.autolaunch().is_enabled().unwrap_or(false);
            app.manage(AppState {
                settings: Mutex::new(settings::load(&settings_path)),
                settings_path,
                nudge_state: Mutex::new(settings::load_state(&nudge_state_path)),
                nudge_state_path,
                launch_at_login: AtomicBool::new(launch_at_login),
                snapshot: Mutex::new(Snapshot::default()),
                busy: AtomicBool::new(false),
                last_attempt: Mutex::new(None),
                last_hidden: Mutex::new(None),
                shell_path: OnceLock::new(),
            });
            build_tray(app.handle())?;
            start_loop(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == POPOVER => {
                if std::env::var_os("AI_INSIGHTS_DESKTOP_PIN").is_some() {
                    return;
                }
                *lock(&window.app_handle().state::<AppState>().last_hidden) = Some(Instant::now());
                let _ = window.hide();
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building the AI Insights tray app")
        .run(|app, event| match event {
            // For screenshots and trays that cannot be clicked (headless Linux): open the popover at start.
            tauri::RunEvent::Ready if std::env::var_os("AI_INSIGHTS_DESKTOP_SHOW").is_some() => show_popover(app, None),
            // Hiding the popover must not end the app; only Quit does.
            tauri::RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_existing_absolute_html_file_is_opened_as_the_report() {
        let dir = std::env::temp_dir().join(format!("aii-report-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let html = dir.join("report.html");
        let script = dir.join("report.sh");
        std::fs::write(&html, "<!doctype html>").unwrap();
        std::fs::write(&script, "").unwrap();
        assert_eq!(existing_report(html.to_str()), Some(html.clone()));
        assert_eq!(existing_report(script.to_str()), None);
        assert_eq!(existing_report(Some("report.html")), None);
        assert_eq!(existing_report(dir.join("missing.html").to_str()), None);
        assert_eq!(existing_report(None), None);
    }

    #[test]
    fn a_usage_error_means_the_cli_is_too_old_and_anything_else_is_a_failure() {
        assert_eq!(problem_for_exit(Some(2)), Problem::CliTooOld);
        assert_eq!(problem_for_exit(Some(1)), Problem::Failed);
        assert_eq!(problem_for_exit(None), Problem::Failed);
    }

    #[test]
    fn a_refresh_is_due_when_never_run_after_the_interval_or_after_a_clock_jump_back() {
        let every = Duration::from_secs(1800);
        assert!(due(None, every));
        assert!(!due(Some(SystemTime::now()), every));
        assert!(due(Some(SystemTime::now() - Duration::from_secs(1801)), every));
        assert!(due(Some(SystemTime::now() + Duration::from_secs(3600)), every));
    }
}
