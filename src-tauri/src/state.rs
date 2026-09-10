use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{agent, devserver, sites::Site};

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
    /// PATH as seen by the user's login shell, so spawned tools resolve like in a terminal.
    pub path_env: String,
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
            path_env: login_shell_path(),
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
pub fn login_shell_path() -> String {
    // Debug builds can pretend to be a barer Mac: SUPASITO_PATH=/usr/bin:/bin pnpm tauri dev
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("SUPASITO_PATH") { return p; }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = std::process::Command::new(&shell)
        .args(["-lc", "echo -n \"$PATH\""])
        .output();
    let from_shell = out
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    let base = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = Vec::new();
    for p in from_shell.unwrap_or_default().split(':').chain(base.split(':')).chain(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].into_iter(),
    ) {
        if !p.is_empty() && !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    }
    if let Some(home) = dirs::home_dir() {
        for extra in [".local/bin", ".claude/local", ".bun/bin"] {
            let p = home.join(extra).to_string_lossy().to_string();
            if !parts.iter().any(|x| x == &p) {
                parts.push(p);
            }
        }
    }
    parts.join(":")
}

#[cfg(test)]
mod tests {
    use super::Persisted;

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
