// No console window next to the tray app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_insights_desktop_lib::run();
}
