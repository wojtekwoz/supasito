use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{agent, devserver, models::Catalogue, sites::Site};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Persisted {
    pub sites: Vec<Site>,
    pub claude_path: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    /// `--effort` for new sessions (low, medium, high, xhigh, max); None = the user's own Claude Code default.
    pub effort: Option<String>,
    /// Fast mode for new sessions (Opus only; the CLI ignores it elsewhere).
    pub fast_mode: bool,
    /// Parts of the interface the user hid in Settings → Interface (keys from src/app/ui.ts); the UI owns the meaning.
    /// Absent from the file (a fresh install, or a state file from before the setting) means the default set below;
    /// an explicit `[]` is the user's "Show everything" and stays empty.
    #[serde(default = "default_hidden")]
    pub hidden: Vec<String>,
    /// Settings → Updates: whether the app asks once a day whether a newer version exists.
    /// Missing from the file (a fresh install, or a state file from before updates) means on.
    pub updates_enabled: bool,
    /// When it last asked, ms since the epoch, so it asks once a day and not once a launch.
    pub update_checked_at: i64,
    /// A version the user answered "Not now" to; the banner stays away until a later one appears.
    pub update_skipped: Option<String>,
    /// The model catalogue as last fetched (models.rs): Codex's from `model/list`, Claude's from the served file.
    pub models: Catalogue,
    /// Where New site and a pasted GitHub link put sites (PLAN §8e); None until the first one is added, when the
    /// dialog asks once, suggesting ~/Sites.
    pub sites_folder: Option<String>,
}

/// What a fresh install hides: the chips under the composer, the picker button in the composer, the keyboard hint,
/// the dev log button and the dev server status chip. Keep in step with `DEFAULT_HIDDEN` in src/app/ui.ts (the mock).
pub fn default_hidden() -> Vec<String> {
    ["knobs", "composerPick", "hint", "devLog", "devStatus"].map(String::from).to_vec()
}

impl Default for Persisted {
    fn default() -> Self {
        Self {
            sites: Vec::new(),
            claude_path: None,
            model: None,
            permission_mode: None,
            effort: None,
            fast_mode: false,
            hidden: default_hidden(),
            updates_enabled: true,
            update_checked_at: 0,
            update_skipped: None,
            models: Catalogue::default(),
            sites_folder: None,
        }
    }
}

pub struct AppState {
    pub persisted: Mutex<Persisted>,
    pub file: PathBuf,
    pub agents: agent::claude::Registry,
    /// Codex threads, one app-server per site (agent/codex.rs).
    pub codex: agent::codex::Registry,
    pub dev: devserver::Registry,
    /// Running publish commands by site id (process-group leader pid), so they can be cancelled.
    pub publishes: tokio::sync::Mutex<std::collections::HashMap<String, u32>>,
    /// PATH as seen by the user's login shell, so spawned tools resolve like in a terminal. Read
    /// again on "Check again", so a tool installed while Supasito was open is found without a restart.
    path_env: std::sync::RwLock<String>,
    /// The one clone that may run at a time (clone.rs), for Cancel.
    pub clone_slot: crate::clone::SlotRef,
    /// The GitHub sign-in in progress: its code, and whether the user cancelled the wait.
    pub github_code: Mutex<Option<crate::clone::DeviceCode>>,
    pub github_cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        let file = dir.join("state.json");
        // The app was called Open until 2026-09-06 and the app data dir follows the bundle identifier,
        // so the first start of Supasito on a Mac that ran Open carries its sites and settings over.
        if !file.exists() {
            if let Some(old) = dir.parent().map(|p| p.join("co.wozu.open").join("state.json")) {
                if old.exists() {
                    let _ = std::fs::copy(&old, &file);
                }
            }
        }
        let persisted = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<Persisted>(&s).ok())
            .unwrap_or_default();
        Ok(Self {
            persisted: Mutex::new(persisted),
            file,
            agents: agent::claude::Registry::new(dir.join("agent-pids.json")),
            codex: agent::codex::Registry::new(dir.join("codex-pids.json")),
            dev: devserver::Registry::new(dir.join("dev-pids.json")),
            publishes: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            path_env: std::sync::RwLock::new(login_shell_path()),
            clone_slot: Default::default(),
            github_code: Mutex::new(None),
            github_cancel: Default::default(),
        })
    }

    pub fn save(&self) -> Result<(), String> {
        let p = self.persisted.lock().unwrap().clone();
        let s = serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?;
        std::fs::write(&self.file, s).map_err(|e| e.to_string())
    }

    /// The running session behind an id, whichever backend it is.
    pub async fn agent(&self, session_id: &str) -> Result<agent::Agent, String> {
        if agent::codex::is_codex_session(session_id) {
            self.codex.get(session_id).await.map(agent::Agent::Codex)
        } else {
            self.agents.get(session_id).await.map(agent::Agent::Claude)
        }
        .ok_or_else(|| "session is not running".to_string())
    }

    /// The PATH to run everything with.
    pub fn path(&self) -> String {
        self.path_env.read().unwrap().clone()
    }

    /// Remember a freshly read PATH. `login_shell_path` spawns a shell, so the async side reads it
    /// on a blocking thread and hands the result here.
    pub fn set_path(&self, p: String) {
        *self.path_env.write().unwrap() = p;
    }

    pub fn site(&self, id: &str) -> Result<Site, String> {
        self.persisted
            .lock()
            .unwrap()
            .sites
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| "unknown site".to_string())
    }
}

