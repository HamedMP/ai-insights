//! Finding and running the person's own `ai-insights` CLI.
//!
//! The app never bundles or downloads the CLI and never uses `npx` (which contacts the registry). It runs
//! the copy the person installed (`npm i -g ai-insights`), so the popover, the report and the agent plugin
//! all read the same store with the same version. Apps started from a dock or a launcher do not get the
//! terminal's PATH (nvm, fnm, Volta and Homebrew add themselves in shell startup files), so the search
//! also asks the login shell once and checks the usual install folders.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

/// Enough for any summary; output beyond this is a broken CLI, not data.
const MAX_STDOUT: u64 = 4 * 1024 * 1024;
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, PartialEq)]
pub struct Cli {
    /// The program to start: the `ai-insights` launcher, or `node` with the package's entry script.
    pub program: PathBuf,
    pub prefix_args: Vec<OsString>,
    /// PATH for the child, so `#!/usr/bin/env node` finds the same Node the person's terminal would.
    pub path_env: OsString,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RunError {
    /// Could not start it at all (missing, not executable, no Node).
    Spawn,
    Timeout,
    /// It ran and exited non-zero.
    Failed(Option<i32>),
    /// More output than any summary could be.
    TooLarge,
}

/// Where to look, from the most to the least specific. `home` and the env values are passed in so tests
/// can build a fake machine.
pub struct Search<'a> {
    pub override_path: Option<&'a Path>,
    pub env_override: Option<OsString>,
    pub path: Option<OsString>,
    pub shell_path: Option<OsString>,
    pub home: Option<PathBuf>,
    pub appdata: Option<PathBuf>,
}

pub fn locate(search: &Search) -> Option<Cli> {
    let path_env = joined_path(search);
    let explicit =
        search.override_path.map(Path::to_path_buf).or_else(|| search.env_override.as_ref().map(PathBuf::from));
    if let Some(path) = explicit {
        return is_file(&path).then(|| launcher(path, &path_env));
    }
    for dir in std::env::split_paths(&path_env) {
        for name in binary_names() {
            let candidate = dir.join(name);
            if is_file(&candidate) {
                return Some(launcher(candidate, &path_env));
            }
        }
    }
    None
}

/// The directories a child process should see: the app's PATH, the login shell's, then known install folders.
fn joined_path(search: &Search) -> OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for source in [&search.path, &search.shell_path].into_iter().flatten() {
        dirs.extend(std::env::split_paths(source));
    }
    dirs.extend(known_dirs(search.home.as_deref(), search.appdata.as_deref()));
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    std::env::join_paths(dirs).unwrap_or_default()
}

fn known_dirs(home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin")];
    if let Some(home) = home {
        for rel in [
            ".local/bin",
            ".npm-global/bin",
            ".volta/bin",
            ".bun/bin",
            ".local/share/pnpm",
            "Library/pnpm",
            ".local/share/fnm/aliases/default/bin",
            "Library/Application Support/fnm/aliases/default/bin",
            ".fnm/aliases/default/bin",
            ".asdf/shims",
            ".local/share/mise/shims",
        ] {
            dirs.push(home.join(rel));
        }
        dirs.extend(newest_nvm_bin(home));
    }
    if let Some(appdata) = appdata {
        dirs.push(appdata.join("npm"));
    }
    dirs
}

/// nvm keeps one folder per Node version; the newest one is the likeliest to hold a global install.
fn newest_nvm_bin(home: &Path) -> Option<PathBuf> {
    let versions = std::fs::read_dir(home.join(".nvm/versions/node")).ok()?;
    let mut best: Option<(Vec<u64>, PathBuf)> = None;
    for entry in versions.flatten().take(64) {
        let name = entry.file_name().to_string_lossy().to_string();
        let parts: Vec<u64> = name.trim_start_matches('v').split('.').filter_map(|p| p.parse().ok()).collect();
        if parts.len() == 3 && best.as_ref().is_none_or(|(b, _)| parts > *b) {
            best = Some((parts, entry.path().join("bin")));
        }
    }
    best.map(|(_, path)| path)
}

fn binary_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["ai-insights.cmd", "ai-insights.exe"]
    } else {
        &["ai-insights"]
    }
}

