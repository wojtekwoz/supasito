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
    /// Dev command. May contain `{port}`; otherwise Supasito appends a port flag it infers.
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
    /// Starred in the rail. The user's preference, so it lives in the app state, not in `supasito.json`.
    pub favorite: bool,
    /// When the site was last selected (ms since the epoch); 0 for sites from before this field, which then keep
    /// their list order.
    pub last_opened: u64,
}

impl Default for Site {
    fn default() -> Self {
        Self { id: String::new(), path: String::new(), name: String::new(), dev: None, publish: None, preview: None, last_session_id: None, last_port: None, package_manager: None, framework: None, is_git: false, needs_install: false, favorite: false, last_opened: 0 }
    }
}

#[derive(Deserialize, Default)]
struct SiteJson {
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
        let site_json: SiteJson = std::fs::read_to_string(config_file(root))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if let Some(n) = site_json.name.clone() { self.name = n; }

        let pkg: Value = std::fs::read_to_string(root.join("package.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        let dev_script = pkg.pointer("/scripts/dev").and_then(|v| v.as_str()).map(|s| s.to_string());
        // Plain key lookup, not `pointer()`: a JSON Pointer splits on `/`, so scoped names like `@sveltejs/kit` would never match.
        let deps = |name: &str| ["dependencies", "devDependencies"].iter().any(|k| pkg.get(k).and_then(|d| d.get(name)).is_some());

        let git_top = git_toplevel(root);
        self.package_manager = Some(package_manager(root, git_top.as_deref()).to_string());
        self.framework = if deps("astro") { Some("astro".into()) } else if deps("next") { Some("next".into()) } else if deps("@sveltejs/kit") { Some("sveltekit".into()) } else if deps("nuxt") { Some("nuxt".into()) } else if deps("vite") { Some("vite".into()) } else { None };

        self.dev = site_json.dev.or_else(|| {
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
        self.publish = site_json.publish.or_else(|| match host {
            Some("vercel") => Some("vercel deploy --prod --yes".into()),
            Some("cloudflare") => Some("wrangler deploy".into()),
            Some("netlify") => Some("netlify deploy --prod".into()),
            _ => None,
        });
        self.preview = site_json.preview.or_else(|| match host {
            Some("vercel") => Some("vercel deploy --yes".into()),
            Some("cloudflare") => Some("wrangler versions upload".into()),
            Some("netlify") => Some("netlify deploy".into()),
            _ => None,
        });
        self.is_git = git_top.is_some();
        Ok(())
    }
}

/// The nearest ancestor of `root` (itself included) that holds a `.git`: the repository the site
/// belongs to. A site may be one folder of a larger repository (a workspace package).
pub fn git_toplevel(root: &Path) -> Option<PathBuf> {
    root.ancestors().find(|d| d.join(".git").exists()).map(Path::to_path_buf)
}

/// The package manager the nearest lockfile names, walking up from `root` but not above the
/// repository (`top`) — a workspace keeps one lockfile at its root — or the filesystem root
/// without git. No lockfile means npm.
fn package_manager(root: &Path, top: Option<&Path>) -> &'static str {
    for dir in root.ancestors() {
        if dir.join("pnpm-lock.yaml").exists() { return "pnpm"; }
        if dir.join("bun.lock").exists() || dir.join("bun.lockb").exists() { return "bun"; }
        if dir.join("yarn.lock").exists() { return "yarn"; }
        if dir.join("package-lock.json").exists() { return "npm"; }
        if top.is_some_and(|t| dir == t) { break; }
    }
    "npm"
}

/// True when `root` is the root of a package-manager workspace (pnpm-workspace.yaml or
/// `workspaces` in package.json) rather than one of its packages.
pub fn is_workspace_root(root: &Path) -> bool {
    if root.join("pnpm-workspace.yaml").exists() { return true; }
    std::fs::read_to_string(root.join("package.json")).ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .is_some_and(|pkg| pkg.get("workspaces").is_some())
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

/// Status of the site folder only (a site may be a subfolder of its repository). `files` are
/// site-relative, as the UI shows them and hands them back to `git_diff` and `git_restore`.
pub fn git_status(path: &str, path_env: &str) -> Result<GitStatus, String> {
    if git_toplevel(Path::new(path)).is_none() {
        return Ok(GitStatus { is_git: false, changed: 0, files: vec![], branch: None, remote: None });
    }
    // porcelain paths are repo-relative; `--show-prefix` is the site's path inside the repo ("apps/web/", or "" at the top)
    let prefix = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "rev-parse", "--show-prefix"]).output().ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    // `-z`: NUL-separated and never quoted (plain porcelain quotes paths with spaces, which diff and undo then cannot find)
    let out = std::process::Command::new("git").env("PATH", path_env).args(["-C", path, "status", "--porcelain", "-z", "--", "."]).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let site_relative = |p: &str| p.strip_prefix(prefix.as_str()).unwrap_or(p).to_string();
    let mut files: Vec<String> = Vec::new();
    let mut fields = text.split('\0');
    while let Some(entry) = fields.next() {
        if entry.len() <= 3 { continue; } // `XY ` + path; the trailing NUL leaves an empty field
        let (xy, p) = entry.split_at(3);
        // a rename or copy is `XY new\0old\0`: keep the new path only — it is the file in the working tree, the one diff and undo can act on
        if xy[..2].contains(['R', 'C']) { fields.next(); }
        files.push(site_relative(p));
    }
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

/// Stage everything under the site folder (what the pending count showed) and commit. Returns the new status.
pub fn git_commit(path: &str, message: &str, path_env: &str) -> Result<GitStatus, String> {
    let msg = message.trim();
    if msg.is_empty() { return Err("Give the commit a message.".into()); }
    let run = |args: &[&str]| -> Result<std::process::Output, String> {
        std::process::Command::new("git").env("PATH", path_env).args(["-C", path]).args(args).output().map_err(|e| e.to_string())
    };
    let add = run(&["add", "-A", "--", "."])?;
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

/// The per-site config file: `supasito.json`, or `open.json` from before the app was renamed
/// (2026-09-06) while only that one exists.
pub fn config_file(root: &Path) -> PathBuf {
    let new = root.join("supasito.json");
    let old = root.join("open.json");
    if !new.exists() && old.exists() { old } else { new }
}

/// Set one key in the site's `supasito.json`, creating the file if needed. An empty value removes the
/// key. A site still on `open.json` is moved to the new name first.
pub fn write_site_json(path: &str, key: &str, value: &str) -> Result<(), String> {
    let dir = Path::new(path);
    let file = dir.join("supasito.json");
    let legacy = dir.join("open.json");
    if !file.exists() && legacy.exists() { std::fs::rename(&legacy, &file).map_err(|e| e.to_string())?; }
    let mut root: Value = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}));
    if !root.is_object() { root = json!({}); }
    let obj = root.as_object_mut().unwrap();
    if value.trim().is_empty() { obj.remove(key); } else { obj.insert(key.to_string(), Value::String(value.trim().to_string())); }
    std::fs::write(&file, serde_json::to_string_pretty(&root).unwrap()).map_err(|e| e.to_string())
}

