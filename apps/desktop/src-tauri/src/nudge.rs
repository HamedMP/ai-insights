//! The words of a nudge. A notification can show on a lock screen, so it carries counts only: sessions and
//! active hours. No project names, no prompts, no tip text, no cost.

use crate::schedule::Cadence;
use crate::summary::Summary;

pub struct Message {
    pub title: String,
    pub body: String,
}

pub fn hours(minutes: f64) -> String {
    if minutes < 60.0 {
        return format!("{} min", minutes.round() as u64);
    }
    let h = minutes / 60.0;
    if h < 100.0 {
        format!("{h:.1} h")
    } else {
        format!("{} h", h.round() as u64)
    }
}

fn sessions(n: u64) -> String {
    if n == 1 {
        "1 session".to_string()
    } else {
        format!("{n} sessions")
    }
}

/// `None` when there is nothing to say: a period with no sessions sends no nudge.
pub fn message(cadence: Cadence, summary: &Summary, macos: bool) -> Option<Message> {
    let (key, lead) = match cadence {
        Cadence::Off => return None,
        Cadence::Daily => ("today", "Today with your agents"),
        Cadence::Weekly => ("week", "Your weekly AI Insights are ready"),
        Cadence::Monthly => ("month", "Your monthly AI Insights are ready"),
    };
    let period = summary.period(key)?;
    let count = period.sessions.filter(|n| *n > 0)?;
    let mut line = format!("{lead}: {}", sessions(count));
    if let Some(minutes) = period.active_minutes.filter(|m| *m > 0.0) {
        line.push_str(&format!(", {}", hours(minutes)));
    }
    line.push('.');
    let place = if macos { "menu bar" } else { "tray" };
    Some(Message { title: "AI Insights".into(), body: format!("{line} Open AI Insights in the {place} for a tip.") })
}

/// The sample a person sees when they press "Send a test notification".
pub fn sample(macos: bool) -> Message {
    let place = if macos { "menu bar" } else { "tray" };
    Message {
        title: "AI Insights".into(),
        body: format!("This is how nudges look: counts only, like \"41 sessions, 6.1 h\". Open AI Insights in the {place} to change them."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::parse;

    const FIXTURE: &str = include_str!("../../fixtures/summary.json");

    #[test]
    fn a_weekly_nudge_has_counts_and_nothing_else() {
        let s = parse(FIXTURE).unwrap();
        let m = message(Cadence::Weekly, &s, true).unwrap();
        assert_eq!(
            m.body,
            "Your weekly AI Insights are ready: 41 sessions, 6.1 h. Open AI Insights in the menu bar for a tip."
        );
        let tip = s.period("week").unwrap().tip.as_ref().unwrap().text.clone();
        assert!(!m.body.contains(&tip));
        assert!(!m.body.contains('$'));
    }

    #[test]
    fn daily_and_monthly_use_their_own_period() {
        let s = parse(FIXTURE).unwrap();
        assert!(message(Cadence::Daily, &s, false)
            .unwrap()
            .body
            .starts_with("Today with your agents: 7 sessions, 2.3 h."));
        assert!(message(Cadence::Monthly, &s, false).unwrap().body.contains("168 sessions, 48.2 h"));
        assert!(message(Cadence::Monthly, &s, false).unwrap().body.ends_with("in the tray for a tip."));
    }

    #[test]
    fn no_sessions_means_no_nudge() {
        let s = parse(r#"{"periods":{"week":{"sessions":0,"activeMinutes":0}}}"#).unwrap();
        assert!(message(Cadence::Weekly, &s, true).is_none());
        assert!(message(Cadence::Off, &parse(FIXTURE).unwrap(), true).is_none());
        assert!(message(Cadence::Daily, &s, true).is_none());
    }

    #[test]
    fn hours_read_naturally() {
        assert_eq!(hours(45.0), "45 min");
        assert_eq!(hours(366.0), "6.1 h");
        assert_eq!(hours(9000.0), "150 h");
    }
}