/// On Windows an npm global install is a `.cmd` shim; starting `node` on the package's own entry script
/// instead avoids a console window and cmd.exe argument quoting.
fn launcher(path: PathBuf, path_env: &OsString) -> Cli {
    if cfg!(windows) && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        if let Some(dir) = path.parent() {
            let script = dir.join("node_modules").join("ai-insights").join("dist").join("cli").join("main.js");
            let node = [dir.join("node.exe")]
                .into_iter()
                .chain(std::env::split_paths(path_env).map(|d| d.join("node.exe")))
                .find(|p| is_file(p));
            if let (true, Some(node)) = (is_file(&script), node) {
                return Cli { program: node, prefix_args: vec![script.into_os_string()], path_env: path_env.clone() };
            }
        }
    }
    // A path to the package's own entry script (a checkout's dist/cli/main.js, say) is run with Node, so it
    // works without an executable bit or a shebang PATH lookup.
    if path.extension().is_some_and(|e| ["js", "mjs", "cjs"].iter().any(|x| e.eq_ignore_ascii_case(x))) {
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        if let Some(node) = std::env::split_paths(path_env).map(|d| d.join(node_name)).find(|p| is_file(p)) {
            return Cli { program: node, prefix_args: vec![path.into_os_string()], path_env: path_env.clone() };
        }
    }
    Cli { program: path, prefix_args: Vec::new(), path_env: path_env.clone() }
}

