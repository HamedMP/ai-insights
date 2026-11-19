//! Whether the CLI's own `ai-insights schedule` job is on (`schedule status --json`, schemaVersion 1).
//!
//! That job shows its own notification, so while it is active the app sends none: a person never gets two
//! for the same period. The app only reads the status; turning the schedule off is the person's call
//! (`ai-insights schedule off`). An older CLI without `--json`, or any answer this cannot read, counts as
//! unknown, and the app's own nudges work as before.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSchedule {
    pub active: bool,
    /// In words, from the CLI: "every Monday at 09:00".
    pub when: Option<String>,
}

pub fn parse(raw: &str) -> Option<CliSchedule> {
    let start = raw.find('{')?;
    let value: Value = serde_json::from_str(raw[start..].trim_end()).ok()?;
    let root = value.as_object()?;
    let active = root.get("active")?.as_bool()?;
    let when = root
        .get("when")
        .and_then(Value::as_str)
        .map(|w| w.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect::<String>())
        .filter(|w| !w.is_empty());
    Some(CliSchedule { active, when })
}

/// The app's own nudges run unless the CLI's schedule is known to be on.
pub fn app_nudges_allowed(cli: Option<&CliSchedule>) -> bool {
    !cli.is_some_and(|c| c.active)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_active_cli_schedule_turns_the_app_nudges_off() {
        let s = parse(
            r#"{"schemaVersion":1,"active":true,"system":"launchd","cadence":"weekly","hour":9,"minute":0,"weekday":1,"when":"every Monday at 09:00","nextRun":"2026-11-23T07:00:00.000Z","lastRun":null}"#,
        )
        .unwrap();
        assert_eq!(s, CliSchedule { active: true, when: Some("every Monday at 09:00".into()) });
        assert!(!app_nudges_allowed(Some(&s)));
    }

    #[test]
    fn no_schedule_keeps_the_app_nudges_as_they_are() {
        let s = parse(r#"{"schemaVersion":1,"active":false,"when":null}"#).unwrap();
        assert!(!s.active);
        assert!(app_nudges_allowed(Some(&s)));
    }

    #[test]
    fn an_unreadable_answer_or_an_old_cli_counts_as_unknown_and_changes_nothing() {
        assert_eq!(parse("ai-insights schedule: unknown option \"--json\""), None);
        assert_eq!(parse(r#"{"schemaVersion":1}"#), None);
        assert_eq!(parse(r#"{"active":"yes"}"#), None);
        assert!(app_nudges_allowed(None));
    }
}
