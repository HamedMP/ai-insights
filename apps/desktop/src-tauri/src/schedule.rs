//! When a nudge is due. Pure: every function takes `now`, so tests drive the clock and the time zone.
//!
//! A nudge fires once per slot (a daily time, a weekday and time, or the last day of the month at a time).
//! If the computer was asleep or the app was not running at the slot, it fires on the next check within
//! `GRACE`; a slot older than that is skipped rather than delivered late. A slot before the moment the nudge
//! was turned on never fires, so turning one on at 17:30 for 17:00 waits for the next day.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Weekday};
use serde::{Deserialize, Serialize};

pub const GRACE: Duration = Duration::hours(12);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Cadence {
    #[default]
    Off,
    Daily,
    Weekly,
    Monthly,
}

/// An unknown or mistyped cadence reads as off: a nudge never starts from a value nobody chose.
impl<'de> Deserialize<'de> for Cadence {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(d)?;
        Ok(match value.as_str() {
            Some("daily") => Cadence::Daily,
            Some("weekly") => Cadence::Weekly,
            Some("monthly") => Cadence::Monthly,
            _ => Cadence::Off,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Nudge {
    pub cadence: Cadence,
    pub hour: u32,
    pub minute: u32,
    /// 1 = Monday … 7 = Sunday; used by weekly nudges.
    pub weekday: u32,
}

impl Default for Nudge {
    fn default() -> Self {
        // Friday late afternoon: most of "this week" has happened, and there is time to act on a tip.
        Nudge { cadence: Cadence::Off, hour: 16, minute: 0, weekday: 5 }
    }
}

impl Nudge {
    pub fn sanitized(self) -> Self {
        Nudge {
            cadence: self.cadence,
            hour: self.hour.min(23),
            minute: self.minute.min(59),
            weekday: self.weekday.clamp(1, 7),
        }
    }

    fn time(&self) -> NaiveTime {
        NaiveTime::from_hms_opt(self.hour.min(23), self.minute.min(59), 0).unwrap_or(NaiveTime::MIN)
    }

    fn weekday(&self) -> Weekday {
        Weekday::try_from((self.weekday.clamp(1, 7) - 1) as u8).unwrap_or(Weekday::Fri)
    }
}

/// The local wall-clock time on `date` as an instant in `tz`. In a spring-forward gap the slot moves to the
/// first minute after it; in an autumn overlap it is the earlier of the two.
fn at<Tz: TimeZone>(tz: &Tz, date: NaiveDate, time: NaiveTime) -> Option<DateTime<Tz>> {
    let naive = NaiveDateTime::new(date, time);
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(t) => Some(t),
        LocalResult::Ambiguous(early, _) => Some(early),
        LocalResult::None => (1..=180).find_map(|m| tz.from_local_datetime(&(naive + Duration::minutes(m))).earliest()),
    }
}

fn last_day_of_month(year: i32, month: u32) -> Option<NaiveDate> {
    let (y, m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(y, m, 1)?.pred_opt()
}

/// The slot on the scheduling "unit" containing `date`, and the unit before it.
fn slot_dates(nudge: &Nudge, date: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
    match nudge.cadence {
        Cadence::Off => None,
        Cadence::Daily => Some((date, date.pred_opt()?)),
        Cadence::Weekly => {
            let back = (7 + date.weekday().num_days_from_monday() - nudge.weekday().num_days_from_monday()) % 7;
            let this = date - Duration::days(i64::from(back));
            Some((this, this - Duration::days(7)))
        }
        Cadence::Monthly => {
            let this = last_day_of_month(date.year(), date.month())?;
            let first = NaiveDate::from_ymd_opt(date.year(), date.month(), 1)?;
            let prev = first.pred_opt()?;
            // `this` may be later in the month than `date`; the caller then falls back to `prev`.
            Some((this, prev))
        }
    }
}

/// The most recent slot at or before `now`.
pub fn last_slot<Tz: TimeZone>(nudge: &Nudge, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
    let tz = now.timezone();
    let (this, prev) = slot_dates(nudge, now.date_naive())?;
    let candidate = at(&tz, this, nudge.time())?;
    if candidate <= *now {
        Some(candidate)
    } else {
        at(&tz, prev, nudge.time())
    }
}

/// The first slot strictly after `now`, for "Next nudge: Friday 16:00".
pub fn next_slot<Tz: TimeZone>(nudge: &Nudge, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
    let tz = now.timezone();
    let mut date = now.date_naive();
    // At most a month and a bit ahead for any cadence; bounded so a bad value can never loop.
    for _ in 0..40 {
        if let Some((this, _)) = slot_dates(nudge, date) {
            if let Some(slot) = at(&tz, this, nudge.time()) {
                if slot > *now {
                    return Some(slot);
                }
            }
        } else {
            return None;
        }
        date = date.succ_opt()?;
    }
    None
}

/// The slot to fire now, if any. `not_before` is the later of the last nudge sent and the moment the
/// current schedule was turned on.
pub fn due<Tz: TimeZone>(
    nudge: &Nudge,
    now: &DateTime<Tz>,
    not_before: Option<DateTime<chrono::Utc>>,
) -> Option<DateTime<Tz>> {
    let slot = last_slot(nudge, now)?;
    if now.clone().signed_duration_since(slot.clone()) > GRACE {
        return None;
    }
    match not_before {
        Some(t) if slot.with_timezone(&chrono::Utc) <= t => None,
        _ => Some(slot),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, Utc};

    fn helsinki_winter() -> FixedOffset {
        FixedOffset::east_opt(2 * 3600).unwrap()
    }

    fn t(tz: &FixedOffset, y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<FixedOffset> {
        tz.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    fn nudge(cadence: Cadence, hour: u32, weekday: u32) -> Nudge {
        Nudge { cadence, hour, minute: 0, weekday }
    }

    #[test]
    fn off_never_fires() {
        let tz = helsinki_winter();
        assert_eq!(due(&nudge(Cadence::Off, 9, 1), &t(&tz, 2026, 11, 18, 9, 0), None), None);
        assert_eq!(next_slot(&nudge(Cadence::Off, 9, 1), &t(&tz, 2026, 11, 18, 9, 0)), None);
    }

    #[test]
    fn a_daily_nudge_fires_once_at_its_time_and_not_again_the_same_day() {
        let tz = helsinki_winter();
        let n = nudge(Cadence::Daily, 18, 1);
        assert_eq!(due(&n, &t(&tz, 2026, 11, 18, 17, 59), Some(t(&tz, 2026, 11, 17, 18, 0).with_timezone(&Utc))), None);
        let slot = due(&n, &t(&tz, 2026, 11, 18, 18, 1), Some(t(&tz, 2026, 11, 17, 18, 0).with_timezone(&Utc)));
        assert_eq!(slot, Some(t(&tz, 2026, 11, 18, 18, 0)));
        let fired = slot.unwrap().with_timezone(&Utc);
        assert_eq!(due(&n, &t(&tz, 2026, 11, 18, 23, 0), Some(fired)), None);
    }

    #[test]
    fn a_weekly_nudge_lands_on_its_weekday() {
        let tz = helsinki_winter();
        let friday = nudge(Cadence::Weekly, 16, 5);
        // 2026-11-18 is a Wednesday; the last Friday slot was the 13th, the next is the 20th.
        assert_eq!(last_slot(&friday, &t(&tz, 2026, 11, 18, 12, 0)), Some(t(&tz, 2026, 11, 13, 16, 0)));
        assert_eq!(next_slot(&friday, &t(&tz, 2026, 11, 18, 12, 0)), Some(t(&tz, 2026, 11, 20, 16, 0)));
        assert_eq!(due(&friday, &t(&tz, 2026, 11, 20, 16, 30), None), Some(t(&tz, 2026, 11, 20, 16, 0)));
    }

    #[test]
    fn a_monthly_nudge_comes_on_the_last_day_including_february_and_leap_years() {
        let tz = helsinki_winter();
        let n = nudge(Cadence::Monthly, 16, 1);
        assert_eq!(next_slot(&n, &t(&tz, 2026, 11, 18, 12, 0)), Some(t(&tz, 2026, 11, 30, 16, 0)));
        assert_eq!(next_slot(&n, &t(&tz, 2027, 2, 3, 12, 0)), Some(t(&tz, 2027, 2, 28, 16, 0)));
        assert_eq!(next_slot(&n, &t(&tz, 2028, 2, 3, 12, 0)), Some(t(&tz, 2028, 2, 29, 16, 0)));
        assert_eq!(last_slot(&n, &t(&tz, 2026, 12, 5, 12, 0)), Some(t(&tz, 2026, 11, 30, 16, 0)));
        assert_eq!(next_slot(&n, &t(&tz, 2026, 12, 31, 17, 0)), Some(t(&tz, 2027, 1, 31, 16, 0)));
    }

    #[test]
    fn a_slot_missed_while_asleep_fires_on_wake_within_the_grace_period_only() {
        let tz = helsinki_winter();
        let n = nudge(Cadence::Daily, 9, 1);
        assert_eq!(due(&n, &t(&tz, 2026, 11, 18, 20, 59), None), Some(t(&tz, 2026, 11, 18, 9, 0)));
        assert_eq!(due(&n, &t(&tz, 2026, 11, 18, 21, 1), None), None);
    }

    #[test]
    fn turning_a_nudge_on_after_todays_time_waits_for_the_next_slot() {
        let tz = helsinki_winter();
        let n = nudge(Cadence::Daily, 17, 1);
        let armed = t(&tz, 2026, 11, 18, 17, 30).with_timezone(&Utc);
        assert_eq!(due(&n, &t(&tz, 2026, 11, 18, 17, 31), Some(armed)), None);
        assert_eq!(due(&n, &t(&tz, 2026, 11, 19, 17, 0), Some(armed)), Some(t(&tz, 2026, 11, 19, 17, 0)));
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let n = Nudge { cadence: Cadence::Weekly, hour: 99, minute: 300, weekday: 0 }.sanitized();
        assert_eq!((n.hour, n.minute, n.weekday), (23, 59, 1));
    }

    #[test]
    fn a_time_inside_a_daylight_saving_gap_moves_forward_instead_of_vanishing() {
        // A zone with a one-hour gap at 03:00 on 2027-03-28 (Europe/Helsinki's rule), modelled directly.
        #[derive(Clone, Copy, Debug)]
        struct Gap;
        impl TimeZone for Gap {
            type Offset = FixedOffset;
            fn from_offset(_: &FixedOffset) -> Self {
                Gap
            }
            fn offset_from_local_date(&self, _: &NaiveDate) -> LocalResult<FixedOffset> {
                LocalResult::Single(FixedOffset::east_opt(7200).unwrap())
            }
            fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> LocalResult<FixedOffset> {
                let gap_start = NaiveDate::from_ymd_opt(2027, 3, 28).unwrap().and_hms_opt(3, 0, 0).unwrap();
                if *local >= gap_start && *local < gap_start + Duration::hours(1) {
                    LocalResult::None
                } else if *local >= gap_start {
                    LocalResult::Single(FixedOffset::east_opt(10800).unwrap())
                } else {
                    LocalResult::Single(FixedOffset::east_opt(7200).unwrap())
                }
            }
            fn offset_from_utc_date(&self, _: &NaiveDate) -> FixedOffset {
                FixedOffset::east_opt(7200).unwrap()
            }
            fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> FixedOffset {
                let switch = NaiveDate::from_ymd_opt(2027, 3, 28).unwrap().and_hms_opt(1, 0, 0).unwrap();
                FixedOffset::east_opt(if *utc >= switch { 10800 } else { 7200 }).unwrap()
            }
        }
        let n = Nudge { cadence: Cadence::Daily, hour: 3, minute: 30, weekday: 1 };
        let now = Gap
            .from_local_datetime(&NaiveDate::from_ymd_opt(2027, 3, 28).unwrap().and_hms_opt(2, 0, 0).unwrap())
            .unwrap();
        let slot = next_slot(&n, &now).expect("a slot that day");
        assert_eq!(slot.naive_local(), NaiveDate::from_ymd_opt(2027, 3, 28).unwrap().and_hms_opt(4, 0, 0).unwrap());
    }
}
