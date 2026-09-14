//! Paste a GitHub link, get a site (PLAN §8e): reading the link, asking GitHub about the repository, cloning with
//! progress, naming what went wrong, and GitHub sign-in for private repositories. git always runs with prompts off
//! and `LC_ALL=C`, so a failure is English text we can classify rather than a prompt nobody can see.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::sites::Site;

// ---------- reading a link ----------

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub clone_url: String,
    pub ssh: bool,
    /// Everything after `/tree/` in a GitHub link: a branch (which may contain slashes), then maybe a folder.
    /// Resolved against the remote's branches when cloning (`resolve_tree`).
    pub tree_path: Option<String>,
    /// The link came from a copied `gh repo clone` command.
    pub from_command: bool,
}

impl RepoRef {
    /// "github.com/owner/repo", lowercase: what two addresses of the same repository have in common.
    pub fn key(&self) -> String { format!("{}/{}/{}", self.host, self.owner, self.repo).to_lowercase() }
}

/// First path segments on github.com that are pages, not owners.
const RESERVED: &[&str] = &["about", "apps", "codespaces", "collections", "dashboard", "enterprise", "explore", "features", "issues", "join", "login", "logout", "marketplace", "new", "notifications", "organizations", "orgs", "pricing", "pulls", "search", "settings", "sponsors", "topics", "trending", "users"];

fn valid_name(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn github(owner: &str, repo: &str, tree_path: Option<String>) -> RepoRef {
    RepoRef { host: "github.com".into(), owner: owner.into(), repo: repo.into(), clone_url: format!("https://github.com/{owner}/{repo}.git"), tree_path, ..Default::default() }
}

/// What people actually copy: a GitHub page address (with `.git`, a trailing slash, `?tab=…`, `#readme`, `/tree/…`,
/// `/blob/…`), the same without `https://`, an SSH address, a copied `gh repo clone` command, or any other https
/// address ending in `.git`. None for anything else, which the dialog treats as a site name.
pub fn parse_repo_url(input: &str) -> Option<RepoRef> {
    let t = input.trim().trim_matches(|c| c == '<' || c == '>' || c == '"' || c == '\'');
    if t.is_empty() { return None; }
    if let Some(rest) = t.strip_prefix("gh repo clone ") {
        let target = rest.split_whitespace().next()?;
        let mut r = if target.contains('.') && (target.contains("github.com") || target.starts_with("git@")) {
            parse_repo_url(target)?
        } else {
            let (owner, repo) = target.split_once('/')?;
            let repo = repo.strip_suffix(".git").unwrap_or(repo);
            if !valid_name(owner) || !valid_name(repo) { return None; }
            github(owner, repo, None)
        };
        r.from_command = true;
        return Some(r);
    }
    if t.contains(char::is_whitespace) { return None; }
    if let Some(rest) = t.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        let path = path.trim_end_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        let (owner, repo) = path.rsplit_once('/')?;
        if host.is_empty() || !valid_name(repo) || owner.split('/').any(|s| !valid_name(s)) { return None; }
        let host = host.to_lowercase();
        return Some(RepoRef { clone_url: format!("git@{host}:{owner}/{repo}.git"), host, owner: owner.into(), repo: repo.into(), ssh: true, ..Default::default() });
    }
    let (https, rest) = match t.strip_prefix("https://") {
        Some(r) => (true, r),
        None => (false, t.strip_prefix("http://").unwrap_or(t)),
    };
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let (host, path) = rest.split_once('/')?;
    let host = host.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if host == "github.com" {
        if segs.len() < 2 { return None; }
        let (owner, repo) = (segs[0], segs[1].strip_suffix(".git").unwrap_or(segs[1]));
        if RESERVED.contains(&owner.to_lowercase().as_str()) || !valid_name(owner) || !valid_name(repo) { return None; }
        let tree = (segs.len() > 3 && segs[2] == "tree").then(|| segs[3..].join("/"));
        return Some(github(owner, repo, tree));
    }
    // Any other host counts only as an https address that says it is a git repository.
    if !https || segs.len() < 2 { return None; }
    let repo = segs[segs.len() - 1].strip_suffix(".git")?;
    let owner = segs[..segs.len() - 1].join("/");
    if !valid_name(repo) || segs[..segs.len() - 1].iter().any(|s| !valid_name(s)) { return None; }
    Some(RepoRef { clone_url: format!("https://{host}/{}", segs.join("/")), host, owner, repo: repo.into(), ..Default::default() })
}