/// Ask the user's login shell for its PATH. GUI apps on macOS start with a minimal PATH
/// that lacks Homebrew, nvm, pnpm, etc.
///
/// The cheap read (`-lc`, about 20 ms) answers for most Macs, and only when it comes back missing
/// something the app cannot run without do we pay for an interactive shell (about a second here,
/// more with a plugin-heavy `~/.zshrc`). That is the read that finds a version manager's node —
/// zsh sources `~/.zshrc` only when interactive, and that is where nvm, fnm, mise, volta and
/// pnpm's own installer write their PATH lines — so the Mac that needs the second pays it, and
/// nobody else waits at every start.
pub fn login_shell_path() -> String {
    // Debug builds can pretend to be a barer Mac: SUPASITO_PATH=/usr/bin:/bin pnpm tauri dev
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("SUPASITO_PATH") { return p; }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let fast = assemble(shell_path(&shell, false));
    if runs_the_app(&fast) { return fast; }
    match shell_path(&shell, true) {
        // A Terminal's own PATH: the honest answer once the cheap one has come up short, whether or
        // not it completes the set. The checklist says what is still missing and where we looked.
        Some(p) => assemble(Some(p)),
        None => fast,
    }
}

/// Node and one of the two agents — what Supasito needs to run at all. Anything less and the PATH
/// is worth a second look before the user is told their Mac is bare.
fn runs_the_app(path_env: &str) -> bool {
    let has = |bin: &str| crate::toolchain::which(bin, path_env).is_some();
    has("node") && (has("claude") || has("codex"))
}

/// A shell's PATH, plus this process's own, plus the folders things are installed into, in that
/// order and without repeats.
fn assemble(from_shell: Option<String>) -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();
    let push = |p: String, parts: &mut Vec<String>| {
        if !p.is_empty() && !parts.iter().any(|x| x == &p) { parts.push(p); }
    };
    for p in from_shell.unwrap_or_default().split(':').chain(base.split(':')).chain(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].into_iter(),
    ) {
        push(p.to_string(), &mut parts);
    }
    if let Some(home) = dirs::home_dir() {
        for extra in [".local/bin", ".claude/local", ".bun/bin"] {
            push(home.join(extra).to_string_lossy().to_string(), &mut parts);
        }
        for p in version_manager_bins(&home) {
            push(p, &mut parts);
        }
    }
    parts.join(":")
}

/// `$SHELL -ilc` (or `-lc`) printing its PATH between markers, because an interactive rc file
/// prints its own things first — a prompt theme, a greeting, `nvm` chatter. The exit status is
/// ignored for the same reason: an rc file that fails half-way still exported a usable PATH.
fn shell_path(shell: &str, interactive: bool) -> Option<String> {
    use std::io::Read;
    let mut child = std::process::Command::new(shell)
        .arg(if interactive { "-ilc" } else { "-lc" })
        .arg("printf '<<<SUPASITO:%s>>>' \"$PATH\"")
        // An rc file that waits for input reads EOF instead of hanging; its noise goes nowhere.
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    parse_marked_path(&out)
}