const NO_NODE: &str = "Node.js isn't installed, so packages can't be installed. Get it from https://nodejs.org (npm comes with it), then try again.";

/// The package manager to install with: pnpm when present, else npm (which ships with Node).
fn pick_package_manager(path_env: &str) -> Result<(&'static str, PathBuf), String> {
    for name in ["pnpm", "npm"] {
        if let Some(p) = crate::toolchain::which(name, path_env) { return Ok((name, p)); }
    }
    Err(NO_NODE.into())
}

/// The starter's permission rules and CLAUDE.md are written for pnpm; translate them when a site
/// is created with npm so Claude's type-checks are still pre-approved there.
pub fn npm_rule(rule: &str) -> String {
    if let Some(rest) = rule.strip_prefix("Bash(pnpm exec ") { return format!("Bash(npx {rest}"); }
    if let Some(rest) = rule.strip_prefix("Bash(pnpm ") { return format!("Bash(npm run {rest}"); }
    rule.to_string()
}

/// The starter ships with a placeholder name in `site.ts`; the pages, the social card,
/// robots.txt and sitemap.xml all read it from there, so this is what makes a new site
/// carry its own name everywhere instead of saying "New site".
pub fn personalise_site_ts(src: &str, name: &str) -> String {
    let literal = serde_json::to_string(name.trim()).unwrap_or_else(|_| "\"New site\"".into());
    src.replace("name: \"New site\",", &format!("name: {literal},"))
}

