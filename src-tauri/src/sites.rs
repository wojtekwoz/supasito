use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Site {
    pub id: String,
    pub path: String,
    pub name: String,
    /// Dev command. May contain `{port}`; otherwise Open appends a port flag it infers.
    pub dev: Option<String>,
    /// Production publish command.
    pub publish: Option<String>,
    /// Preview (staging) publish command: a shareable deployment that is not the live site.
    pub preview: Option<String>,
    pub last_session_id: Option<String>,
    pub last_port: Option<u16>,
    pub package_manager: Option<String>,
    pub framework: Option<String>,
    pub is_git: bool,
    pub needs_install: bool,
}

impl Default for Site {
    fn default() -> Self {
        Self { id: String::new(), path: String::new(), name: String::new(), dev: None, publish: None, preview: None, last_session_id: None, last_port: None, package_manager: None, framework: None, is_git: false, needs_install: false }
    }
}

#[derive(Deserialize, Default)]
struct OpenJson {
    dev: Option<String>,
    publish: Option<String>,
    preview: Option<String>,
    name: Option<String>,
}

impl Site {
    pub fn from_path(path: &str) -> Result<Self, String> {
        let p = PathBuf::from(path);
        if !p.is_dir() {
            return Err(format!("{path} is not a folder"));
        }
        let canonical = p.canonicalize().map_err(|e| e.to_string())?;
        let mut site = Site {
            id: uuid::Uuid::new_v4().to_string(),
            path: canonical.to_string_lossy().to_string(),
            name: canonical.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "site".into()),
            ..Default::default()
        };
        site.refresh()?;
        Ok(site)
    }

    /// Re-detect dev/publish commands, package manager, framework, git.
    pub fn refresh(&mut self) -> Result<(), String> {
        let root = Path::new(&self.path);
        let open_json: OpenJson = std::fs::read_to_string(root.join("open.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if let Some(n) = open_json.name.clone() { self.name = n; }

        let pkg: Value = std::fs::read_to_string(root.join("package.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        let dev_script = pkg.pointer("/scripts/dev").and_then(|v| v.as_str()).map(|s| s.to_string());
        let deps = |name: &str| pkg.pointer(&format!("/dependencies/{name}")).is_some() || pkg.pointer(&format!("/devDependencies/{name}")).is_some();

        self.package_manager = Some(if root.join("pnpm-lock.yaml").exists() { "pnpm" } else if root.join("bun.lock").exists() || root.join("bun.lockb").exists() { "bun" } else if root.join("yarn.lock").exists() { "yarn" } else { "npm" }.to_string());
        self.framework = if deps("astro") { Some("astro".into()) } else if deps("next") { Some("next".into()) } else if deps("@sveltejs/kit") { Some("sveltekit".into()) } else if deps("nuxt") { Some("nuxt".into()) } else if deps("vite") { Some("vite".into()) } else { None };

        self.dev = open_json.dev.or_else(|| {
            dev_script.as_ref()?;
            let pm = self.package_manager.clone().unwrap_or_else(|| "npm".into());
            let (bin, flag) = match self.framework.as_deref() {
                Some("next") => (Some("next dev"), "-p"),
                Some("astro") => (Some("astro dev"), "--port"),
                Some("sveltekit") => (Some("vite dev"), "--port"),
                Some("nuxt") => (Some("nuxt dev"), "--port"),
                Some("vite") => (Some("vite"), "--port"),
                _ => (None, "--port"),
            };
            // Prefer the framework binary directly: package managers differ in how they forward args.
            if let Some(bin) = bin {
                let exe = bin.split_whitespace().next().unwrap_or(bin);
                if root.join("node_modules/.bin").join(exe).exists() {
                    return Some(format!("node_modules/.bin/{bin} {flag} {{port}}"));
                }
            }
            Some(match pm.as_str() {
                "npm" => format!("npm run dev -- {flag} {{port}}"),
                "yarn" => format!("yarn run dev {flag} {{port}}"),
                "bun" => format!("bun run dev {flag} {{port}}"),
                _ => format!("pnpm run dev {flag} {{port}}"),
            })
        });

        self.needs_install = root.join("package.json").exists() && !root.join("node_modules").exists();

        let host = if root.join("vercel.json").exists() || root.join(".vercel").exists() { Some("vercel") }
            else if root.join("wrangler.toml").exists() || root.join("wrangler.jsonc").exists() || root.join("wrangler.json").exists() { Some("cloudflare") }
            else if root.join("netlify.toml").exists() { Some("netlify") }
            else { None };
        self.publish = open_json.publish.or_else(|| match host {
            Some("vercel") => Some("vercel deploy --prod --yes".into()),
            Some("cloudflare") => Some("wrangler deploy".into()),
            Some("netlify") => Some("netlify deploy --prod".into()),
            _ => None,
        });
        self.preview = open_json.preview.or_else(|| match host {
            Some("vercel") => Some("vercel deploy --yes".into()),
            Some("cloudflare") => Some("wrangler versions upload".into()),
            Some("netlify") => Some("netlify deploy".into()),
            _ => None,
        });
        self.is_git = root.join(".git").exists();
        Ok(())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_git: bool,
    pub changed: usize,
    pub files: Vec<String>,
    pub branch: Option<String>,
    /// URL of the `origin` remote, when one is configured.
    pub remote: Option<String>,
}

pub fn git_status(path: &str, path_env: &str) -> Result<GitStatus, String> {
    if !Path::new(path).join(".git").exists() {
        return Ok(GitStatus { is_git: false, changed: 0, files: vec![], branch: None, remote: None });
    }
    let out = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "status", "--porcelain"]).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let files: Vec<String> = text.lines().filter(|l| l.len() > 3).map(|l| l[3..].trim().to_string()).collect();
    let branch = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "rev-parse", "--abbrev-ref", "HEAD"]).output().ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let remote = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "remote", "get-url", "origin"]).output().ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(GitStatus { is_git: true, changed: files.len(), files, branch, remote })
}