/// The PATH between the markers `shell_path` asked for, ignoring whatever the rc files printed.
fn parse_marked_path(out: &str) -> Option<String> {
    let rest = out.split("<<<SUPASITO:").nth(1)?;
    let path = rest.split(">>>").next()?.trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

/// Where the version managers keep the binaries they put on the PATH, so a Mac whose shell we
/// could not read is still not called bare. `node` matters twice over: npm's global installs
/// (Claude Code, Codex) live beside it, so missing it makes all three go missing at once.
fn version_manager_bins(home: &std::path::Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for rel in [
        "Library/pnpm",              // pnpm's own installer
        ".volta/bin",
        ".asdf/shims",
        ".local/share/mise/shims",
        ".npm-global/bin",           // npm prefix, the usual "don't sudo npm" advice
        ".npm-packages/bin",
        ".yarn/bin",
    ] {
        let p = home.join(rel);
        if p.is_dir() { out.push(p.to_string_lossy().to_string()); }
    }
    // nvm and fnm keep one folder per installed node; the newest is the best guess at the default.
    for (root, rel) in [
        (home.join(".nvm/versions/node"), "bin"),
        (home.join(".local/share/fnm/node-versions"), "installation/bin"),
        (home.join("Library/Application Support/fnm/node-versions"), "installation/bin"),
    ] {
        if let Some(p) = newest_version_dir(&root) {
            let bin = p.join(rel);
            if bin.is_dir() { out.push(bin.to_string_lossy().to_string()); }
        }
    }
    out
}

/// The `v22.14.0`-style subfolder with the highest version number.
fn newest_version_dir(root: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut best: Option<((u32, u32, u32), std::path::PathBuf)> = None;
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(v) = parse_version(&name) else { continue };
        if best.as_ref().map(|(b, _)| v > *b).unwrap_or(true) {
            best = Some((v, entry.path()));
        }
    }
    best.map(|(_, p)| p)
}

fn parse_version(name: &str) -> Option<(u32, u32, u32)> {
    let mut it = name.trim_start_matches('v').split('.');
    let n = |x: Option<&str>| x.and_then(|s| s.parse::<u32>().ok());
    Some((n(it.next())?, n(it.next()).unwrap_or(0), n(it.next()).unwrap_or(0)))
}

#[cfg(test)]
mod tests {
    use super::Persisted;

    /// An interactive rc file prints its own things — a prompt theme, a greeting, nvm chatter — before
    /// and after our line, and the PATH has to come out of that intact.
    #[test]
    fn path_is_read_out_of_whatever_the_rc_files_printed() {
        assert_eq!(
            super::parse_marked_path("Welcome!\n\u{1b}[1m<<<SUPASITO:/opt/homebrew/bin:/usr/bin>>>trailing"),
            Some("/opt/homebrew/bin:/usr/bin".to_string())
        );
        assert_eq!(super::parse_marked_path("<<<SUPASITO:>>>"), None);
        assert_eq!(super::parse_marked_path("nothing at all"), None);
    }

    /// nvm and fnm keep one folder per installed node; the newest is the best guess at the default,
    /// and "10" must not beat "9" the way a string sort would have it.
    #[test]
    fn newest_node_folder_wins_by_number() {
        let dir = std::env::temp_dir().join(format!("supasito-nvm-{}", std::process::id()));
        for v in ["v9.0.0", "v10.2.1", "v22.14.0", "lts", "v22.9.0"] {
            std::fs::create_dir_all(dir.join(v)).unwrap();
        }
        assert_eq!(super::newest_version_dir(&dir).unwrap().file_name().unwrap(), "v22.14.0");
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(super::newest_version_dir(&dir), None);
    }

    /// The PATH the app runs everything with must carry node, or a Mac with node under a version
    /// manager looks bare and Claude Code, Codex and the dev server all go missing at once.
    #[test]
    fn this_mac_resolves_node_without_inheriting_a_path() {
        let p = super::login_shell_path();
        assert!(crate::toolchain::which("node", &p).is_some(), "no node on {p}");
    }

    /// Why the code asks for an *interactive* shell at all, pinned so nobody simplifies it away:
    /// a PATH line in `~/.zshrc` — where nvm, fnm, mise, volta and pnpm's installer write theirs —
    /// reaches `zsh -ilc` and never reaches `zsh -lc`. This is the whole bug of 0.2.3, in a fixture.
    #[test]
    #[cfg(target_os = "macos")]
    fn only_an_interactive_shell_reads_zshrc() {
        let home = std::env::temp_dir().join(format!("supasito-home-{}", std::process::id()));
        let tools = home.join("tools");
        std::fs::create_dir_all(&tools).unwrap();
        // What a version manager's line looks like, minus the version manager.
        std::fs::write(home.join(".zshrc"), format!("export PATH=\"{}:$PATH\"\n", tools.display())).unwrap();
        std::fs::write(home.join(".zprofile"), "").unwrap();
        let read = |interactive: bool| {
            let out = std::process::Command::new("/bin/zsh")
                .arg(if interactive { "-ilc" } else { "-lc" })
                .arg("printf '<<<SUPASITO:%s>>>' \"$PATH\"")
                .env("HOME", &home)
                .env("PATH", "/usr/bin:/bin")
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output()
                .unwrap();
            super::parse_marked_path(&String::from_utf8_lossy(&out.stdout)).unwrap_or_default()
        };
        let folder = tools.to_string_lossy().to_string();
        assert!(!read(false).split(':').any(|d| d == folder), "a login shell must not see the .zshrc line");
        assert!(read(true).split(':').any(|d| d == folder), "an interactive shell must see it — the fix depends on it");
        std::fs::remove_dir_all(&home).unwrap();
    }

