//! A site that lives on a git host (PLAN §8e.11): keeping the copy in step with its remote, the branch Publish pushes
//! to, the secrets a site expects from `.env` files git never stores, and finding a copy already on this Mac.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

// ---------- staying in step ----------

/// `state`: none (no upstream to compare with), current, updated (fast-forwarded just now), behind (the remote has
/// commits this copy cannot take on its own), failed (fetch did not work; `detail` is clone.rs's kind).
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: String,
    pub ahead: u32,
    /// For "updated", how many commits came in.
    pub behind: u32,
    pub branch: Option<String>,
    /// For "updated": the files that changed, repository-relative.
    pub files: Vec<String>,
    /// For "updated": `package.json` or a lockfile changed, so packages need installing again.
    pub deps_changed: bool,
    pub detail: Option<String>,
}

fn status(state: &str) -> SyncStatus { SyncStatus { state: state.into(), ..Default::default() } }

async fn git(path: &str, path_env: &str, args: &[&str], timeout: u64) -> Result<String, String> {
    let mut c = tokio::process::Command::new("git");
    c.env("PATH", path_env).env("LC_ALL", "C").env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "never")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15")
        .arg("-C").arg(path).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(timeout), c.output()).await
        .map_err(|_| "fatal: Connection timed out".to_string())?
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

const DEPENDENCY_FILES: &[&str] = &["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"];

/// Fetch, compare with the upstream, and with `apply` fast-forward when that cannot touch anything of the user's
/// (git refuses a fast-forward that would overwrite uncommitted edits, which then reads as "behind").
pub async fn sync(path: &str, path_env: &str, apply: bool) -> SyncStatus {
    if crate::sites::git_toplevel(Path::new(path)).is_none() { return status("none"); }
    let Ok(upstream) = git(path, path_env, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], 10).await else { return status("none") };
    let branch = git(path, path_env, &["rev-parse", "--abbrev-ref", "HEAD"], 10).await.ok();
    let remote = upstream.split('/').next().unwrap_or("origin").to_string();
    if let Err(e) = git(path, path_env, &["fetch", "--quiet", "--no-tags", &remote], 45).await {
        return SyncStatus { state: "failed".into(), branch, detail: Some(crate::clone::classify(&e).into()), ..Default::default() };
    }
    let counts = git(path, path_env, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], 10).await.unwrap_or_default();
    let mut n = counts.split_whitespace().map(|x| x.parse::<u32>().unwrap_or(0));
    let (ahead, behind) = (n.next().unwrap_or(0), n.next().unwrap_or(0));
    let base = SyncStatus { ahead, behind, branch, ..Default::default() };
    if behind == 0 { return SyncStatus { state: "current".into(), ..base }; }
    if !apply || ahead > 0 { return SyncStatus { state: "behind".into(), ..base }; }
    let Ok(before) = git(path, path_env, &["rev-parse", "HEAD"], 10).await else { return SyncStatus { state: "behind".into(), ..base } };
    if let Err(e) = git(path, path_env, &["merge", "--ff-only", "--quiet", "@{upstream}"], 60).await {
        return SyncStatus { state: "behind".into(), detail: Some(if e.contains("would be overwritten") { "local".into() } else { crate::clone::classify(&e).into() }), ..base };
    }
    let files: Vec<String> = git(path, path_env, &["diff", "--name-only", &before, "HEAD"], 10).await.unwrap_or_default().lines().map(String::from).collect();
    let deps_changed = files.iter().any(|f| DEPENDENCY_FILES.contains(&f.rsplit('/').next().unwrap_or(f)));
    SyncStatus { state: "updated".into(), files, deps_changed, ..base }
}

// ---------- the branch Publish pushes to ----------

/// The remote's default branch as the clone recorded it (`refs/remotes/origin/HEAD`), read from the file so site
/// detection does not start a process.
pub fn default_branch(root: &Path) -> Option<String> {
    let top = crate::sites::git_toplevel(root)?;
    let text = std::fs::read_to_string(top.join(".git/refs/remotes/origin/HEAD")).ok()?;
    text.trim().strip_prefix("ref: refs/remotes/origin/").map(String::from).filter(|b| !b.is_empty())
}

/// `url` of `[remote "origin"]` in a repository's `.git/config`.
pub fn origin_from_config(repo_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(repo_dir.join(".git/config")).ok()?;
    let mut in_origin = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') { in_origin = line.replace(' ', "") == "[remote\"origin\"]"; continue; }
        if in_origin {
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == "url" { return Some(v.trim().to_string()); }
            }
        }
    }
    None
}

// ---------- secrets ----------