fn rewrite_for_npm(dest: &Path) {
    let settings = dest.join(".claude/settings.json");
    if let Some(mut v) = std::fs::read_to_string(&settings).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
        for key in ["allow", "deny", "ask"] {
            if let Some(list) = v.pointer_mut(&format!("/permissions/{key}")).and_then(|l| l.as_array_mut()) {
                for r in list.iter_mut() { if let Some(t) = r.as_str() { *r = Value::String(npm_rule(t)); } }
            }
        }
        let _ = std::fs::write(&settings, serde_json::to_string_pretty(&v).unwrap_or_default());
    }
    let rules = dest.join("CLAUDE.md");
    if let Ok(text) = std::fs::read_to_string(&rules) {
        let _ = std::fs::write(&rules, text.replace("`pnpm typecheck`", "`npm run typecheck`"));
    }
    // npm cannot read pnpm's lockfile: leaving it behind would pin nothing and go stale.
    let _ = std::fs::remove_file(dest.join("pnpm-lock.yaml"));
}

/// Copy the bundled starter into `<parent>/<name>` and install dependencies, reporting each line
/// of the installer's output to `on_log`.
pub async fn create_from_starter(starter: &Path, parent: &str, name: &str, path_env: &str, on_log: impl Fn(String) + Send + Sync) -> Result<Site, String> {
    let slug: String = name.trim().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>().trim_matches('-').to_string();
    if slug.is_empty() { return Err("Give the site a name".into()); }
    let dest = Path::new(parent).join(&slug);
    if dest.exists() { return Err(format!("{} already exists", dest.display())); }
    let (pm, pm_path) = pick_package_manager(path_env)?; // before copying, so a missing Node leaves nothing behind
    copy_dir(starter, &dest).map_err(|e| e.to_string())?;
    // personalise
    let cfg = json!({ "name": name.trim(), "dev": "node_modules/.bin/next dev -p {port}" });
    std::fs::write(dest.join("supasito.json"), serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    if let Ok(pkg) = std::fs::read_to_string(dest.join("package.json")) {
        std::fs::write(dest.join("package.json"), pkg.replace("\"name\": \"supasito-starter\"", &format!("\"name\": \"{slug}\""))).map_err(|e| e.to_string())?;
    }
    if let Ok(src) = std::fs::read_to_string(dest.join("site.ts")) {
        std::fs::write(dest.join("site.ts"), personalise_site_ts(&src, name)).map_err(|e| e.to_string())?;
    }
    if pm == "npm" { rewrite_for_npm(&dest); }
    let dest_s = dest.to_string_lossy().to_string();
    // 1. dependencies — without them the site cannot run, so a failure removes the folder again
    // The starter commits a pnpm lockfile so every new site starts on the versions we tested.
    // CI=1 would otherwise make pnpm demand a perfectly matching lockfile and fail outright on an
    // older pnpm; --no-frozen-lockfile lets it re-resolve instead of refusing to create the site.
    let install_args: &[&str] = if pm == "pnpm" { &["install", "--no-frozen-lockfile"] } else { &["install", "--no-audit", "--no-fund", "--loglevel=error"] };
    on_log(format!("$ {pm} {}", install_args.join(" ")));
    let mut child = tokio::process::Command::new(&pm_path).args(install_args).env("PATH", path_env).env("CI", "1")
        .current_dir(&dest).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
        .spawn().map_err(|e| { let _ = std::fs::remove_dir_all(&dest); format!("Could not run {pm}: {e}") })?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    pump_lines(child.stdout.take().unwrap(), tx.clone());
    pump_lines(child.stderr.take().unwrap(), tx.clone());
    drop(tx);
    let mut last = String::new();
    while let Some(l) = rx.recv().await {
        if !l.trim().is_empty() { last = l.trim().to_string(); }
        on_log(l);
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(format!("{pm} install failed{}. Check that you're online, then try again.", if last.is_empty() { String::new() } else { format!(": {last}") }));
    }
    // 2. git — best effort; the site is usable without a first commit
    let git = |args: &[&str]| {
        let mut c = tokio::process::Command::new("git");
        c.args(args).env("PATH", path_env).current_dir(&dest).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        c.output()
    };
    let _ = git(&["init", "-q"]).await;
    let _ = git(&["add", "-A"]).await;
    let _ = git(&["commit", "-qm", "New site from Supasito starter"]).await;
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
/// The lockfile says which manager the site uses; if that one isn't installed, npm still works.
pub async fn run_install(app: AppHandle, site: &Site, path_env: &str) -> Result<(), String> {
    let site_id = site.id.clone();
    let detected = site.package_manager.clone().unwrap_or_else(|| "npm".into());
    let pm = if crate::toolchain::which(&detected, path_env).is_some() { detected }
        else if crate::toolchain::which("npm", path_env).is_some() {
            let _ = app.emit("install://log", json!({ "siteId": site_id, "line": format!("{detected} isn't installed on this Mac; using npm instead (its lockfile will be ignored).") }));
            "npm".to_string()
        } else { return Err(NO_NODE.into()) };
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

/// Opening a folder in Supasito is the user's trust decision, so mirror it into Claude Code's own
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
        // write-then-rename so a crash or a concurrent claude write cannot leave a torn file
        let tmp = home.join(format!(".claude.json.open-{}", std::process::id()));
        if std::fs::write(&tmp, out).is_ok() && std::fs::rename(&tmp, &file).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

/// Resolve a file path (absolute or site-relative) to a path inside the site, or None.
fn inside_site(root: &Path, f: &str) -> Option<PathBuf> {
    let candidate = if Path::new(f).is_absolute() { PathBuf::from(f) } else { root.join(f) };
    let root_c = root.canonicalize().ok()?;
    // canonicalise the deepest existing ancestor so symlinks and `..` cannot escape
    let mut probe = candidate.clone();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !probe.exists() {
        tail.push(probe.file_name()?.to_os_string());
        probe = probe.parent()?.to_path_buf();
    }
    let mut resolved = probe.canonicalize().ok()?;
    for seg in tail.iter().rev() { resolved.push(seg); }
    if resolved.starts_with(&root_c) { Some(resolved) } else { None }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: Vec<String>,
    pub deleted: Vec<String>,
    pub skipped: Vec<String>,
}

/// Undo a turn. Tracked files go back to HEAD; files in `created` (which did not exist before
/// the turn) are deleted; anything else is left alone and reported. Requires a git repo.
pub fn git_restore(path: &str, files: &[String], created: &[String], path_env: &str) -> Result<RestoreReport, String> {
    let root = Path::new(path);
    if git_toplevel(root).is_none() { return Err("This folder is not a git repository, so there is nothing to restore from.".into()); }
    let root_c = root.canonicalize().map_err(|e| e.to_string())?;
    let mut report = RestoreReport::default();
    let created_set: std::collections::HashSet<PathBuf> = created.iter().filter_map(|f| inside_site(root, f)).collect();
    for f in files {
        let Some(full) = inside_site(root, f) else { report.skipped.push(f.clone()); continue };
        let rel = full.strip_prefix(&root_c).map(|r| r.to_string_lossy().to_string()).unwrap_or_else(|_| f.clone());
        let tracked = std::process::Command::new("git").env("PATH", path_env)
            .args(["-C", path, "ls-files", "--error-unmatch", "--", &rel]).output()
            .map(|o| o.status.success()).unwrap_or(false);
        if tracked {
            let out = std::process::Command::new("git").env("PATH", path_env)
                .args(["-C", path, "checkout", "--", &rel]).output().map_err(|e| e.to_string())?;
            if !out.status.success() { return Err(format!("git checkout {rel}: {}", String::from_utf8_lossy(&out.stderr).trim())); }
            report.restored.push(rel);
        } else if created_set.contains(&full) {
            if full.is_file() { std::fs::remove_file(&full).map_err(|e| format!("remove {rel}: {e}"))?; }
            report.deleted.push(rel);
        } else {
            report.skipped.push(rel);
        }
    }
    Ok(report)
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
        assert_eq!(site.name, "New site"); // from supasito.json
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
    fn detects_scoped_packages_like_sveltekit() {
        let dir = std::env::temp_dir().join(format!("open-detect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("node_modules/.bin")).unwrap();
        std::fs::write(dir.join("node_modules/.bin/vite"), "").unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite dev"},"devDependencies":{"@sveltejs/kit":"^2","vite":"^8"}}"#).unwrap();
        let site = Site::from_path(dir.to_str().unwrap()).unwrap();
        assert_eq!(site.framework.as_deref(), Some("sveltekit"), "scoped name must be found under devDependencies");
        assert_eq!(site.dev.as_deref(), Some("node_modules/.bin/vite dev --port {port}"));
        assert!(!site.needs_install);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_new_sites_name_reaches_site_ts() {
        let src = std::fs::read_to_string(starter().join("site.ts")).unwrap();
        assert!(src.contains("name: \"New site\","), "the starter must keep the placeholder this rewrites");

        let out = personalise_site_ts(&src, "  Acme Coffee  ");
        assert!(out.contains("name: \"Acme Coffee\","), "the trimmed name replaces the placeholder");
        assert!(!out.contains("New site"), "no placeholder may survive anywhere in the file");

        // A name with a quote or a backslash must not break the module.
        let odd = personalise_site_ts(&src, "Bob\"s \\ Bar");
        assert!(odd.contains(r#"name: "Bob\"s \\ Bar","#), "quotes and backslashes are escaped: {odd}");
    }

    #[test]
    fn starter_rules_translate_to_npm() {
        assert_eq!(npm_rule("Bash(pnpm typecheck)"), "Bash(npm run typecheck)");
        assert_eq!(npm_rule("Bash(pnpm exec tsc *)"), "Bash(npx tsc *)");
        assert_eq!(npm_rule("Bash(pnpm dev*)"), "Bash(npm run dev*)");
        assert_eq!(npm_rule("Bash(git status*)"), "Bash(git status*)");
        let dir = std::env::temp_dir().join(format!("open-npm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        std::fs::write(dir.join(".claude/settings.json"), r#"{"permissions":{"allow":["Bash(pnpm typecheck)","Bash(git diff*)"],"deny":["Bash(pnpm dev*)"]}}"#).unwrap();
        std::fs::write(dir.join("CLAUDE.md"), "run `pnpm typecheck` after edits").unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();
        rewrite_for_npm(&dir);
        assert!(!dir.join("pnpm-lock.yaml").exists(), "npm cannot read pnpm's lockfile, so it must not be left behind");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(".claude/settings.json")).unwrap()).unwrap();
        assert_eq!(v["permissions"]["allow"][0], "Bash(npm run typecheck)");
        assert_eq!(v["permissions"]["allow"][1], "Bash(git diff*)");
        assert_eq!(v["permissions"]["deny"][0], "Bash(npm run dev*)");
        assert!(std::fs::read_to_string(dir.join("CLAUDE.md")).unwrap().contains("`npm run typecheck`"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn site_json_falls_back_to_open_json_and_moves_it_on_write() {
        let dir = std::env::temp_dir().join(format!("supasito-cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(config_file(&dir).ends_with("supasito.json"), "no file yet: the new name");
        std::fs::write(dir.join("open.json"), r#"{ "name": "Old", "dev": "x" }"#).unwrap();
        assert!(config_file(&dir).ends_with("open.json"), "a site from before the rename is read as is");
        write_site_json(dir.to_str().unwrap(), "publish", "vercel deploy --prod").unwrap();
        assert!(!dir.join("open.json").exists() && dir.join("supasito.json").exists(), "the first write renames it");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("supasito.json")).unwrap()).unwrap();
        assert_eq!(v["name"], "Old");
        assert_eq!(v["publish"], "vercel deploy --prod");
        write_site_json(dir.to_str().unwrap(), "publish", "").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("supasito.json")).unwrap()).unwrap();
        assert!(v.get("publish").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_reverts_tracked_and_deletes_only_created() {
        let dir = std::env::temp_dir().join(format!("supasito-restore-{}", uuid::Uuid::new_v4()));
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
        std::fs::write(dir.join("keep.txt"), "pre-existing untracked").unwrap();
        let r = git_restore(path, &[format!("{path}/a.txt"), "new.txt".into(), "keep.txt".into(), "../outside.txt".into()], &["new.txt".into()], &env).unwrap();
        assert_eq!(r.restored, vec!["a.txt"]);
        assert_eq!(r.deleted, vec!["new.txt"]);
        assert_eq!(r.skipped, vec!["keep.txt", "../outside.txt"]);
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one");
        assert!(!dir.join("new.txt").exists());
        assert!(dir.join("keep.txt").exists(), "untracked files that existed before the turn are left alone");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A site that is one package of a larger repository: status, commit and undo are scoped to
    /// its folder, and the package manager comes from the workspace's lockfile.
    #[test]
    fn workspace_package_is_scoped_to_its_folder() {
        if std::process::Command::new("git").arg("--version").output().map(|o| !o.status.success()).unwrap_or(true) {
            eprintln!("git not on PATH; skipping"); return;
        }
        let outer = std::env::temp_dir().join(format!("supasito-mono-{}", uuid::Uuid::new_v4()));
        let dir = outer.join("mono");
        let web = dir.join("apps/web");
        std::fs::create_dir_all(&web).unwrap();
        let path = dir.to_str().unwrap();
        let site = web.to_str().unwrap();
        let env = std::env::var("PATH").unwrap_or_default();
        let git = |args: &[&str]| -> String {
            let o = std::process::Command::new("git").args(["-C", path, "-c", "user.name=t", "-c", "user.email=t@t"]).args(args).output().unwrap();
            assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).to_string()
        };
        git(&["init", "-q"]);
        std::fs::write(outer.join("pnpm-lock.yaml"), "").unwrap(); // above the repo: must not count
        std::fs::write(dir.join("pnpm-workspace.yaml"), "packages:\n  - apps/*\n").unwrap();
        std::fs::write(dir.join("package-lock.json"), "").unwrap();
        std::fs::write(web.join("package.json"), r#"{"name":"web","scripts":{"dev":"next dev"},"dependencies":{"next":"16"}}"#).unwrap();
        std::fs::write(web.join("a.txt"), "one").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);

        let s = Site::from_path(site).unwrap();
        assert!(s.is_git, "the nearest .git ancestor counts");
        assert_eq!(s.package_manager.as_deref(), Some("npm"), "nearest lockfile up to the git top; the one above the repo is ignored");
        assert!(is_workspace_root(&dir) && !is_workspace_root(&web));
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(Site::from_path(site).unwrap().package_manager.as_deref(), Some("pnpm"), "pnpm-lock.yaml at the workspace root wins");

        std::fs::write(web.join("a.txt"), "two").unwrap();
        std::fs::write(dir.join("outside.txt"), "not the site").unwrap();
        let g = git_status(site, &env).unwrap();
        assert!(g.is_git);
        assert_eq!((g.changed, g.files.clone()), (1, vec!["a.txt".to_string()]), "site-relative, and the change outside apps/web is not counted");

        let r = git_restore(site, &["a.txt".into()], &[], &env).unwrap();
        assert_eq!(r.restored, vec!["a.txt"]);
        assert_eq!(std::fs::read_to_string(web.join("a.txt")).unwrap(), "one");
        assert_eq!(git_status(site, &env).unwrap().changed, 0);

        std::fs::write(web.join("a.txt"), "three").unwrap();
        assert_eq!(git_commit(site, "scoped", &env).unwrap().changed, 0);
        assert_eq!(git(&["status", "--porcelain"]).trim(), "?? outside.txt\n?? pnpm-lock.yaml", "commit staged only the site folder");
        std::fs::remove_file(dir.join("outside.txt")).unwrap();
        std::fs::remove_file(dir.join("pnpm-lock.yaml")).unwrap();
        assert_eq!(git(&["status", "--porcelain"]).trim(), "", "repo clean");
        let _ = std::fs::remove_dir_all(&outer);
    }

    /// Paths with spaces and renames come back plain (no porcelain quoting, no `old -> new`), so
    /// diff and undo find the files; also covers the prefix strip for a workspace package.
    #[test]
    fn status_paths_with_spaces_and_renames() {
        if std::process::Command::new("git").arg("--version").output().map(|o| !o.status.success()).unwrap_or(true) {
            eprintln!("git not on PATH; skipping"); return;
        }
        let dir = std::env::temp_dir().join(format!("supasito-quoted-{}", uuid::Uuid::new_v4()));
        let web = dir.join("apps/web");
        std::fs::create_dir_all(web.join("sub dir")).unwrap();
        let path = dir.to_str().unwrap();
        let site = web.to_str().unwrap();
        let env = std::env::var("PATH").unwrap_or_default();
        let git = |args: &[&str]| {
            let o = std::process::Command::new("git").args(["-C", path, "-c", "user.name=t", "-c", "user.email=t@t"]).args(args).output().unwrap();
            assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        };
        git(&["init", "-q"]);
        std::fs::write(web.join("sub dir/my file.txt"), "one").unwrap();
        std::fs::write(web.join("a.txt"), "a").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);

        std::fs::write(web.join("sub dir/my file.txt"), "two").unwrap();
        std::fs::write(web.join("new file.txt"), "created").unwrap();
        git(&["mv", "apps/web/a.txt", "apps/web/b.txt"]);
        let g = git_status(site, &env).unwrap();
        let mut files = g.files.clone();
        files.sort();
        assert_eq!(g.changed, 3);
        assert_eq!(files, vec!["b.txt", "new file.txt", "sub dir/my file.txt"], "site-relative, unquoted, the new name of a rename");

        let diff = git_diff(site, &["sub dir/my file.txt".into()], &env).unwrap();
        assert!(diff.contains("-one") && diff.contains("+two"), "diff finds the file: {diff}");
        let r = git_restore(site, &["sub dir/my file.txt".into()], &[], &env).unwrap();
        assert_eq!(r.restored, vec!["sub dir/my file.txt"]);
        assert!(r.skipped.is_empty());
        assert_eq!(std::fs::read_to_string(web.join("sub dir/my file.txt")).unwrap(), "one");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Slow (runs pnpm install); run with `cargo test -- --ignored create_site`.
    #[tokio::test]
    #[ignore]
    async fn create_site_from_starter() {
        let parent = std::env::temp_dir().join(format!("supasito-new-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&parent).unwrap();
        let env = crate::state::login_shell_path();
        let site = create_from_starter(&starter(), parent.to_str().unwrap(), "My Test Site", &env, |l| eprintln!("{l}")).await.unwrap();
        assert_eq!(site.name, "My Test Site");
        assert!(site.path.ends_with("my-test-site"));
        assert!(site.is_git && !site.needs_install);
        assert_eq!(site.dev.as_deref(), Some("node_modules/.bin/next dev -p {port}"));
        assert!(Path::new(&site.path).join("node_modules/.bin/next").exists());
        assert!(Path::new(&site.path).join(".claude/settings.json").exists());
        // The name has to reach the page, not just the app's own config: site.ts is what the
        // title, the header, the footer, the social card and the sitemap all read.
        let site_ts = std::fs::read_to_string(Path::new(&site.path).join("site.ts")).unwrap();
        assert!(site_ts.contains(r#"name: "My Test Site","#), "site.ts still says: {site_ts}");
        assert!(!site_ts.contains("New site"), "no placeholder name may survive");
        let _ = std::fs::remove_dir_all(&parent);
    }
}
