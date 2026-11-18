//! The one adapter between `ai-insights summary --json` and the app.
//!
//! The CLI owns that JSON's shape and it will change, so nothing else in the app reads it. Parsing goes
//! through `serde_json::Value` by hand: a missing field, a wrong type or an unknown period degrades that
//! one value to "unknown" instead of failing the whole summary. Strings and lists are capped because the
//! output is shown in a small popover and kept in memory for the app's lifetime.

use serde::Serialize;
use serde_json::Value;

/// The contract version this adapter was written against. A higher one is still read, best effort.
pub const KNOWN_SCHEMA: u64 = 1;

const MAX_TEXT: usize = 400;
const MAX_LABEL: usize = 48;
const MAX_ROWS: usize = 12;
const MAX_PATH: usize = 4096;

/// Chat-export harnesses record no model, tokens or cost (AGENTS.md); their usage is "not measured".
const CHAT_HARNESSES: [&str; 2] = ["claude-chat", "chatgpt"];

pub const PERIOD_KEYS: [&str; 3] = ["today", "week", "month"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub schema_version: u64,
    /// True when the CLI speaks a newer contract than this app knows; the popover suggests an update.
    pub newer_schema: bool,
    pub generated_at: Option<String>,
    pub timezone: Option<String>,
    /// Always today, week, month in that order; a period the CLI left out is `None`.
    pub periods: Vec<Option<Period>>,
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub key: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub sessions: Option<u64>,
    pub active_minutes: Option<f64>,
    pub prompts: Option<u64>,
    pub tokens_total: Option<u64>,
    pub cost_usd: Option<f64>,
    pub unpriced_share: Option<f64>,
    pub by_agent: Vec<AgentRow>,
    pub tip: Option<Tip>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRow {
    pub agent: String,
    pub label: String,
    pub sessions: Option<u64>,
    pub cost_usd: Option<f64>,
    /// False for chat exports: show "not measured", never 0 or an estimate.
    pub measured: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Tip {
    pub id: String,
    pub text: String,
}

#[derive(Debug, PartialEq)]
pub enum ParseError {
    NotJson,
    NotAnObject,
}

pub fn parse(raw: &str) -> Result<Summary, ParseError> {
    // The CLI may print a line of its own before the JSON in some versions; start at the first brace.
    let start = raw.find('{').ok_or(ParseError::NotJson)?;
    let value: Value = serde_json::from_str(raw[start..].trim_end()).map_err(|_| ParseError::NotJson)?;
    let root = value.as_object().ok_or(ParseError::NotAnObject)?;
    let schema_version = root.get("schemaVersion").and_then(Value::as_u64).unwrap_or(KNOWN_SCHEMA);
    let periods_value = root.get("periods").and_then(Value::as_object);
    let periods = PERIOD_KEYS
        .iter()
        .map(|key| periods_value.and_then(|all| all.get(*key)).and_then(|p| period(key, p)))
        .collect();
    Ok(Summary {
        schema_version,
        newer_schema: schema_version > KNOWN_SCHEMA,
        generated_at: text(root.get("generatedAt"), 64),
        timezone: text(root.get("timezone"), 64),
        periods,
        report_path: text(root.get("reportPath"), MAX_PATH),
    })
}

fn period(key: &str, value: &Value) -> Option<Period> {
    let p = value.as_object()?;
    let tokens_total = match p.get("tokens") {
        Some(Value::Object(tokens)) => count(tokens.get("total")).or_else(|| {
            let parts = ["input", "output", "cacheRead", "cacheWrite"].map(|k| count(tokens.get(k)));
            parts.iter().any(Option::is_some).then(|| parts.iter().flatten().sum())
        }),
        _ => None,
    };
    Some(Period {
        key: key.to_string(),
        from: text(p.get("from"), 64),
        to: text(p.get("to"), 64),
        sessions: count(p.get("sessions")),
        active_minutes: amount(p.get("activeMinutes")),
        prompts: count(p.get("prompts")),
        tokens_total,
        cost_usd: amount(p.get("costUsd")),
        unpriced_share: amount(p.get("unpricedRequestShare")).map(|s| s.clamp(0.0, 1.0)),
        by_agent: p
            .get("byAgent")
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(agent_row).take(MAX_ROWS).collect())
            .unwrap_or_default(),
        tip: p.get("tip").and_then(tip),
    })
}

fn agent_row(value: &Value) -> Option<AgentRow> {
    let row = value.as_object()?;
    let agent = text(row.get("agent"), MAX_LABEL)?;
    let declared_chat = row.get("kind").and_then(Value::as_str) == Some("chat")
        || row.get("measured").and_then(Value::as_bool) == Some(false);
    let measured = !declared_chat && !CHAT_HARNESSES.contains(&agent.as_str());
    Some(AgentRow {
        label: text(row.get("label"), MAX_LABEL).unwrap_or_else(|| agent.clone()),
        sessions: count(row.get("sessions")),
        cost_usd: if measured { amount(row.get("costUsd")) } else { None },
        measured,
        agent,
    })
}

fn tip(value: &Value) -> Option<Tip> {
    let tip = value.as_object()?;
    Some(Tip { id: text(tip.get("id"), 64).unwrap_or_default(), text: text(tip.get("text"), MAX_TEXT)? })
}

/// A non-empty string, whitespace collapsed, cut to `max` characters on a character boundary.
fn text(value: Option<&Value>, max: usize) -> Option<String> {
    let raw = value?.as_str()?;
    let collapsed: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() <= max {
        return Some(collapsed);
    }
    let cut: String = collapsed.chars().take(max.saturating_sub(1)).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// A whole, non-negative count. Floats are accepted when they are whole; anything else is unknown.
fn count(value: Option<&Value>) -> Option<u64> {
    let v = value?;
    v.as_u64().or_else(|| {
        let f = v.as_f64()?;
        (f >= 0.0 && f.fract() == 0.0 && f < 9.0e15).then_some(f as u64)
    })
}

/// A finite, non-negative amount.
fn amount(value: Option<&Value>) -> Option<f64> {
    let f = value?.as_f64()?;
    (f.is_finite() && f >= 0.0).then_some(f)
}

impl Summary {
    pub fn period(&self, key: &str) -> Option<&Period> {
        self.periods.iter().flatten().find(|p| p.key == key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../fixtures/summary.json");

    #[test]
    fn reads_the_fixture_the_popover_is_designed_against() {
        let s = parse(FIXTURE).expect("fixture parses");
        assert_eq!(s.schema_version, 1);
        assert!(!s.newer_schema);
        let week = s.period("week").expect("week present");
        assert_eq!(week.sessions, Some(41));
        assert_eq!(week.active_minutes, Some(366.0));
        assert!(week.tip.is_some());
        assert_eq!(s.periods.len(), 3);
    }

    #[test]
    fn chat_exports_are_never_shown_with_a_cost() {
        let s = parse(FIXTURE).unwrap();
        let week = s.period("week").unwrap();
        let chat = week.by_agent.iter().find(|r| r.agent == "claude-chat").expect("chat row");
        assert!(!chat.measured);
        assert_eq!(chat.cost_usd, None);
        let coding = week.by_agent.iter().find(|r| r.agent == "claude-code").unwrap();
        assert!(coding.measured);
    }

    #[test]
    fn an_explicit_not_measured_flag_wins_over_a_reported_cost() {
        let raw = r#"{"periods":{"today":{"byAgent":[{"agent":"new-chat","measured":false,"costUsd":0}]}}}"#;
        let parsed = parse(raw).unwrap();
        let row = &parsed.period("today").unwrap().by_agent[0];
        assert!(!row.measured);
        assert_eq!(row.cost_usd, None);
        assert_eq!(row.label, "new-chat");
    }

    #[test]
    fn missing_and_wrongly_typed_fields_degrade_to_unknown_not_to_an_error() {
        let raw = r#"{"schemaVersion":"1","periods":{"week":{"sessions":"many","activeMinutes":-3,"costUsd":null,"tokens":"x","tip":{"id":"a"}}}}"#;
        let s = parse(raw).unwrap();
        let week = s.period("week").unwrap();
        assert_eq!(week.sessions, None);
        assert_eq!(week.active_minutes, None);
        assert_eq!(week.cost_usd, None);
        assert_eq!(week.tokens_total, None);
        assert_eq!(week.tip, None);
        assert!(s.period("today").is_none());
        assert_eq!(s.report_path, None);
    }

    #[test]
    fn token_total_is_summed_from_parts_when_the_total_is_missing() {
        let raw = r#"{"periods":{"today":{"tokens":{"input":10,"output":5,"cacheRead":null}}}}"#;
        assert_eq!(parse(raw).unwrap().period("today").unwrap().tokens_total, Some(15));
    }

    #[test]
    fn a_newer_contract_is_read_and_flagged() {
        let s = parse(r#"{"schemaVersion":3,"periods":{}}"#).unwrap();
        assert!(s.newer_schema);
        assert!(s.periods.iter().all(Option::is_none));
    }

    #[test]
    fn noise_before_the_json_is_skipped_and_garbage_is_an_error() {
        assert!(parse("warning: something\n{\"periods\":{}}").is_ok());
        assert_eq!(parse("not json"), Err(ParseError::NotJson));
        assert_eq!(parse("{ truncated"), Err(ParseError::NotJson));
        assert_eq!(parse("[1,2]"), Err(ParseError::NotJson));
    }

    #[test]
    fn long_text_and_long_lists_are_capped() {
        let rows: Vec<String> = (0..40).map(|i| format!(r#"{{"agent":"a{i}","sessions":1}}"#)).collect();
        let raw = format!(
            r#"{{"periods":{{"today":{{"byAgent":[{}],"tip":{{"id":"t","text":"{}"}}}}}}}}"#,
            rows.join(","),
            "word ".repeat(500)
        );
        let today = parse(&raw).unwrap().period("today").unwrap().clone();
        assert_eq!(today.by_agent.len(), MAX_ROWS);
        let tip = today.tip.unwrap().text;
        assert!(tip.chars().count() <= MAX_TEXT);
        assert!(tip.ends_with('…'));
    }

    #[test]
    fn unpriced_share_is_clamped_to_a_fraction() {
        let raw = r#"{"periods":{"month":{"unpricedRequestShare":4}}}"#;
        assert_eq!(parse(raw).unwrap().period("month").unwrap().unpriced_share, Some(1.0));
    }
}