/// Push the current branch to origin, setting upstream if needed.
pub fn git_push(path: &str, path_env: &str) -> Result<String, String> {
    let out = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "push", "-u", "origin", "HEAD"]).output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if !out.status.success() { return Err(text.trim().lines().last().unwrap_or("git push failed").to_string()); }
    Ok(text.trim().to_string())
}

/// Stage everything and commit. Returns the new status.
pub fn git_commit(path: &str, message: &str, path_env: &str) -> Result<GitStatus, String> {
    let msg = message.trim();
    if msg.is_empty() { return Err("Give the commit a message.".into()); }
    let run = |args: &[&str]| -> Result<std::process::Output, String> {
        std::process::Command::new("git").env("PATH", path_env).args(["-C", path]).args(args).output().map_err(|e| e.to_string())
    };
    let add = run(&["add", "-A"])?;
    if !add.status.success() { return Err(String::from_utf8_lossy(&add.stderr).trim().to_string()); }
    let commit = run(&["commit", "-q", "-m", msg])?;
    if !commit.status.success() {
        let err = String::from_utf8_lossy(&commit.stderr).trim().to_string();
        if err.contains("Please tell me who you are") || err.contains("user.email") {
            return Err("Git doesn't know who you are yet. In Terminal, run: git config --global user.name \"Your Name\" && git config --global user.email you@example.com".into());
        }
        return Err(if err.is_empty() { "git commit failed".into() } else { err });
    }
    git_status(path, path_env)
}

