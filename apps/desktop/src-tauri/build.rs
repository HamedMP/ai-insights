fn main() {
    // Declaring the app's commands makes each one need an explicit permission, so the capability file
    // is the complete list of what the popover can ask the Rust side to do.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "get_state",
        "refresh",
        "open_report",
        "save_settings",
        "hide_popover",
        "quit",
    ])))
    .expect("failed to run tauri-build");
}
