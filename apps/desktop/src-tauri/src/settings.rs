//! Settings, kept as one small JSON file in the app's own config folder.
//!
//! Every field has a default and is clamped on load, so a hand-edited, truncated or older file still
//! opens: the worst case is the defaults, never a crash. Unknown fields are dropped on the next save.

use crate::schedule::Nudge;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MIN_REFRESH_MINUTES: u32 = 15;
pub const MAX_REFRESH_MINUTES: u32 = 120;
const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_CLI_PATH: usize = 4096;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Hide estimated cost in the popover (it can be read over a shoulder). Cost shows by default.
    pub hide_cost: bool,
    pub refresh_minutes: u32,
    /// A CLI the person chose by hand, used instead of searching.
    pub cli_path: Option<String>,
    /// Off until the person picks a cadence; the first run asks.
    pub nudge: Nudge,
    /// Set once the first-run question has been answered (either way), so it is asked only once.
    pub onboarded: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { hide_cost: false, refresh_minutes: 30, cli_path: None, nudge: Nudge::default(), onboarded: false }
    }
}

impl Settings {
    /// Clamp every value into its allowed range; run on load and before every save.
    pub fn sanitized(mut self) -> Self {
        self.refresh_minutes = self.refresh_minutes.clamp(MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES);
        self.cli_path = self
            .cli_path
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty() && p.len() <= MAX_CLI_PATH && Path::new(p).is_absolute());
        self.nudge = self.nudge.sanitized();
        self
    }
}

/// When nudges were last sent and when the current schedule was turned on. Kept apart from settings
/// because the app writes it, not the person.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NudgeState {
    pub last_fired_at: Option<DateTime<Utc>>,
    pub armed_at: Option<DateTime<Utc>>,
}

impl NudgeState {
    /// Nothing at or before this moment may fire.
    pub fn not_before(&self) -> Option<DateTime<Utc>> {
        self.last_fired_at.max(self.armed_at)
    }
}

pub fn file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn state_file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("nudge-state.json")
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    let too_big = std::fs::metadata(path).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(false);
    if too_big {
        return T::default();
    }
    std::fs::read_to_string(path).ok().and_then(|raw| serde_json::from_str::<T>(&raw).ok()).unwrap_or_default()
}

pub fn load(path: &Path) -> Settings {
    read_json::<Settings>(path).sanitized()
}

pub fn load_state(path: &Path) -> NudgeState {
    read_json(path)
}

/// Write through a temporary file and rename, so a crash mid-write leaves the old file, not half a file.
pub fn save<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aii-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        file_in(&dir)
    }

    #[test]
    fn a_first_run_gets_the_defaults_with_cost_visible() {
        let s = load(&temp("missing"));
        assert_eq!(s, Settings::default());
        assert!(!s.hide_cost);
    }

    #[test]
    fn settings_survive_a_save_and_load() {
        let path = temp("roundtrip");
        let cli = std::env::temp_dir().join("ai-insights").to_string_lossy().to_string();
        let nudge = Nudge { cadence: crate::schedule::Cadence::Weekly, hour: 9, minute: 30, weekday: 1 };
        let s = Settings { hide_cost: true, refresh_minutes: 45, cli_path: Some(cli), nudge, onboarded: true };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn a_corrupt_or_oversized_file_falls_back_to_defaults() {
        let path = temp("corrupt");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Settings::default());
        std::fs::write(&path, " ".repeat(70 * 1024)).unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn out_of_range_and_unknown_values_are_clamped_or_dropped() {
        let path = temp("clamp");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"refreshMinutes":1,"cliPath":"relative/path","futureField":true,"hideCost":true}"#)
            .unwrap();
        let s = load(&path);
        assert_eq!(s.refresh_minutes, MIN_REFRESH_MINUTES);
        assert_eq!(s.cli_path, None);
        assert!(s.hide_cost);
    }

    #[test]
    fn nudges_are_off_and_the_first_run_question_unanswered_by_default() {
        let s = Settings::default();
        assert_eq!(s.nudge.cadence, crate::schedule::Cadence::Off);
        assert!(!s.onboarded);
    }

    #[test]
    fn an_unknown_cadence_falls_back_to_defaults_instead_of_failing_to_load() {
        let path = temp("cadence");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"nudge":{"cadence":"hourly"},"hideCost":true}"#).unwrap();
        let s = load(&path);
        assert_eq!(s.nudge.cadence, crate::schedule::Cadence::Off);
        assert!(s.hide_cost);
    }

    #[test]
    fn nudge_state_round_trips_and_takes_the_later_moment() {
        let dir = std::env::temp_dir().join(format!("aii-state-{}", std::process::id()));
        let path = state_file_in(&dir);
        let early: DateTime<Utc> = "2026-11-01T10:00:00Z".parse().unwrap();
        let late: DateTime<Utc> = "2026-11-02T10:00:00Z".parse().unwrap();
        let state = NudgeState { last_fired_at: Some(early), armed_at: Some(late) };
        save(&path, &state).unwrap();
        assert_eq!(load_state(&path), state);
        assert_eq!(state.not_before(), Some(late));
        assert_eq!(NudgeState::default().not_before(), None);
    }
}