/// The comparable form of any remote address (https with or without a user, `git@host:`, `ssh://`), for "is this
/// folder already that repository".
pub fn repo_key(url: &str) -> String {
    let u = url.trim();
    let u = if let Some(r) = u.strip_prefix("ssh://") {
        let r = r.split_once('@').map(|x| x.1).unwrap_or(r);
        match r.split_once('/') { Some((h, p)) => format!("{}/{}", h.split(':').next().unwrap_or(h), p), None => r.to_string() }
    } else if let Some(r) = u.strip_prefix("git@") {
        r.replacen(':', "/", 1)
    } else {
        let r = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")).unwrap_or(u);
        match r.split_once('/') { Some((h, p)) => format!("{}/{}", h.rsplit('@').next().unwrap_or(h), p), None => r.to_string() }
    };
    let u = u.trim_end_matches('/');
    let u = u.strip_suffix(".git").unwrap_or(u);
    u.strip_prefix("www.").unwrap_or(u).to_lowercase()
}

/// `/tree/feature/x/apps/web` is ambiguous until the branches are known: the longest branch name that the path
/// starts with wins, the rest is the folder.
pub fn resolve_tree(tree: &str, heads: &[String]) -> Option<(String, Option<String>)> {
    let best = heads.iter().filter(|h| tree == h.as_str() || tree.starts_with(&format!("{h}/"))).max_by_key(|h| h.len())?;
    let sub = tree[best.len()..].trim_matches('/');
    Some((best.clone(), (!sub.is_empty()).then(|| sub.to_string())))
}

// ---------- what went wrong ----------

/// The kinds the dialog has words for: private, missing, offline, ssh, branch, folder, disk, nogit, link, busy,
/// cancelled, other. `detail` is git's own last line, for "Details".
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloneError {
    pub kind: String,
    pub detail: Option<String>,
    /// This build can sign in to GitHub (a client id was compiled in), so "private" can offer the button.
    pub sign_in: bool,
}

impl CloneError {
    pub fn new(kind: &str, detail: Option<String>) -> Self { Self { kind: kind.into(), detail, sign_in: client_id().is_some() } }
}

/// Recorded on git 2.51 with `LC_ALL=C` (lines in the tests below).
pub fn classify(output: &str) -> &'static str {
    let has = |s: &str| output.contains(s);
    if has("could not read Username") || has("terminal prompts disabled") || has("Authentication failed") || has("Invalid username or password") { "private" }
    else if has("Permission denied (publickey)") || has("Host key verification failed") { "ssh" }
    else if has("Repository not found") || (has("repository '") && has("' not found")) { "missing" }
    else if has("Remote branch") && has("not found") { "branch" }
    else if ["Could not resolve host", "Failed to connect", "Connection timed out", "Operation timed out", "Network is unreachable", "Couldn't connect to server", "Connection refused"].iter().any(|s| has(s)) { "offline" }
    else if has("No space left on device") { "disk" }
    else { "other" }
}

fn last_line(output: &str) -> Option<String> {
    output.lines().rev().map(str::trim).find(|l| !l.is_empty()).map(String::from)
}

// ---------- progress ----------

/// One line of git's `--progress` output → how far the download is (0…1) and the amount received so far
/// ("10.91 MiB") when git says. Receiving is most of the wait; resolving and checkout are the tail.
pub fn parse_progress(line: &str) -> Option<(f32, Option<String>)> {
    let (stage, rest) = line.split_once(':')?;
    let (lo, hi) = match stage.trim() {
        "Receiving objects" => (0.0, 0.85),
        "Resolving deltas" => (0.85, 0.97),
        "Updating files" => (0.97, 1.0),
        _ => return None,
    };
    let pct: f32 = rest.trim_start().split('%').next()?.trim().parse().ok()?;
    let amount = rest.split_once("), ").and_then(|(_, a)| a.split(" |").next()).map(|a| a.trim().trim_end_matches(", done.").to_string()).filter(|a| !a.is_empty());
    Some((lo + (hi - lo) * pct.clamp(0.0, 100.0) / 100.0, amount))
}

/// `<parent>/<name>`, or `<name>-2`, `-3`… when that is taken. Nothing is ever cloned into an existing folder.
pub fn free_dest(parent: &Path, name: &str) -> PathBuf {
    let mut p = parent.join(name);
    let mut n = 2;
    while p.exists() { p = parent.join(format!("{name}-{n}")); n += 1; }
    p
}

// ---------- asking GitHub ----------

const UA: &str = concat!("Supasito/", env!("CARGO_PKG_VERSION"));

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub description: Option<String>,
    pub private: Option<bool>,
    pub size_kb: Option<u64>,
    pub default_branch: Option<String>,
    pub language: Option<String>,
}