const EXAMPLES: &[&str] = &[".env.example", ".env.local.example", ".env.sample", ".env.template", ".env.dist"];
pub const REAL_ENV: &[&str] = &[".env.local", ".env", ".env.development.local", ".env.development"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvKey {
    pub name: String,
    /// The comment above the key in the example file.
    pub hint: Option<String>,
    /// The example's value when it looks like a real one (a local URL, a port) rather than a placeholder.
    pub value: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvNeeds {
    /// The example file the keys come from.
    pub example: String,
    /// The file saving writes to.
    pub file: String,
    pub keys: Vec<EnvKey>,
}

fn valid_key(k: &str) -> bool {
    let mut c = k.chars();
    c.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_') && c.all(|x| x.is_ascii_alphanumeric() || x == '_')
}

/// `(name, value, comment above)` for each assignment, in order. Values lose surrounding quotes and a trailing comment.
pub fn parse_env(text: &str) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    let mut comment: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() { comment.clear(); continue; }
        if let Some(c) = line.strip_prefix('#') { comment.push(c.trim().to_string()); continue; }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else { comment.clear(); continue };
        let k = k.trim();
        if !valid_key(k) { comment.clear(); continue; }
        let v = v.trim();
        let v = if (v.starts_with('"') && v.ends_with('"') && v.len() >= 2) || (v.starts_with('\'') && v.ends_with('\'') && v.len() >= 2) {
            v[1..v.len() - 1].to_string()
        } else {
            v.split(" #").next().unwrap_or(v).trim().to_string()
        };
        let hint = (!comment.is_empty()).then(|| comment.join(" ").chars().take(160).collect::<String>()).filter(|h| !h.is_empty());
        out.push((k.to_string(), v, hint));
        comment.clear();
    }
    out
}

/// A value an example file uses to show the shape, not one that works.
pub fn is_placeholder(v: &str) -> bool {
    let l = v.to_lowercase();
    l.is_empty() || ["your", "xxx", "change", "replace", "example", "placeholder", "todo", "<", "...", "…", "insert", "secret", "_here", "-here", "dummy", "fill"].iter().any(|p| l.contains(p))
}

/// The keys an example file lists that no real env file sets, or None when nothing is missing.
pub fn env_needs(root: &Path, framework: Option<&str>) -> Option<EnvNeeds> {
    let example = EXAMPLES.iter().find(|e| root.join(e).is_file())?;
    let keys = parse_env(&std::fs::read_to_string(root.join(example)).ok()?);
    let set: std::collections::HashSet<String> = REAL_ENV.iter()
        .filter_map(|f| std::fs::read_to_string(root.join(f)).ok())
        .flat_map(|t| parse_env(&t).into_iter().filter(|(_, v, _)| !v.is_empty()).map(|(k, _, _)| k).collect::<Vec<_>>())
        .collect();
    let mut seen = std::collections::HashSet::new();
    let missing: Vec<EnvKey> = keys.into_iter()
        .filter(|(k, _, _)| !set.contains(k) && seen.insert(k.clone()))
        .map(|(name, v, hint)| EnvKey { name, value: (!is_placeholder(&v)).then_some(v), hint })
        .collect();
    if missing.is_empty() { return None; }
    let file = if root.join(".env.local").is_file() { ".env.local" }
        else if root.join(".env").is_file() { ".env" }
        else if *example == ".env.local.example" || matches!(framework, Some("next" | "vite" | "astro" | "sveltekit")) { ".env.local" }
        else { ".env" };
    Some(EnvNeeds { example: example.to_string(), file: file.into(), keys: missing })
}

fn quote_env(v: &str) -> String {
    if !v.is_empty() && v.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:@+,=".contains(c)) { v.to_string() }
    else { format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\"")) }
}