fn is_file(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

/// The PATH a terminal would have, asked for once at start. nvm and fnm usually set themselves up in
/// `.zshrc`/`.bashrc`, which only interactive shells read, so an interactive login shell is tried first and a
/// plain login shell second. Startup files may print anything, so the PATH is read between markers.
/// Best effort: a slow or noisy profile only costs this lookup, never the app.
pub fn login_shell_path() -> Option<OsString> {
    if cfg!(windows) {
        return None;
    }
    let shell = std::env::var_os("SHELL").filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/sh".into());
    ["-ilc", "-lc"].iter().find_map(|flags| {
        let mut cmd = Command::new(&shell);
        cmd.args([flags, "printf '%s%s%s' __AII_PATH__ \"$PATH\" __AII_END__"]);
        let out = run_bounded(cmd, SHELL_PATH_TIMEOUT).ok()?;
        between_markers(&String::from_utf8_lossy(&out)).map(OsString::from)
    })
}

fn between_markers(text: &str) -> Option<String> {
    let start = text.rfind("__AII_PATH__")? + "__AII_PATH__".len();
    let end = start + text[start..].find("__AII_END__")?;
    let path = text[start..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

impl Cli {
    pub fn run(&self, args: &[&str], timeout: Duration) -> Result<Vec<u8>, RunError> {
        let mut cmd = Command::new(&self.program);
        cmd.args(&self.prefix_args)
            .args(args)
            .env("PATH", &self.path_env)
            .env("NO_COLOR", "1")
            .env("AI_INSIGHTS_NO_INSTALL_PROMPT", "1");
        run_bounded(cmd, timeout)
    }
}

/// Runs a command with no stdin, a deadline and capped output; kills it when the deadline passes.
pub fn run_bounded(mut cmd: Command, timeout: Duration) -> Result<Vec<u8>, RunError> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|_| RunError::Spawn)?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut out = Vec::new();
        let mut too_large = false;
        if let Some(pipe) = stdout {
            let mut limited = pipe.take(MAX_STDOUT + 1);
            let _ = limited.read_to_end(&mut out);
            too_large = out.len() as u64 > MAX_STDOUT;
            // Keep draining so a chatty child is not blocked on a full pipe before it exits or is killed.
            let mut rest = limited.into_inner();
            let _ = std::io::copy(&mut rest, &mut std::io::sink());
        }
        let _ = tx.send((out, too_large));
    });
    // stderr is never shown (it can hold paths); it is only drained so the child cannot block on it.
    thread::spawn(move || {
        if let Some(mut pipe) = stderr {
            let _ = std::io::copy(&mut pipe, &mut std::io::sink());
        }
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => break None,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => break None,
        }
    };
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        // The reader threads are left to finish on their own: a grandchild may still hold the pipes open.
        drop(reader);
        return Err(RunError::Timeout);
    };
    let (out, too_large) = rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
    if !status.success() {
        return Err(RunError::Failed(status.code()));
    }
    if too_large {
        return Err(RunError::TooLarge);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aii-desktop-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn empty_search<'a>() -> Search<'a> {
        Search { override_path: None, env_override: None, path: None, shell_path: None, home: None, appdata: None }
    }

    #[test]
    fn an_explicit_path_that_does_not_exist_is_not_found_rather_than_falling_back() {
        let dir = temp_dir("explicit");
        let missing = dir.join("nope");
        let search = Search { override_path: Some(&missing), path: Some(dir.as_os_str().into()), ..empty_search() };
        assert_eq!(locate(&search), None);
    }

    #[cfg(unix)]
    #[test]
    fn finds_a_global_install_through_the_login_shell_path_when_the_app_path_lacks_it() {
        let dir = temp_dir("shellpath");
        let bin = dir.join("ai-insights");
        fs::write(&bin, "#!/bin/sh\n").unwrap();
        let search =
            Search { path: Some("/nonexistent".into()), shell_path: Some(dir.as_os_str().into()), ..empty_search() };
        let cli = locate(&search).expect("found");
        assert_eq!(cli.program, bin);
        assert!(std::env::split_paths(&cli.path_env).any(|d| d == dir));
    }

    #[cfg(unix)]
    #[test]
    fn finds_the_newest_nvm_node_install_under_home() {
        let home = temp_dir("nvm");
        for v in ["v18.20.0", "v24.2.0", "v20.11.1"] {
            let bin = home.join(".nvm/versions/node").join(v).join("bin");
            fs::create_dir_all(&bin).unwrap();
            fs::write(bin.join("ai-insights"), "").unwrap();
        }
        let search = Search { home: Some(home.clone()), path: Some("/nonexistent".into()), ..empty_search() };
        let cli = locate(&search).unwrap();
        assert!(cli.program.ends_with("v24.2.0/bin/ai-insights"), "{:?}", cli.program);
    }

    #[test]
    fn the_shell_path_is_read_between_markers_whatever_startup_files_print() {
        let noisy = "Welcome!\n\x1b[1mupdate available\x1b[0m\n__AII_PATH__/opt/a:/opt/b__AII_END__\nbye";
        assert_eq!(between_markers(noisy), Some("/opt/a:/opt/b".to_string()));
        assert_eq!(between_markers("no markers"), None);
        assert_eq!(between_markers("__AII_PATH____AII_END__"), None);
    }

    #[cfg(unix)]
    #[test]
    fn asks_a_real_shell_for_its_path() {
        let path = login_shell_path().expect("a PATH from the shell");
        assert!(!path.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn an_entry_script_path_is_run_with_node_from_the_path() {
        let dir = temp_dir("script");
        let script = dir.join("main.js");
        fs::write(&script, "").unwrap();
        fs::write(dir.join("node"), "").unwrap();
        let search = Search { override_path: Some(&script), path: Some(dir.as_os_str().into()), ..empty_search() };
        let cli = locate(&search).unwrap();
        assert_eq!(cli.program, dir.join("node"));
        assert_eq!(cli.prefix_args, vec![script.into_os_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn runs_and_returns_stdout() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "echo '{\"ok\":1}'; echo noise >&2"]);
        assert_eq!(run_bounded(cmd, Duration::from_secs(5)).unwrap(), b"{\"ok\":1}\n");
    }

    #[cfg(unix)]
    #[test]
    fn a_hanging_cli_is_killed_at_the_deadline() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "sleep 30"]);
        let started = Instant::now();
        assert_eq!(run_bounded(cmd, Duration::from_millis(300)), Err(RunError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_cli_reports_its_exit_code_and_a_missing_one_cannot_spawn() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "exit 3"]);
        assert_eq!(run_bounded(cmd, Duration::from_secs(5)), Err(RunError::Failed(Some(3))));
        let missing = Command::new("/nonexistent/ai-insights");
        assert_eq!(run_bounded(missing, Duration::from_secs(5)), Err(RunError::Spawn));
    }

    #[cfg(unix)]
    #[test]
    fn output_beyond_the_cap_is_refused() {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "head -c 5000000 /dev/zero"]);
        assert_eq!(run_bounded(cmd, Duration::from_secs(10)), Err(RunError::TooLarge));
    }
}
