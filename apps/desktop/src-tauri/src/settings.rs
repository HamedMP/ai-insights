//! Settings, kept as one small JSON file in the app's own config folder.
//!
//! Every field has a default and is clamped on load, so a hand-edited, truncated or older file still
//! opens: the worst case is the defaults, never a crash. Unknown fields are dropped on the next save.

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
}

impl Default for Settings {
    fn default() -> Self {
        Settings { hide_cost: false, refresh_minutes: 30, cli_path: None }
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
        self
    }
}

pub fn file_in(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load(path: &Path) -> Settings {
    let too_big = std::fs::metadata(path).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(false);
    if too_big {
        return Settings::default();
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default()
        .sanitized()
}

/// Write through a temporary file and rename, so a crash mid-write leaves the old settings, not half a file.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?;
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
        let s = Settings { hide_cost: true, refresh_minutes: 45, cli_path: Some(cli) };
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
}