/// Unified diff of the working tree against HEAD for the given files (untracked files shown as
/// additions). Capped so a huge change cannot flood the UI.
pub fn git_diff(path: &str, files: &[String], path_env: &str) -> Result<String, String> {
    let root = Path::new(path);
    let rel: Vec<String> = files.iter().map(|f| f.strip_prefix(path).map(|r| r.trim_start_matches('/').to_string()).unwrap_or_else(|| f.clone())).filter(|r| !r.is_empty() && !r.starts_with("..")).collect();
    if rel.is_empty() { return Ok(String::new()); }
    let mut out = String::new();
    let tracked: Vec<String> = rel.iter().filter(|r| std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "ls-files", "--error-unmatch", "--", r]).output().map(|o| o.status.success()).unwrap_or(false)).cloned().collect();
    if !tracked.is_empty() {
        let mut cmd = std::process::Command::new("git");
        cmd.env("PATH", path_env).args(["-C", path, "diff", "--no-color", "HEAD", "--"]).args(&tracked);
        let o = cmd.output().map_err(|e| e.to_string())?;
        out.push_str(&String::from_utf8_lossy(&o.stdout));
    }
    for r in rel.iter().filter(|r| !tracked.contains(r)) {
        let full = root.join(r);
        if let Ok(text) = std::fs::read_to_string(&full) {
            out.push_str(&format!("diff --git a/{r} b/{r}\nnew file\n--- /dev/null\n+++ b/{r}\n"));
            for line in text.lines().take(200) { out.push('+'); out.push_str(line); out.push('\n'); }
        }
    }
    let mut lines: Vec<&str> = out.lines().collect();
    if lines.len() > 800 { lines.truncate(800); lines.push("… (diff truncated)"); }
    Ok(lines.join("\n"))
}

pub fn git_init(path: &str, path_env: &str) -> Result<(), String> {
    let out = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "init", "-q"]).output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
    Ok(())
}

/// Set one key in the site's `open.json`, creating the file if needed. An empty value removes the key.
pub fn write_open_json(path: &str, key: &str, value: &str) -> Result<(), String> {
    let file = Path::new(path).join("open.json");
    let mut root: Value = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}));
    if !root.is_object() { root = json!({}); }
    let obj = root.as_object_mut().unwrap();
    if value.trim().is_empty() { obj.remove(key); } else { obj.insert(key.to_string(), Value::String(value.trim().to_string())); }
    std::fs::write(&file, serde_json::to_string_pretty(&root).unwrap()).map_err(|e| e.to_string())
}

/// Copy the bundled starter into `<parent>/<name>` and install dependencies.
pub async fn create_from_starter(starter: &Path, parent: &str, name: &str, path_env: &str) -> Result<Site, String> {
    let slug: String = name.trim().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>().trim_matches('-').to_string();
    if slug.is_empty() { return Err("Give the site a name".into()); }
    let dest = Path::new(parent).join(&slug);
    if dest.exists() { return Err(format!("{} already exists", dest.display())); }
    copy_dir(starter, &dest).map_err(|e| e.to_string())?;
    // personalise
    let cfg = json!({ "name": name.trim(), "dev": "node_modules/.bin/next dev -p {port}" });
    std::fs::write(dest.join("open.json"), serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    if let Ok(pkg) = std::fs::read_to_string(dest.join("package.json")) {
        std::fs::write(dest.join("package.json"), pkg.replace("\"name\": \"open-starter\"", &format!("\"name\": \"{slug}\""))).map_err(|e| e.to_string())?;
    }
    let dest_s = dest.to_string_lossy().to_string();
    // install + git init, through the login shell so pnpm/git resolve
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let status = tokio::process::Command::new(&shell)
        .args(["-lc", "pnpm install --silent && git init -q && git add -A && git commit -qm 'New site from Open starter'"])
        .env("PATH", path_env)
        .current_dir(&dest)
        .status().await.map_err(|e| e.to_string())?;
    if !status.success() { return Err("Dependency install failed. Open the folder in a terminal and run pnpm install.".into()); }
    let mut site = Site::from_path(&dest_s)?;
    site.name = name.trim().to_string();
    Ok(site)
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == "node_modules" || name == ".git" || name == "dist" || name == ".astro" { continue; }
        let target = dst.join(&name);
        if entry.file_type()?.is_dir() { copy_dir(&entry.path(), &target)?; } else { std::fs::copy(entry.path(), target)?; }
    }
    Ok(())
}