/// Everything the dialog shows about a pasted link before anything downloads.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Lookup {
    pub repo: RepoRef,
    pub info: Option<RepoInfo>,
    /// A site in the rail whose origin is this repository (and, for a `/tree/…` link, the same folder of it).
    pub existing_site_id: Option<String>,
    /// A folder that already is this repository but is not in the rail: in the sites folder, or at the top of one of
    /// the folders where code usually lives (remote.rs `CODE_FOLDERS`).
    pub existing_path: Option<String>,
    /// Claude conversations for the site or folder you already have, so the dialog can say what opening it keeps.
    pub existing_conversations: u32,
    /// Where a clone would go: `<parent>/<repo>`, or `-2`, `-3`… when that name is taken.
    pub dest: Option<String>,
}

/// GitHub's public API, for the card. A private repository answers 404 and a rate limit 403; either way the card
/// shows only the name, and git stays the authority on whether the clone works.
pub async fn repo_info(repo: &RepoRef) -> Option<RepoInfo> {
    if repo.host != "github.com" { return None; }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(4)).user_agent(UA).build().ok()?;
    let r = client.get(format!("https://api.github.com/repos/{}/{}", repo.owner, repo.repo)).header("Accept", "application/vnd.github+json").send().await.ok()?;
    if !r.status().is_success() { return None; }
    Some(info_from_api(&r.json::<Value>().await.ok()?))
}

pub fn info_from_api(v: &Value) -> RepoInfo {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from).filter(|x| !x.is_empty());
    RepoInfo { description: s("description"), private: v.get("private").and_then(|x| x.as_bool()), size_kb: v.get("size").and_then(|x| x.as_u64()), default_branch: s("default_branch"), language: s("language") }
}

/// The origin of a folder that is itself a repository (not a folder somewhere inside one), in `repo_key` form.
async fn origin_key(dir: &Path, path_env: &str) -> Option<String> {
    let out = tokio::process::Command::new("git").env("PATH", path_env).env("LC_ALL", "C").arg("-C").arg(dir).args(["remote", "get-url", "origin"]).output().await.ok()?;
    out.status.success().then(|| repo_key(String::from_utf8_lossy(&out.stdout).trim()))
}

/// For a `/tree/main/apps/web` link and a folder that is the repository: the deepest part of the path that exists.
fn existing_subdir(repo_dir: &Path, tree: &str) -> PathBuf {
    let segs: Vec<&str> = tree.split('/').filter(|s| !s.is_empty()).collect();
    (1..segs.len()).map(|i| repo_dir.join(segs[i..].join("/"))).find(|p| p.is_dir()).unwrap_or_else(|| repo_dir.to_path_buf())
}

pub async fn lookup(input: &str, parent: Option<&Path>, sites: &[Site], path_env: &str) -> Option<Lookup> {
    let repo = parse_repo_url(input)?;
    let key = repo.key();
    let existing = async {
        for s in sites.iter().filter(|s| s.is_git) {
            let dir = Path::new(&s.path);
            let Some(top) = crate::sites::git_toplevel(dir) else { continue };
            if origin_key(&top, path_env).await.as_deref() != Some(key.as_str()) { continue; }
            let rel = dir.strip_prefix(&top).map(|r| r.to_string_lossy().to_string()).unwrap_or_default();
            let same = match &repo.tree_path { None => rel.is_empty(), Some(t) => !rel.is_empty() && (t == &rel || t.ends_with(&format!("/{rel}"))) };
            if same { return Some(s.id.clone()); }
        }
        None
    };
    let (info, existing_site_id) = tokio::join!(repo_info(&repo), existing);
    let (mut existing_path, mut dest) = (None, None);
    if let Some(parent) = parent {
        let named = parent.join(&repo.repo);
        if named.join(".git").exists() && origin_key(&named, path_env).await.as_deref() == Some(key.as_str()) {
            let dir = match &repo.tree_path { Some(t) => existing_subdir(&named, t), None => named };
            existing_path = Some(dir.to_string_lossy().to_string());
        }
        dest = Some(free_dest(parent, &repo.repo).to_string_lossy().to_string());
    }
    if existing_site_id.is_none() && existing_path.is_none() {
        if let Some(found) = crate::remote::find_local_copies(&key, &crate::remote::code_folders()).into_iter().next() {
            let dir = match &repo.tree_path { Some(t) => existing_subdir(&found, t), None => found };
            existing_path = Some(dir.to_string_lossy().to_string());
        }
    }
    let existing_dir = existing_site_id.as_ref().and_then(|id| sites.iter().find(|s| &s.id == id)).map(|s| s.path.clone()).or_else(|| existing_path.clone());
    let existing_conversations = existing_dir.map(|d| crate::remote::conversations(Path::new(&d))).unwrap_or(0);
    Some(Lookup { repo, info, existing_site_id, existing_path, existing_conversations, dest })
}

// ---------- cloning ----------