/// Write the values into `file` (one of `REAL_ENV`): an existing line for a key is replaced, everything else is kept,
/// the file is readable only by the user, and it is added to `.gitignore` when git would otherwise pick it up.
pub async fn env_save(root: &Path, file: &str, values: &[(String, String)], path_env: &str) -> Result<(), String> {
    if !REAL_ENV.contains(&file) { return Err(format!("{file} is not an env file")); }
    let values: Vec<&(String, String)> = values.iter().filter(|(_, v)| !v.trim().is_empty()).collect();
    for (k, v) in &values {
        if !valid_key(k) { return Err(format!("{k} is not a valid name")); }
        if v.contains('\n') || v.contains('\r') { return Err(format!("{k} can't contain a line break")); }
    }
    let path = root.join(file);
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = existing.lines().map(String::from).collect();
    for (k, v) in &values {
        let line = format!("{k}={}", quote_env(v.trim()));
        let at = lines.iter().position(|l| { let t = l.trim_start(); let t = t.strip_prefix("export ").unwrap_or(t); t.split_once('=').is_some_and(|(n, _)| n.trim() == k) });
        match at { Some(i) => lines[i] = line, None => lines.push(line) }
    }
    let mut text = lines.join("\n");
    text.push('\n');
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)); }
    if crate::sites::git_toplevel(root).is_some() {
        let root_s = root.to_string_lossy();
        // exit 1 means "not ignored"; an error (not a repository) leaves .gitignore alone
        let mut c = tokio::process::Command::new("git");
        let ignored = c.env("PATH", path_env).arg("-C").arg(root_s.as_ref()).args(["check-ignore", "-q", file]).status().await.map(|s| s.code());
        if let Ok(Some(1)) = ignored {
            let gi = root.join(".gitignore");
            let mut g = std::fs::read_to_string(&gi).unwrap_or_default();
            if !g.is_empty() && !g.ends_with('\n') { g.push('\n'); }
            g.push_str(&format!("{file}\n"));
            std::fs::write(&gi, g).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---------- a copy already on this Mac ----------

/// Top-level folders in the home folder where code usually lives. `~/Documents`, `~/Desktop` and `~/Downloads` are left
/// out on purpose: reading them makes macOS ask the user for permission.
pub const CODE_FOLDERS: &[&str] = &["Sites", "Developer", "Projects", "code", "dev", "src", "repos", "GitHub", "git", "workspace", "www"];

/// Folders one level inside `roots` whose `origin` is the repository `key` (`clone::repo_key` form).
pub fn find_local_copies(key: &str, roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for root in roots {
        let Ok(canon) = root.canonicalize() else { continue };
        if !seen.insert(canon.to_string_lossy().to_lowercase()) { continue; }
        let Ok(entries) = std::fs::read_dir(&canon) else { continue };
        for entry in entries.flatten().take(1000) {
            let dir = entry.path();
            if !dir.join(".git").is_dir() { continue; }
            if origin_from_config(&dir).is_some_and(|u| crate::clone::repo_key(&u) == key) { out.push(dir); }
        }
    }
    out
}

pub fn code_folders() -> Vec<PathBuf> {
    dirs::home_dir().map(|h| CODE_FOLDERS.iter().map(|f| h.join(f)).collect()).unwrap_or_default()
}

/// How many Claude conversations exist for a folder, counted from Claude's own project folder.
pub fn conversations(path: &Path) -> u32 {
    let Some(dir) = crate::agent::sessions::project_dir(&path.to_string_lossy()) else { return 0 };
    std::fs::read_dir(dir).map(|d| d.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "jsonl")).count() as u32).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("supasito-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }
    fn sh(dir: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git").arg("-C").arg(dir).args(["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "init.defaultBranch=main"]).args(args).output().unwrap();
        assert!(ok.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ok.stderr));
    }

    #[tokio::test]
    async fn fast_forwards_only_when_nothing_of_yours_is_in_the_way() {
        let base = tmp("sync");
        let env = crate::state::login_shell_path();
        let (bare, a, b) = (base.join("remote.git"), base.join("a"), base.join("b"));
        std::fs::create_dir_all(&bare).unwrap();
        sh(&bare, &["init", "--bare", "-q", "-b", "main"]);
        sh(&base, &["clone", "-q", bare.to_str().unwrap(), "b"]);
        std::fs::write(b.join("index.html"), "one").unwrap();
        sh(&b, &["add", "-A"]); sh(&b, &["commit", "-qm", "first"]); sh(&b, &["push", "-q", "origin", "HEAD:main"]);
        sh(&base, &["clone", "-q", bare.to_str().unwrap(), "a"]);
        let a_s = a.to_str().unwrap();
        assert_eq!(sync(a_s, &env, true).await.state, "current");
        assert_eq!(default_branch(&a).as_deref(), Some("main"));
        assert!(origin_from_config(&a).unwrap().ends_with("remote.git"));

        // GitHub moved on, this copy is clean: it fast-forwards and says what changed.
        std::fs::write(b.join("index.html"), "two").unwrap();
        std::fs::write(b.join("package.json"), "{}").unwrap();
        sh(&b, &["add", "-A"]); sh(&b, &["commit", "-qm", "second"]); sh(&b, &["push", "-q", "origin", "HEAD:main"]);
        let r = sync(a_s, &env, true).await;
        assert_eq!((r.state.as_str(), r.behind, r.deps_changed), ("updated", 1, true), "{r:?}");
        assert_eq!(std::fs::read_to_string(a.join("index.html")).unwrap(), "two");

        // Moved on again, and this copy has an uncommitted edit to the same file: nothing is touched.
        std::fs::write(b.join("index.html"), "three").unwrap();
        sh(&b, &["commit", "-qam", "third"]); sh(&b, &["push", "-q", "origin", "HEAD:main"]);
        std::fs::write(a.join("index.html"), "mine").unwrap();
        let r = sync(a_s, &env, true).await;
        assert_eq!((r.state.as_str(), r.detail.as_deref()), ("behind", Some("local")), "{r:?}");
        assert_eq!(std::fs::read_to_string(a.join("index.html")).unwrap(), "mine");

        // A commit here and one there: ahead and behind, and still nothing touched.
        sh(&a, &["commit", "-qam", "mine"]);
        let r = sync(a_s, &env, true).await;
        assert_eq!((r.state.as_str(), r.ahead, r.behind), ("behind", 1, 1), "{r:?}");

        // A branch with no upstream is not compared.
        sh(&a, &["checkout", "-qb", "local-only"]);
        assert_eq!(sync(a_s, &env, true).await.state, "none");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn reads_example_env_files() {
        let parsed = parse_env("# Stripe secret key, from the dashboard\nSTRIPE_SECRET_KEY=sk_test_your_key_here\n\nexport NEXT_PUBLIC_SITE_URL=\"http://localhost:3000\"\nPORT=4321 # dev only\nnot a line\n9BAD=x\n");
        assert_eq!(parsed, vec![
            ("STRIPE_SECRET_KEY".into(), "sk_test_your_key_here".into(), Some("Stripe secret key, from the dashboard".into())),
            ("NEXT_PUBLIC_SITE_URL".into(), "http://localhost:3000".into(), None),
            ("PORT".into(), "4321".into(), None),
        ]);
        assert!(is_placeholder("sk_test_your_key_here") && is_placeholder("") && is_placeholder("<token>") && !is_placeholder("http://localhost:3000"));
    }

    #[tokio::test]
    async fn asks_only_for_what_is_missing_and_saves_it_privately() {
        let dir = tmp("env");
        let env = crate::state::login_shell_path();
        std::fs::write(dir.join(".env.example"), "# Where the database lives\nDATABASE_URL=postgres://user:password@host/db-change-me\nSITE_URL=http://localhost:3000\nMAPBOX_TOKEN=\n").unwrap();
        std::fs::write(dir.join(".env"), "MAPBOX_TOKEN=pk.set\n").unwrap();
        let needs = env_needs(&dir, Some("next")).unwrap();
        assert_eq!(needs.file, ".env", "an existing real file is the one to extend");
        assert_eq!(needs.keys.iter().map(|k| k.name.as_str()).collect::<Vec<_>>(), vec!["DATABASE_URL", "SITE_URL"]);
        assert_eq!(needs.keys[0].hint.as_deref(), Some("Where the database lives"));
        assert_eq!((needs.keys[0].value.as_deref(), needs.keys[1].value.as_deref()), (None, Some("http://localhost:3000")));

        sh(&dir, &["init", "-q"]);
        env_save(&dir, ".env", &[("DATABASE_URL".into(), "postgres://me:p w\"d@db/site".into()), ("SITE_URL".into(), "http://localhost:3000".into()), ("EMPTY".into(), "  ".into())], &env).await.unwrap();
        let text = std::fs::read_to_string(dir.join(".env")).unwrap();
        assert_eq!(text, "MAPBOX_TOKEN=pk.set\nDATABASE_URL=\"postgres://me:p w\\\"d@db/site\"\nSITE_URL=http://localhost:3000\n");
        assert!(env_needs(&dir, Some("next")).is_none());
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), ".env\n");
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(dir.join(".env")).unwrap().permissions().mode() & 0o777, 0o600);
        // Replacing a value keeps the line in place, and an already ignored file leaves .gitignore alone.
        env_save(&dir, ".env", &[("MAPBOX_TOKEN".into(), "pk.new".into())], &env).await.unwrap();
        assert!(std::fs::read_to_string(dir.join(".env")).unwrap().starts_with("MAPBOX_TOKEN=pk.new\n"));
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), ".env\n");
        assert!(env_save(&dir, "../x", &[], &env).await.is_err());
        assert!(env_save(&dir, ".env", &[("A".into(), "one\ntwo".into())], &env).await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_a_copy_in_the_usual_folders() {
        let home = tmp("home");
        for (folder, origin) in [("code/bakery-site", "git@github.com:Mara-Okafor/bakery-site.git"), ("code/other", "https://github.com/x/y"), ("Projects/bakery", "https://github.com/mara-okafor/bakery-site")] {
            let d = home.join(folder).join(".git");
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("config"), format!("[core]\n\tbare = false\n[remote \"upstream\"]\n\turl = https://github.com/nope/nope\n[remote \"origin\"]\n\turl = {origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n")).unwrap();
        }
        let roots = [home.join("code"), home.join("Projects"), home.join("code"), home.join("missing")];
        let mut found = find_local_copies("github.com/mara-okafor/bakery-site", &roots);
        found.sort();
        assert_eq!(found, vec![home.join("Projects/bakery"), home.join("code/bakery-site")]);
        let _ = std::fs::remove_dir_all(&home);
    }
}
