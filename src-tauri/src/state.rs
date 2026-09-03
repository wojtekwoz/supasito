use std::{path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{agent, devserver, sites::Site};

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Persisted {
    pub sites: Vec<Site>,
    pub claude_path: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
}

pub struct AppState {
    pub persisted: Mutex<Persisted>,
    pub file: PathBuf,
    pub agents: agent::claude::Registry,
    pub dev: devserver::Registry,
    /// PATH as seen by the user's login shell, so spawned tools resolve like in a terminal.
    pub path_env: String,
}

impl AppState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        let file = dir.join("state.json");
        let persisted = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<Persisted>(&s).ok())
            .unwrap_or_default();
        Ok(Self {
            persisted: Mutex::new(persisted),
            file,
            agents: agent::claude::Registry::default(),
            dev: devserver::Registry::new(dir.join("dev-pids.json")),
            path_env: login_shell_path(),
        })
    }

    pub fn save(&self) -> Result<(), String> {
        let p = self.persisted.lock().unwrap().clone();
        let s = serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?;
        std::fs::write(&self.file, s).map_err(|e| e.to_string())
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
