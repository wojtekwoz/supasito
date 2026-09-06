//! What this Mac has: Node, a package manager, git, Claude Code and whether it is signed in.
//! The UI shows the result as a checklist with one line per missing tool, so a first-time user
//! reaches a working preview following only the app's own text.

use std::{path::PathBuf, time::Duration};

use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub ok: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub ok: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// From `claude auth status`; None when the CLI is too old to answer.
    pub logged_in: Option<bool>,
    pub auth_method: Option<String>,
    /// The user's own defaults from `~/.claude/settings.json`, so Open can say what "your default" is.
    pub defaults: Option<ClaudeDefaults>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDefaults {
    /// `model` (e.g. `claude-fable-5-1[1m]`); None when the CLI's own default applies.
    pub model: Option<String>,
    /// `effortLevel` (low, medium, high, xhigh, max).
    pub effort: Option<String>,
}

/// `model` and `effortLevel` from a Claude Code settings.json (user scope; project settings can still override).
pub fn parse_user_settings(text: &str) -> ClaudeDefaults {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return ClaudeDefaults::default() };
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
    ClaudeDefaults { model: s("model"), effort: s("effortLevel") }
}

fn user_defaults() -> Option<ClaudeDefaults> {
    let text = std::fs::read_to_string(dirs::home_dir()?.join(".claude").join("settings.json")).ok()?;
    Some(parse_user_settings(&text))
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackageManager {
    pub name: String,
    pub path: String,
    pub version: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Toolchain {
    pub claude: ClaudeStatus,
    pub node: Tool,
    pub git: Tool,
    /// The one "New site" will use: pnpm when present, else npm (which ships with Node).
    pub package_manager: Option<PackageManager>,
}

/// First executable named `bin` on `path_env` (a colon-separated PATH).
pub fn which(bin: &str, path_env: &str) -> Option<PathBuf> {
    path_env.split(':').filter(|d| !d.is_empty()).map(|d| std::path::Path::new(d).join(bin)).find(|p| p.is_file())
}

/// Run `exe args…` and return trimmed stdout, or None on failure or after `secs` seconds.
async fn run(exe: &str, args: &[&str], path_env: &str, secs: u64) -> Option<String> {
    let out = tokio::time::timeout(
        Duration::from_secs(secs),
        Command::new(exe).args(args).env("PATH", path_env).env_remove("CLAUDECODE").output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn node(path_env: &str) -> Tool {
    let Some(p) = which("node", path_env) else { return Tool::default() };
    let path = p.to_string_lossy().to_string();
    let version = run(&path, &["--version"], path_env, 8).await.map(|v| v.trim_start_matches('v').to_string());
    Tool { ok: true, path: Some(path), version }
}

/// macOS ships `/usr/bin/git` as a stub that opens the "install command line tools" dialog when
/// run, so ask `xcode-select` first instead of triggering that dialog from a background check.
async fn git(path_env: &str) -> Tool {
    let Some(p) = which("git", path_env) else { return Tool::default() };
    let path = p.to_string_lossy().to_string();
    if cfg!(target_os = "macos") && path == "/usr/bin/git" && run("/usr/bin/xcode-select", &["-p"], path_env, 8).await.is_none() {
        return Tool { ok: false, path: Some(path), version: None };
    }
    let version = run(&path, &["--version"], path_env, 8).await.map(|v| git_version(&v));
    Tool { ok: true, path: Some(path), version }
}

/// "git version 2.50.1 (Apple Git-155)" → "2.50.1"
fn git_version(out: &str) -> String {
    out.split_whitespace().nth(2).unwrap_or(out.trim()).to_string()
}

async fn package_manager(path_env: &str) -> Option<PackageManager> {
    for name in ["pnpm", "npm"] {
        if let Some(p) = which(name, path_env) {
            let path = p.to_string_lossy().to_string();
            let version = run(&path, &["--version"], path_env, 8).await;
            return Some(PackageManager { name: name.into(), path, version });
        }
    }
    None
}

/// Parse the JSON `claude auth status` prints (`{"loggedIn": true, "authMethod": "claude.ai", …}`).
/// Exit code is 1 when signed out, so the caller must not treat that as a failure.
pub fn parse_auth_status(text: &str) -> (Option<bool>, Option<String>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return (None, None) };
    (v.get("loggedIn").and_then(|b| b.as_bool()), v.get("authMethod").and_then(|s| s.as_str()).map(|s| s.to_string()))
}

async fn claude(configured: Option<&str>, path_env: &str) -> ClaudeStatus {
    let Some(path) = crate::agent::claude::locate(configured, path_env).await else { return ClaudeStatus::default() };
    let version = crate::agent::claude::version(&path, path_env).await;
    let auth = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new(&path).args(["auth", "status"]).env("PATH", path_env).env_remove("CLAUDECODE").output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
    .unwrap_or_default();
    let (logged_in, auth_method) = parse_auth_status(&auth);
    ClaudeStatus { ok: true, path: Some(path), version, logged_in, auth_method, defaults: user_defaults() }
}

pub async fn check(configured_claude: Option<&str>, path_env: &str) -> Toolchain {
    let (claude, node, git, package_manager) = tokio::join!(claude(configured_claude, path_env), node(path_env), git(path_env), package_manager(path_env));
    Toolchain { claude, node, git, package_manager }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_walks_the_path_in_order() {
        assert_eq!(which("sh", "/nonexistent:/bin:/usr/bin"), Some(PathBuf::from("/bin/sh")));
        assert_eq!(which("definitely-not-a-binary", "/bin:/usr/bin"), None);
    }

    #[test]
    fn git_version_ignores_apples_suffix() {
        assert_eq!(git_version("git version 2.50.1 (Apple Git-155)"), "2.50.1");
        assert_eq!(git_version("git version 2.51.0"), "2.51.0");
    }

    #[test]
    fn auth_status_json_is_read_even_when_signed_out() {
        assert_eq!(parse_auth_status(r#"{"loggedIn": false, "authMethod": "none"}"#), (Some(false), Some("none".into())));
        assert_eq!(parse_auth_status(r#"{"loggedIn": true, "authMethod": "claude.ai", "email": "x"}"#), (Some(true), Some("claude.ai".into())));
        assert_eq!(parse_auth_status("error: unknown command 'auth'"), (None, None));
    }

    #[test]
    fn user_settings_give_model_and_effort() {
        assert_eq!(parse_user_settings(r#"{"model":"claude-fable-5-1[1m]","effortLevel":"high","theme":"dark"}"#), ClaudeDefaults { model: Some("claude-fable-5-1[1m]".into()), effort: Some("high".into()) });
        assert_eq!(parse_user_settings(r#"{"permissions":{}}"#), ClaudeDefaults::default());
        assert_eq!(parse_user_settings("not json"), ClaudeDefaults::default());
    }

    #[tokio::test]
    async fn checks_this_machine() {
        let env = crate::state::login_shell_path();
        let t = check(None, &env).await;
        // The dev machine has all of these; the assertions document the shape more than the machine.
        assert!(t.node.ok && t.node.version.as_deref().map(|v| v.chars().next().unwrap().is_ascii_digit()).unwrap_or(false), "{:?}", t.node);
        assert!(t.git.ok && t.git.version.is_some(), "{:?}", t.git);
        assert!(t.package_manager.is_some(), "{:?}", t.package_manager);
    }
}
