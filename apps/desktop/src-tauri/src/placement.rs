//! Where the popover opens: under a menu bar icon at the top of the screen, above a taskbar icon at the
//! bottom, always inside the monitor. Pure, so it is tested without a window system.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const GAP: f64 = 6.0;
const MARGIN: f64 = 8.0;

/// Top-left corner for a window of `size` (width, height) opened from the tray icon at `icon`.
pub fn below_or_above(icon: Rect, size: (f64, f64), monitor: Rect) -> (f64, f64) {
    let (width, height) = size;
    let centre_x = icon.x + icon.width / 2.0;
    let x = clamp(centre_x - width / 2.0, monitor.x + MARGIN, monitor.x + monitor.width - width - MARGIN);
    let icon_in_top_half = icon.y + icon.height / 2.0 < monitor.y + monitor.height / 2.0;
    let y = if icon_in_top_half { icon.y + icon.height + GAP } else { icon.y - height - GAP };
    let y = clamp(y, monitor.y + MARGIN, monitor.y + monitor.height - height - MARGIN);
    (x.round(), y.round())
}

/// Top-right of the monitor, for trays that report no icon position (most Linux desktops).
pub fn top_right(size: (f64, f64), monitor: Rect) -> (f64, f64) {
    let x = monitor.x + monitor.width - size.0 - MARGIN * 2.0;
    let y = monitor.y + MARGIN * 4.0;
    (x.max(monitor.x).round(), y.round())
}

/// Like `f64::clamp`, but a window wider than the monitor pins to the left edge instead of panicking.
fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        min
    } else {
        value.clamp(min, max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 };

    #[test]
    fn opens_centred_under_a_macos_menu_bar_icon() {
        let icon = Rect { x: 1000.0, y: 0.0, width: 24.0, height: 24.0 };
        assert_eq!(below_or_above(icon, (360.0, 560.0), SCREEN), (832.0, 30.0));
    }

    #[test]
    fn opens_above_a_windows_taskbar_icon_and_stays_on_screen_at_the_edge() {
        let icon = Rect { x: 1420.0, y: 860.0, width: 20.0, height: 40.0 };
        let (x, y) = below_or_above(icon, (360.0, 560.0), SCREEN);
        assert_eq!(x, 1440.0 - 360.0 - 8.0);
        assert_eq!(y, 860.0 - 560.0 - 6.0);
    }

    #[test]
    fn works_on_a_second_monitor_with_an_offset_origin() {
        let second = Rect { x: -1920.0, y: 0.0, width: 1920.0, height: 1080.0 };
        let icon = Rect { x: -1910.0, y: 0.0, width: 22.0, height: 22.0 };
        let (x, _) = below_or_above(icon, (360.0, 560.0), second);
        assert_eq!(x, -1912.0);
    }

    #[test]
    fn a_tiny_screen_never_pushes_the_window_off_the_top() {
        let small = Rect { x: 0.0, y: 0.0, width: 300.0, height: 400.0 };
        let icon = Rect { x: 100.0, y: 0.0, width: 20.0, height: 20.0 };
        let (x, y) = below_or_above(icon, (360.0, 560.0), small);
        assert_eq!((x, y), (8.0, 8.0));
    }

    #[test]
    fn falls_back_to_the_top_right_corner() {
        assert_eq!(top_right((360.0, 560.0), SCREEN), (1064.0, 32.0));
    }
}