/// The one clone that can run at a time: its process group, for Cancel.
#[derive(Default)]
pub struct Slot { pub running: bool, pub cancelled: bool, pub pid: Option<u32> }
pub type SlotRef = std::sync::Arc<std::sync::Mutex<Slot>>;

/// `clone://progress`. Phases in order: check (asking the remote), download, install. `percent` is 0…1 of the download.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Progress { pub phase: &'static str, pub percent: Option<f32>, pub amount: Option<String>, pub line: Option<String> }

impl Progress {
    fn phase(phase: &'static str) -> Self { Self { phase, percent: None, amount: None, line: None } }
    fn line(phase: &'static str, line: String) -> Self { Self { phase, percent: None, amount: None, line: Some(line) } }
}

fn git_command(git: &Path, path_env: &str, auth: &[String]) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(git);
    c.env("PATH", path_env).env("LC_ALL", "C").env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "never")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15")
        .args(auth).stdin(Stdio::null());
    c
}

/// Credentials in the order they are tried. First whatever git is set up with, plus the macOS Keychain, where Sign
/// in to GitHub stores its token even when git's config names no helper. Then, when `gh` is installed, the GitHub
/// CLI's login alone (a stale Keychain entry for another account would otherwise answer first).
fn auth_attempts(path_env: &str) -> Vec<Vec<String>> {
    let mut first = Vec::new();
    if cfg!(target_os = "macos") { first.extend(["-c".to_string(), "credential.helper=osxkeychain".to_string()]); }
    let mut out = vec![first];
    if let Some(gh) = crate::toolchain::which("gh", path_env) {
        out.push(vec!["-c".into(), "credential.helper=".into(), "-c".into(), format!("credential.helper=!'{}' auth git-credential", gh.display())]);
    }
    out
}

/// Ask the remote for its branches without writing anything: the cheapest way to learn that it is private, missing
/// or unreachable before a folder exists, and the branch list a `/tree/…` link needs.
async fn list_heads(git: &Path, url: &str, path_env: &str, auth: &[String]) -> Result<Vec<String>, String> {
    let mut c = git_command(git, path_env, auth);
    c.args(["ls-remote", "--heads", url]).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(60), c.output()).await
        .map_err(|_| "fatal: Connection timed out".to_string())?
        .map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
    Ok(String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.split('\t').nth(1)?.strip_prefix("refs/heads/").map(String::from)).collect())
}