    /// What decides whether a start pays for an interactive shell: node and one agent is enough,
    /// anything less is worth the second look that finds a version manager's folders.
    #[test]
    fn a_path_without_node_or_an_agent_is_worth_a_second_look() {
        let dir = std::env::temp_dir().join(format!("supasito-bins-{}", std::process::id()));
        let bin = |name: &str| {
            let p = dir.join(name);
            std::fs::write(&p, "#!/bin/sh\n").unwrap();
            p
        };
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().to_string();
        assert!(!super::runs_the_app(&d), "empty folder");
        bin("node");
        assert!(!super::runs_the_app(&d), "node alone is not enough to run a turn");
        bin("codex");
        assert!(super::runs_the_app(&d), "node and either agent is the bar");
        std::fs::remove_file(dir.join("node")).unwrap();
        assert!(!super::runs_the_app(&d), "an agent without node cannot serve a preview");
        bin("node");
        bin("claude");
        assert!(super::runs_the_app(&d));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A state file without `hidden` (a fresh install, or one from before Settings → Interface) loads with the default
    /// set hidden; an explicit `[]` ("Show everything") loads empty; and the list must survive a save/load round trip as
    /// the UI wrote it.
    #[test]
    fn hidden_defaults_and_round_trips() {
        let old: Persisted = serde_json::from_str(r#"{"sites":[],"model":"opus","fastMode":true}"#).unwrap();
        assert_eq!(old.hidden, super::default_hidden());
        assert_eq!(old.hidden, ["knobs", "composerPick", "hint", "devLog", "devStatus"].map(String::from).to_vec());
        assert_eq!(old.model.as_deref(), Some("opus"));
        assert_eq!(Persisted::default().hidden, super::default_hidden());
        let shown: Persisted = serde_json::from_str(r#"{"sites":[],"hidden":[]}"#).unwrap();
        assert!(shown.hidden.is_empty());
        let mut p = old.clone();
        p.hidden = vec!["knobs".into(), "devLog".into()];
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains(r#""hidden":["knobs","devLog"]"#), "{s}");
        let back: Persisted = serde_json::from_str(&s).unwrap();
        assert_eq!(back.hidden, p.hidden);
        assert!(back.fast_mode);
    }

    /// A state file from before the updater loads with the daily check on: it is a fresh install's default,
    /// and `#[serde(default)]` must not turn the missing bool into `false`. Switching it off survives a round trip.
    #[test]
    fn updates_default_on_and_round_trip() {
        let old: Persisted = serde_json::from_str(r#"{"sites":[],"model":"opus"}"#).unwrap();
        assert!(old.updates_enabled);
        assert_eq!(old.update_checked_at, 0);
        assert_eq!(old.update_skipped, None);
        let mut p = old.clone();
        p.updates_enabled = false;
        p.update_checked_at = 1_700_000_000_000;
        p.update_skipped = Some("0.2.0".into());
        let back: Persisted = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert!(!back.updates_enabled);
        assert_eq!(back.update_checked_at, 1_700_000_000_000);
        assert_eq!(back.update_skipped.as_deref(), Some("0.2.0"));
    }

    /// A site saved before favourites loads unstarred with `last_opened` 0; a starred one survives the round trip.
    #[test]
    fn site_favorite_defaults_and_round_trips() {
        let old: Persisted = serde_json::from_str(r#"{"sites":[{"id":"a","path":"/tmp/a","name":"A"}]}"#).unwrap();
        assert!(!old.sites[0].favorite);
        assert_eq!(old.sites[0].last_opened, 0);
        let mut p = old.clone();
        p.sites[0].favorite = true;
        p.sites[0].last_opened = 1_700_000_000_000;
        let back: Persisted = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert!(back.sites[0].favorite);
        assert_eq!(back.sites[0].last_opened, 1_700_000_000_000);
    }
}