pub async fn run_publish(app: AppHandle, site: &Site, cmd: &str, path_env: &str) -> Result<Value, String> {
    use tauri::Manager;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut command = tokio::process::Command::new(&shell);
    command
        .args(["-lc", cmd])
        .env("PATH", path_env)
        .env("CI", "1")
        .current_dir(&site.path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    command.process_group(0);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let site_id = site.id.clone();
    if let Some(pid) = child.id() {
        app.state::<crate::state::AppState>().publishes.lock().await.insert(site_id.clone(), pid);
    }
    let mut lines: Vec<String> = Vec::new();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    pump_lines(stdout, tx.clone());
    pump_lines(stderr, tx.clone());
    drop(tx);
    while let Some(l) = rx.recv().await {
        let _ = app.emit("publish://log", json!({ "siteId": site_id, "line": l }));
        lines.push(l);
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    app.state::<crate::state::AppState>().publishes.lock().await.remove(&site_id);
    let url = lines.iter().rev().find_map(|l| l.split_whitespace().find(|w| w.starts_with("https://")).map(|w| w.trim_end_matches(|c: char| !c.is_ascii_alphanumeric() && c != '/').to_string()));
    Ok(json!({ "ok": status.success(), "code": status.code(), "url": url, "log": lines }))
}

/// Run the package manager's install in the site folder, streaming lines to `install://log`.
pub async fn run_install(app: AppHandle, site: &Site, path_env: &str) -> Result<(), String> {
    let pm = site.package_manager.clone().unwrap_or_else(|| "npm".into());
    let cmd = format!("{pm} install");
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = tokio::process::Command::new(&shell)
        .args(["-lc", &cmd])
        .env("PATH", path_env)
        .env("CI", "1")
        .current_dir(&site.path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn().map_err(|e| e.to_string())?;
    let site_id = site.id.clone();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    pump_lines(stdout, tx.clone());
    pump_lines(stderr, tx.clone());
    drop(tx);
    while let Some(l) = rx.recv().await {
        let _ = app.emit("install://log", json!({ "siteId": site_id, "line": l }));
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() { return Err(format!("{cmd} failed")); }
    Ok(())
}

/// Spawn a task that forwards each line of `reader` into `tx`.
fn pump_lines<R: tokio::io::AsyncRead + Unpin + Send + 'static>(reader: R, tx: tokio::sync::mpsc::Sender<String>) {
    use tokio::io::AsyncBufReadExt;
    let mut lines = tokio::io::BufReader::new(reader).lines();
    tauri::async_runtime::spawn(async move {
        while let Ok(Some(l)) = lines.next_line().await {
            if tx.send(l).await.is_err() { break; }
        }
    });
}

/// Opening a folder in Open is the user's trust decision, so mirror it into Claude Code's own
/// config: otherwise `claude -p` ignores the site's `.claude/settings.json` permission rules.
pub fn mark_trusted(path: &str) {
    let Some(home) = dirs::home_dir() else { return };
    let file = home.join(".claude.json");
    let Ok(text) = std::fs::read_to_string(&file) else { return };
    let Ok(mut root) = serde_json::from_str::<Value>(&text) else { return };
    if !root.is_object() { return; }
    let projects = root.as_object_mut().unwrap().entry("projects").or_insert_with(|| json!({}));
    if !projects.is_object() { return; }
    let entry = projects.as_object_mut().unwrap().entry(path.to_string()).or_insert_with(|| json!({}));
    if !entry.is_object() { return; }
    if entry.get("hasTrustDialogAccepted").and_then(|v| v.as_bool()) == Some(true) { return; }
    entry.as_object_mut().unwrap().insert("hasTrustDialogAccepted".into(), Value::Bool(true));
    if let Ok(out) = serde_json::to_string(&root) {
        let _ = std::fs::write(&file, out);
    }
}

/// Undo a turn: put tracked files back to their committed state and delete files the turn
/// created. Paths may be absolute or relative to the site. Returns the files touched.
pub fn git_restore(path: &str, files: &[String], path_env: &str) -> Result<Vec<String>, String> {
    let root = Path::new(path);
    let mut restored = Vec::new();
    for f in files {
        let rel = f.strip_prefix(path).map(|r| r.trim_start_matches('/').to_string()).unwrap_or_else(|| f.clone());
        if rel.is_empty() || rel.starts_with("..") { continue; }
        let tracked = std::process::Command::new("git").env("PATH", path_env)
            .args(["-C", path, "ls-files", "--error-unmatch", "--", &rel]).output()
            .map(|o| o.status.success()).unwrap_or(false);
        if tracked {
            let out = std::process::Command::new("git").env("PATH", path_env)
                .args(["-C", path, "checkout", "--", &rel]).output().map_err(|e| e.to_string())?;
            if !out.status.success() { return Err(format!("git checkout {rel}: {}", String::from_utf8_lossy(&out.stderr).trim())); }
        } else {
            let full = root.join(&rel);
            if full.is_file() { std::fs::remove_file(&full).map_err(|e| format!("remove {rel}: {e}"))?; }
        }
        restored.push(rel);
    }
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn starter() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../starters/next").canonicalize().unwrap() }

    #[test]
    fn detects_the_bundled_starter() {
        let site = Site::from_path(starter().to_str().unwrap()).unwrap();
        assert_eq!(site.framework.as_deref(), Some("next"));
        assert_eq!(site.dev.as_deref(), Some("node_modules/.bin/next dev -p {port}"));
        assert_eq!(site.name, "New site"); // from open.json
        assert!(site.needs_install || starter().join("node_modules").exists());
    }

    #[test]
    fn infers_dev_command_from_package_json() {
        let dir = std::env::temp_dir().join(format!("open-detect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"astro dev"},"dependencies":{"astro":"^5"}}"#).unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        let site = Site::from_path(dir.to_str().unwrap()).unwrap();
        assert_eq!(site.framework.as_deref(), Some("astro"));
        assert_eq!(site.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(site.dev.as_deref(), Some("pnpm run dev --port {port}"));
        assert!(site.needs_install);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_reverts_tracked_and_deletes_untracked() {
        let dir = std::env::temp_dir().join(format!("open-restore-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_str().unwrap();
        let env = std::env::var("PATH").unwrap_or_default();
        let git = |args: &[&str]| { assert!(std::process::Command::new("git").args(["-C", path]).args(args).output().unwrap().status.success()); };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "one").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);
        std::fs::write(dir.join("a.txt"), "two").unwrap();
        std::fs::write(dir.join("new.txt"), "created").unwrap();
        let restored = git_restore(path, &[format!("{path}/a.txt"), "new.txt".into()], &env).unwrap();
        assert_eq!(restored, vec!["a.txt", "new.txt"]);
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one");
        assert!(!dir.join("new.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Slow (runs pnpm install); run with `cargo test -- --ignored create_site`.
    #[tokio::test]
    #[ignore]
    async fn create_site_from_starter() {
        let parent = std::env::temp_dir().join(format!("open-new-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&parent).unwrap();
        let env = crate::state::login_shell_path();
        let site = create_from_starter(&starter(), parent.to_str().unwrap(), "My Test Site", &env).await.unwrap();
        assert_eq!(site.name, "My Test Site");
        assert!(site.path.ends_with("my-test-site"));
        assert!(site.is_git && !site.needs_install);
        assert_eq!(site.dev.as_deref(), Some("node_modules/.bin/next dev -p {port}"));
        assert!(Path::new(&site.path).join("node_modules/.bin/next").exists());
        assert!(Path::new(&site.path).join(".claude/settings.json").exists());
        let _ = std::fs::remove_dir_all(&parent);
    }
}