async fn until_cancelled(slot: &SlotRef) {
    loop {
        let cancelled = slot.lock().unwrap().cancelled;
        if cancelled { return; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

type OnProgress<'a> = &'a (dyn Fn(Progress) + Send + Sync);

/// `git clone --progress`, reading stderr on both `\r` and `\n`: one event per whole percent, other lines as they
/// come. Full history on purpose: `--filter=blob:none` fetches the files at checkout without any progress output,
/// so the bar would sit at 100% for the longest part of the wait (measured on vercel/commerce, 2026-09-14).
async fn run_clone(git: &Path, path_env: &str, auth: &[String], url: &str, branch: Option<&str>, dest: &Path, slot: &SlotRef, on: OnProgress<'_>) -> Result<(), String> {
    use tokio::io::AsyncReadExt;
    let mut c = git_command(git, path_env, auth);
    c.args(["clone", "--progress"]);
    if let Some(b) = branch { c.args(["--branch", b]); }
    c.arg("--").arg(url).arg(dest).stdout(Stdio::null()).stderr(Stdio::piped()).process_group(0);
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    slot.lock().unwrap().pid = child.id();
    let mut err = child.stderr.take().ok_or("no stderr")?;
    let (mut buf, mut pending, mut tail, mut last) = ([0u8; 4096], String::new(), Vec::<String>::new(), -1.0f32);
    loop {
        let n = err.read(&mut buf).await.unwrap_or(0);
        if n == 0 { break; }
        pending.push_str(&String::from_utf8_lossy(&buf[..n]));
        while let Some(i) = pending.find(['\r', '\n']) {
            let line = pending[..i].trim().to_string();
            pending.drain(..=i);
            if line.is_empty() { continue; }
            match parse_progress(&line) {
                Some((f, amount)) => {
                    let pct = (f * 100.0).floor();
                    if pct != last { last = pct; on(Progress { phase: "download", percent: Some(f), amount, line: None }); }
                    if line.ends_with("done.") { on(Progress::line("download", line)); }
                }
                None => {
                    on(Progress::line("download", line.clone()));
                    tail.push(line);
                    if tail.len() > 30 { tail.remove(0); }
                }
            }
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    slot.lock().unwrap().pid = None;
    if status.success() { Ok(()) } else { Err(tail.join("\n")) }
}

/// The site's own package manager when it is installed, npm otherwise; lines go to the dialog's Details.
async fn install(site: &Site, path_env: &str, slot: &SlotRef, on: OnProgress<'_>) -> bool {
    let detected = site.package_manager.clone().unwrap_or_else(|| "npm".into());
    let pm = if crate::toolchain::which(&detected, path_env).is_some() { detected }
        else if crate::toolchain::which("npm", path_env).is_some() { "npm".to_string() }
        else { on(Progress::line("install", crate::sites::NO_NODE.into())); return false };
    let cmd = format!("{pm} install");
    on(Progress::line("install", format!("$ {cmd}")));
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut c = tokio::process::Command::new(&shell);
    c.args(["-lc", &cmd]).env("PATH", path_env).env("CI", "1").current_dir(&site.path)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
    let Ok(mut child) = c.spawn() else { return false };
    slot.lock().unwrap().pid = child.id();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    if let Some(o) = child.stdout.take() { crate::sites::pump_lines(o, tx.clone()); }
    if let Some(e) = child.stderr.take() { crate::sites::pump_lines(e, tx); }
    while let Some(l) = rx.recv().await { on(Progress::line("install", l)); }
    let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
    slot.lock().unwrap().pid = None;
    ok
}

/// Link → a site on disk with its packages installed. Nothing is written until the remote has answered; a failure
/// or Cancel after that removes the folder this call created, and never touches one that existed before.
/// `fresh` skips reusing a folder that already is this repository: "Download another copy" means a new `-2` folder.
pub async fn clone_repo(input: &str, parent: &Path, path_env: &str, slot: SlotRef, fresh: bool, on: impl Fn(Progress) + Send + Sync) -> Result<Site, CloneError> {
    let on: OnProgress = &on;
    let repo = parse_repo_url(input).ok_or_else(|| CloneError::new("link", None))?;
    let git = match crate::toolchain::git(path_env).await { crate::toolchain::Tool { ok: true, path: Some(p), .. } => PathBuf::from(p), _ => return Err(CloneError::new("nogit", None)) };
    let cancelled = || slot.lock().unwrap().cancelled;
    on(Progress::phase("check"));

    let attempts = auth_attempts(path_env);
    let (mut chosen, mut heads) = (0, Err(String::new()));
    for (i, auth) in attempts.iter().enumerate() {
        heads = tokio::select! {
            r = list_heads(&git, &repo.clone_url, path_env, auth) => r,
            _ = until_cancelled(&slot) => return Err(CloneError::new("cancelled", None)),
        };
        match &heads {
            Ok(_) => { chosen = i; break; }
            Err(e) if !matches!(classify(e), "private" | "missing") => break,
            Err(_) => {}
        }
    }
    let heads = heads.map_err(|e| CloneError::new(classify(&e), last_line(&e)))?;
    if cancelled() { return Err(CloneError::new("cancelled", None)); }
    let (branch, subdir) = match &repo.tree_path {
        Some(t) => resolve_tree(t, &heads).map(|(b, s)| (Some(b), s)).ok_or_else(|| CloneError::new("branch", Some(t.clone())))?,
        None => (None, None),
    };

    std::fs::create_dir_all(parent).map_err(|e| CloneError::new("other", Some(e.to_string())))?;
    let named = parent.join(&repo.repo);
    let same = !fresh && named.join(".git").exists() && origin_key(&named, path_env).await.as_deref() == Some(repo.key().as_str());
    let dest = if same { named } else { free_dest(parent, &repo.repo) };
    let fail = |kind: &str, detail: Option<String>| { if !same { let _ = std::fs::remove_dir_all(&dest); } CloneError::new(kind, detail) };
    if !same {
        on(Progress { phase: "download", percent: Some(0.0), amount: None, line: Some(format!("$ git clone --progress {} {}", repo.clone_url, dest.display())) });
        let result = run_clone(&git, path_env, &attempts[chosen], &repo.clone_url, branch.as_deref(), &dest, &slot, on).await;
        if cancelled() { return Err(fail("cancelled", None)); }
        if let Err(e) = result { return Err(fail(classify(&e), last_line(&e))); }
    }
    let site_dir = match &subdir { Some(s) => dest.join(s), None => dest.clone() };
    if !site_dir.is_dir() { return Err(fail("folder", subdir.clone())); }
    let mut site = Site::from_path(&site_dir.to_string_lossy()).map_err(|e| fail("other", Some(e)))?;
    if site.needs_install {
        on(Progress::phase("install"));
        let ok = install(&site, path_env, &slot, on).await;
        if cancelled() { return Err(fail("cancelled", None)); }
        // A failed install keeps the site: the preview's "needs a few pieces" card and Claude take it from there.
        if !ok { on(Progress::line("install", "The install didn't finish. The preview will offer to sort it out.".into())); }
        let _ = site.refresh();
    }
    Ok(site)
}

// ---------- Sign in to GitHub (OAuth device flow) ----------

/// The OAuth App's public client id, compiled in from `SUPASITO_GITHUB_CLIENT_ID` (`.env.release`); debug builds
/// also read it at run time. Without one, the private-repository message offers no sign-in button. The device flow
/// has no client secret, so nothing secret ships in the app.
pub fn client_id() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Some(v) = std::env::var("SUPASITO_GITHUB_CLIENT_ID").ok().filter(|v| !v.is_empty()) { return Some(v); }
    option_env!("SUPASITO_GITHUB_CLIENT_ID").filter(|v| !v.is_empty()).map(String::from)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
    /// Stays in the backend: it is what the poll proves possession with.
    #[serde(skip)]
    pub device_code: String,
}

pub fn parse_device_code(v: &Value) -> Result<DeviceCode, String> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
    match (s("device_code"), s("user_code")) {
        (Some(device_code), Some(user_code)) => Ok(DeviceCode {
            device_code,
            user_code,
            verification_uri: s("verification_uri").unwrap_or_else(|| "https://github.com/login/device".into()),
            interval: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5).max(1),
            expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900),
        }),
        _ => Err(s("error_description").or_else(|| s("error")).unwrap_or_else(|| "GitHub didn't return a sign-in code.".into())),
    }
}

#[derive(Debug, PartialEq)]
pub enum TokenPoll { Token(String), Pending, SlowDown(u64), Failed(String) }

pub fn parse_token_poll(v: &Value) -> TokenPoll {
    if let Some(t) = v.get("access_token").and_then(|x| x.as_str()) { return TokenPoll::Token(t.into()); }
    match v.get("error").and_then(|x| x.as_str()) {
        Some("authorization_pending") => TokenPoll::Pending,
        Some("slow_down") => TokenPoll::SlowDown(v.get("interval").and_then(|x| x.as_u64()).unwrap_or(10)),
        Some("expired_token") => TokenPoll::Failed("The code expired. Start the sign-in again.".into()),
        Some("access_denied") => TokenPoll::Failed("The sign-in was declined on GitHub.".into()),
        Some(e) => TokenPoll::Failed(v.get("error_description").and_then(|x| x.as_str()).unwrap_or(e).to_string()),
        None => TokenPoll::Failed("GitHub gave an answer Supasito doesn't understand.".into()),
    }
}

async fn post_json(url: &str, body: Value) -> Result<Value, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent(UA).build().map_err(|e| e.to_string())?;
    let r = client.post(url).header("Accept", "application/json").json(&body).send().await.map_err(|_| "Can't reach GitHub. Check that you're online.".to_string())?;
    r.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn device_start() -> Result<DeviceCode, String> {
    let id = client_id().ok_or("GitHub sign-in isn't available in this build.")?;
    parse_device_code(&post_json("https://github.com/login/device/code", serde_json::json!({ "client_id": id, "scope": "repo" })).await?)
}

/// Poll until the user approves on GitHub, then hand the token to git's credential store (the macOS Keychain) and
/// return the account name. Supasito keeps no copy: the clone, and later Publish's push, find it through git.
pub async fn device_wait(code: &DeviceCode, path_env: &str, cancelled: impl Fn() -> bool) -> Result<String, String> {
    let id = client_id().ok_or("GitHub sign-in isn't available in this build.")?;
    let deadline = std::time::Instant::now() + Duration::from_secs(code.expires_in);
    let mut interval = code.interval;
    loop {
        for _ in 0..interval * 4 {
            if cancelled() { return Err("cancelled".into()); }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        if std::time::Instant::now() > deadline { return Err("The code expired. Start the sign-in again.".into()); }
        let body = serde_json::json!({ "client_id": id, "device_code": code.device_code, "grant_type": "urn:ietf:params:oauth:grant-type:device_code" });
        // A network blip while waiting is not a failed sign-in; the deadline still ends it.
        let Ok(v) = post_json("https://github.com/login/oauth/access_token", body).await else { continue };
        match parse_token_poll(&v) {
            TokenPoll::Pending => {}
            TokenPoll::SlowDown(n) => interval = n.max(interval + 5),
            TokenPoll::Failed(e) => return Err(e),
            TokenPoll::Token(token) => {
                let login = github_login(&token).await.unwrap_or_else(|| "x-access-token".into());
                store_credential(&login, &token, path_env).await?;
                return Ok(login);
            }
        }
    }
}

async fn github_login(token: &str) -> Option<String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).user_agent(UA).build().ok()?;
    let v: Value = client.get("https://api.github.com/user").bearer_auth(token).header("Accept", "application/vnd.github+json").send().await.ok()?.json().await.ok()?;
    v.get("login")?.as_str().map(String::from)
}

async fn store_credential(login: &str, token: &str, path_env: &str) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let mut c = tokio::process::Command::new("git");
    c.env("PATH", path_env).env("GIT_TERMINAL_PROMPT", "0");
    if cfg!(target_os = "macos") { c.args(["-c", "credential.helper=osxkeychain"]); }
    let mut child = c.args(["credential", "approve"]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(format!("protocol=https\nhost=github.com\nusername={login}\npassword={token}\n\n").as_bytes()).await.map_err(|e| e.to_string())?;
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(format!("Couldn't save the sign-in: {}", String::from_utf8_lossy(&out.stderr).trim())) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gh(owner: &str, repo: &str, tree: Option<&str>) -> RepoRef { github(owner, repo, tree.map(String::from)) }

    #[test]
    fn reads_what_people_copy() {
        let plain = gh("mara-okafor", "bakery-site", None);
        for s in [
            "https://github.com/mara-okafor/bakery-site",
            "https://github.com/mara-okafor/bakery-site/",
            "https://github.com/mara-okafor/bakery-site.git",
            "https://www.github.com/mara-okafor/bakery-site?tab=readme-ov-file#readme",
            "http://github.com/mara-okafor/bakery-site",
            "github.com/mara-okafor/bakery-site",
            "  <https://github.com/mara-okafor/bakery-site>  ",
            "https://github.com/mara-okafor/bakery-site/blob/main/README.md",
            "https://github.com/mara-okafor/bakery-site/issues/4",
        ] { assert_eq!(parse_repo_url(s), Some(plain.clone()), "{s}"); }
        assert_eq!(parse_repo_url("https://github.com/fieldnotes/monorepo/tree/main/apps/web"), Some(gh("fieldnotes", "monorepo", Some("main/apps/web"))));
        let cmd = parse_repo_url("gh repo clone mara-okafor/bakery-site").unwrap();
        assert!(cmd.from_command && cmd.clone_url == plain.clone_url);
        let ssh = parse_repo_url("git@github.com:mara-okafor/bakery-site.git").unwrap();
        assert!(ssh.ssh && ssh.clone_url == "git@github.com:mara-okafor/bakery-site.git" && ssh.key() == plain.key());
        let lab = parse_repo_url("https://gitlab.com/group/sub/site.git").unwrap();
        assert_eq!((lab.host.as_str(), lab.owner.as_str(), lab.repo.as_str(), lab.clone_url.as_str()), ("gitlab.com", "group/sub", "site", "https://gitlab.com/group/sub/site.git"));
    }

    #[test]
    fn names_and_other_pages_are_not_links() {
        for s in ["My bakery", "bakery-site", "mara-okafor/bakery-site", "https://github.com/mara-okafor", "https://github.com/orgs/fieldnotes/repositories",
                  "https://github.com/settings/profile", "https://example.com/about", "http://gitlab.com/group/site.git", "https://github.com/a b/c", "gh auth login", ""] {
            assert_eq!(parse_repo_url(s), None, "{s}");
        }
    }

    #[test]
    fn remote_addresses_compare_by_repository() {
        let k = "github.com/mara-okafor/bakery-site";
        for u in ["https://github.com/Mara-Okafor/bakery-site.git", "https://wozu@github.com/mara-okafor/bakery-site", "git@github.com:mara-okafor/bakery-site.git", "ssh://git@github.com:22/mara-okafor/bakery-site.git", "https://github.com/mara-okafor/bakery-site/"] {
            assert_eq!(repo_key(u), k, "{u}");
        }
        assert_ne!(repo_key("https://github.com/mara-okafor/bakery-sight"), k);
    }

    #[test]
    fn a_branch_with_a_slash_is_found_before_the_folder() {
        let heads: Vec<String> = ["main", "feature", "feature/x"].map(String::from).to_vec();
        assert_eq!(resolve_tree("feature/x/apps/web", &heads), Some(("feature/x".into(), Some("apps/web".into()))));
        assert_eq!(resolve_tree("main", &heads), Some(("main".into(), None)));
        assert_eq!(resolve_tree("main/apps/web/", &heads), Some(("main".into(), Some("apps/web".into()))));
        assert_eq!(resolve_tree("mainline/x", &heads), None);
    }

    #[test]
    fn classifies_recorded_git_failures() {
        assert_eq!(classify("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "private");
        assert_eq!(classify("remote: Repository not found.\nfatal: repository 'https://github.com/wojtekwoz/does-not-exist-xyz/' not found"), "missing");
        assert_eq!(classify("fatal: unable to access 'https://github.invalid/octocat/Hello-World/': Could not resolve host: github.invalid"), "offline");
        assert_eq!(classify("Load key \"/dev/null\": invalid format\ngit@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), "ssh");
        assert_eq!(classify("Cloning into 'nb'...\nfatal: Remote branch nope-xyz not found in upstream origin"), "branch");
        assert_eq!(classify("error: something new"), "other");
        assert_eq!(last_line("a\nfatal: b\n\n").as_deref(), Some("fatal: b"));
    }

    #[test]
    fn reads_progress_lines() {
        assert_eq!(parse_progress("Receiving objects:  50% (902/1804)"), Some((0.425, None)));
        let (f, amount) = parse_progress("Receiving objects: 100% (17042/17042), 10.91 MiB | 2.41 MiB/s, done.").unwrap();
        assert!((f - 0.85).abs() < 1e-4 && amount.as_deref() == Some("10.91 MiB"));
        assert_eq!(parse_progress("Resolving deltas: 100% (4893/4893), done.").map(|p| p.0), Some(0.97));
        assert_eq!(parse_progress("remote: Enumerating objects: 9984, done."), None);
        assert_eq!(parse_progress("Cloning into 'x'..."), None);
    }

    #[test]
    fn never_reuses_a_folder() {
        let dir = std::env::temp_dir().join(format!("supasito-dest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("site")).unwrap();
        std::fs::create_dir_all(dir.join("site-2")).unwrap();
        assert_eq!(free_dest(&dir, "site"), dir.join("site-3"));
        assert_eq!(free_dest(&dir, "other"), dir.join("other"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_github_answers() {
        let v = serde_json::json!({ "description": "Website for Sourdough & Co.", "private": false, "size": 38112, "default_branch": "main", "language": "TypeScript" });
        assert_eq!(info_from_api(&v), RepoInfo { description: Some("Website for Sourdough & Co.".into()), private: Some(false), size_kb: Some(38112), default_branch: Some("main".into()), language: Some("TypeScript".into()) });
        // Shapes from docs.github.com "Authorizing OAuth apps", device flow.
        let code = parse_device_code(&serde_json::json!({ "device_code": "3584d83530557fdd1f46af8289938c8ef79f9dc5", "user_code": "WDJB-MJHT", "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 5 })).unwrap();
        assert_eq!((code.user_code.as_str(), code.interval, code.expires_in), ("WDJB-MJHT", 5, 900));
        assert!(!serde_json::to_string(&code).unwrap().contains("3584d835"), "the device code stays in the backend");
        assert!(parse_device_code(&serde_json::json!({ "error": "device_flow_disabled", "error_description": "Device Flow must be explicitly enabled for this App" })).unwrap_err().contains("explicitly enabled"));
        assert_eq!(parse_token_poll(&serde_json::json!({ "access_token": "gho_16C7e42F292c6912E7710c838347Ae178B4a", "token_type": "bearer", "scope": "repo" })), TokenPoll::Token("gho_16C7e42F292c6912E7710c838347Ae178B4a".into()));
        assert_eq!(parse_token_poll(&serde_json::json!({ "error": "authorization_pending" })), TokenPoll::Pending);
        assert_eq!(parse_token_poll(&serde_json::json!({ "error": "slow_down", "interval": 10 })), TokenPoll::SlowDown(10));
        assert!(matches!(parse_token_poll(&serde_json::json!({ "error": "access_denied" })), TokenPoll::Failed(_)));
    }

    /// Network: clones octocat/Hello-World. `cargo test -- --ignored clone_public`.
    #[tokio::test]
    #[ignore]
    async fn clone_public() {
        let parent = std::env::temp_dir().join(format!("supasito-clone-{}", uuid::Uuid::new_v4()));
        let env = crate::state::login_shell_path();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let log = seen.clone();
        let site = clone_repo("https://github.com/octocat/Hello-World", &parent, &env, SlotRef::default(), false, move |p| log.lock().unwrap().push(p.phase.to_string())).await.unwrap();
        assert!(site.is_git && site.path.ends_with("Hello-World"), "{}", site.path);
        assert!(seen.lock().unwrap().iter().any(|p| p == "download"));
        // The same link again is the same folder, not Hello-World-2.
        let again = clone_repo("github.com/octocat/Hello-World.git", &parent, &env, SlotRef::default(), false, |_| {}).await.unwrap();
        assert_eq!(again.path, site.path);
        assert!(!parent.join("Hello-World-2").exists());
        // A repository that isn't there leaves nothing behind.
        let err = clone_repo("https://github.com/octocat/does-not-exist-supasito", &parent, &env, SlotRef::default(), false, |_| {}).await.unwrap_err();
        assert!(matches!(err.kind.as_str(), "missing" | "private"), "{err:?}");
        assert!(!parent.join("does-not-exist-supasito").exists());
        let _ = std::fs::remove_dir_all(&parent);
    }
}
