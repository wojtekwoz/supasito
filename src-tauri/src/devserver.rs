use std::{collections::HashMap, future::Future, path::PathBuf, pin::Pin, process::Stdio, sync::{atomic::{AtomicBool, Ordering}, Arc}, time::Duration};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{process::Child, sync::{Mutex, OwnedMutexGuard}};

use crate::sites::Site;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DevInfo {
    pub site_id: String,
    pub port: u16,
    pub url: String,
    pub status: String, // starting | ready | error | stopped
    pub command: String,
    /// Why `status` is `error`, when Supasito knows more than the log tail shows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<DevProblem>,
}

/// The process listening on a port, as far as `lsof` and `ps` can tell.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Holder {
    pub pid: u32,
    pub pgid: u32,
    /// Executable name (`node`, `next-server (v16.3.3)`, `python3`).
    pub name: String,
    /// Full command line.
    pub command: String,
    pub cwd: Option<String>,
    /// Set when the holder is a dev server Supasito started for another site.
    pub site_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DevProblem {
    /// The dev command insists on a port something else is listening on.
    Port { port: u16, holder: Option<Holder> },
}

struct Running {
    info: DevInfo,
    pid: u32,
    log: Vec<String>,
    child: Option<Child>,
    /// Port printed by the dev server itself ("Local: http://localhost:4322/"), which wins over
    /// the one we asked for when a framework silently picks the next free port.
    announced_port: Option<u16>,
    /// Port named by an EADDRINUSE-style line in the log (our own port when the line names none).
    conflict_port: Option<u16>,
    /// Ports this start has tried: the first one plus every retry after a conflict.
    tried: Vec<u16>,
    /// Something that is not our server answers on our port; readiness then waits for the server's
    /// own "Local:" line or its exit instead of trusting the port.
    foreign: Option<Holder>,
    /// Set once the log pumps have read everything the current child wrote, so an exit is judged
    /// after its last lines (the EADDRINUSE one arrives just before the process goes).
    drained: Arc<AtomicBool>,
}

#[derive(Clone)]
struct Shared {
    map: Arc<Mutex<HashMap<String, Arc<Mutex<Running>>>>>,
    /// Records the pids of dev servers we started, so a later launch can kill any that outlived
    /// an app instance that died without cleaning up (e.g. `tauri dev` relaunching on rebuild).
    pids_file: Arc<PathBuf>,
}

pub struct Registry {
    shared: Shared,
}

impl Registry {
    pub fn new(pids_file: std::path::PathBuf) -> Self {
        reap_orphans(&pids_file);
        Self { shared: Shared { map: Arc::new(Mutex::new(HashMap::new())), pids_file: Arc::new(pids_file) } }
    }
}

impl Shared {
    async fn persist(&self) {
        let map = self.map.lock().await;
        let mut entries = Vec::new();
        for (site_id, r) in map.iter() {
            let r = r.lock().await;
            if r.child.is_some() {
                entries.push(json!({ "siteId": site_id, "pid": r.pid, "port": r.info.port, "command": r.info.command }));
            }
        }
        let _ = std::fs::write(self.pids_file.as_path(), serde_json::to_string(&entries).unwrap_or_default());
    }

    /// The site whose dev server leads process group `pgid`, if it is one of ours. Never call while
    /// holding an entry's lock (map lock first, then entries, like `persist`).
    async fn site_for_pgid(&self, pgid: u32) -> Option<String> {
        let map = self.map.lock().await;
        for (site_id, r) in map.iter() {
            let r = r.lock().await;
            if r.child.is_some() && r.pid == pgid { return Some(site_id.clone()); }
        }
        None
    }
}

/// Kill dev servers recorded by a previous app instance if they are still running.
fn reap_orphans(file: &std::path::Path) {
    let Ok(text) = std::fs::read_to_string(file) else { return };
    let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else { return };
    for e in entries {
        let (Some(pid), Some(port)) = (e["pid"].as_u64(), e["port"].as_u64()) else { continue };
        let Ok(out) = std::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output() else { continue };
        let cmdline = String::from_utf8_lossy(&out.stdout);
        if looks_like_ours(&cmdline, port as u16, e["command"].as_str().unwrap_or("")) {
            kill_group(pid as u32);
            unsafe { libc::kill(pid as i32, libc::SIGTERM); }
        }
    }
    let _ = std::fs::remove_file(file);
}

/// Only kill a recorded pid if it still looks like the dev server we started: the same port in its
/// arguments, and either a Node/dev-looking command line or the arguments of the command we ran
/// (`zsh -lc` execs a lone command, so `python3 -m http.server 4321` shows up as Python itself).
fn looks_like_ours(cmdline: &str, port: u16, command: &str) -> bool {
    if !cmdline.contains(&port.to_string()) { return false; }
    if cmdline.contains("dev") || cmdline.contains("node") { return true; }
    match command.split_once(' ') { Some((_, args)) => !args.trim().is_empty() && cmdline.contains(args.trim()), None => false }
}

/// A port is free only if nothing listens on it over IPv4 *or* IPv6: Vite-based servers bind
/// `localhost`, which macOS resolves to `::1`. Binding alone is not proof: a Node server on the
/// wildcard address (`::`, what Next binds) sets SO_REUSEADDR, and so does std, which on macOS lets
/// a loopback bind succeed next to it. So the port must also refuse connections.
fn port_free(p: u16) -> bool {
    if std::net::TcpListener::bind(("127.0.0.1", p)).is_err() { return false; }
    if let Err(e) = std::net::TcpListener::bind(("::1", p)) {
        if e.kind() == std::io::ErrorKind::AddrInUse { return false; }
    }
    !accepts(p)
}

/// True when something accepts a connection on the port over either loopback family (blocking, fast:
/// a closed loopback port refuses at once).
fn accepts(p: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addrs: [SocketAddr; 2] = [([127, 0, 0, 1], p).into(), (std::net::Ipv6Addr::LOCALHOST, p).into()];
    addrs.iter().any(|a| match TcpStream::connect_timeout(a, Duration::from_millis(300)) {
        // A connect to a listener-less port in the ephemeral range can succeed by connecting to itself
        // (TCP simultaneous open); that is not a server.
        Ok(s) => s.local_addr().ok() != s.peer_addr().ok(),
        Err(_) => false,
    })
}

fn free_port(preferred: Option<u16>, avoid: &[u16]) -> u16 {
    let ok = |p: u16| !avoid.contains(&p) && port_free(p);
    if let Some(p) = preferred {
        if ok(p) { return p; }
    }
    for p in [4321u16, 4322, 4323, 4324, 4325, 5173, 5174, 3000, 3001] {
        if ok(p) { return p; }
    }
    std::net::TcpListener::bind(("127.0.0.1", 0)).map(|l| l.local_addr().unwrap().port()).unwrap_or(4321)
}

/// True when something accepts connections on the port over either loopback family.
async fn port_open(port: u16) -> bool {
    for addr in [format!("127.0.0.1:{port}"), format!("[::1]:{port}")] {
        let ok = tokio::time::timeout(Duration::from_millis(500), tokio::net::TcpStream::connect(&addr)).await.map(|r| r.is_ok()).unwrap_or(false);
        if ok { return true; }
    }
    false
}

/// Extract the port from a line like "Local: http://localhost:4322/".
fn announced_port(line: &str) -> Option<u16> {
    for marker in ["localhost:", "127.0.0.1:", "[::1]:"] {
        if let Some(i) = line.find(marker) {
            let digits: String = line[i + marker.len()..].chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(p) = digits.parse::<u16>() { if p > 0 { return Some(p); } }
        }
    }
    None
}

/// The port a "taken" line complains about, or 0 when the line says a port is taken but not which.
/// Shapes seen: Node's `listen EADDRINUSE: address already in use :::4321`, Vite's
/// `Port 4321 is already in use` / `Port 4321 is in use, trying another one...`, Python's
/// `[Errno 48] Address already in use`.
fn conflict_port(line: &str) -> Option<u16> {
    let lower = line.to_ascii_lowercase();
    if !(lower.contains("eaddrinuse") || lower.contains("address already in use") || lower.contains("already in use") || lower.contains("is in use")) {
        return None;
    }
    if let Some(i) = lower.rfind(':') {
        let digits: String = lower[i + 1..].trim_start().chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(p) = digits.parse::<u16>() { if p > 0 { return Some(p); } }
    }
    if let Some(i) = lower.find("port ") {
        let digits: String = lower[i + 5..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(p) = digits.parse::<u16>() { if p > 0 { return Some(p); } }
    }
    Some(0)
}

/// A line said "taken" without naming the port: the one we asked for if something listens there,
/// else a port the command itself names that is busy, else the one we asked for.
fn resolve_conflict(asked: u16, command: &str) -> u16 {
    if accepts(asked) { return asked; }
    let named = command.split(|c: char| !c.is_ascii_digit()).filter_map(|d| d.parse::<u16>().ok()).find(|p| *p >= 1024 && *p != asked && accepts(*p));
    named.unwrap_or(asked)
}

/// Who listens on `port` right now (`lsof`, then `ps` for the command line and `lsof` again for the cwd).
async fn listener(port: u16) -> Option<Holder> {
    let out = tokio::process::Command::new("lsof").args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fpgc"]).output().await.ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (mut pid, mut pgid, mut name) = (None, None, None);
    for line in text.lines() {
        match line.chars().next() {
            Some('p') => { if pid.is_some() { break; } pid = line[1..].parse::<u32>().ok(); }
            Some('g') => pgid = line[1..].parse::<u32>().ok(),
            Some('c') => name = Some(line[1..].to_string()),
            _ => {}
        }
    }
    let (pid, pgid) = (pid?, pgid.unwrap_or(0));
    let command = tokio::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output().await.ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty());
    let cwd = tokio::process::Command::new("lsof").args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"]).output().await.ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).lines().find(|l| l.starts_with('n')).map(|l| l[1..].to_string()));
    let name = name.unwrap_or_else(|| "a process".into());
    Some(Holder { pid, pgid, command: command.unwrap_or_else(|| name.clone()), name, cwd, site_id: None })
}

fn describe(h: &Holder) -> String {
    match &h.cwd {
        Some(cwd) => format!("{} (pid {}) in {cwd}", h.name, h.pid),
        None => format!("{} (pid {})", h.name, h.pid),
    }
}

/// Everything `launch` needs, so a retry after a port conflict can run the same spawn again.
#[derive(Clone)]
struct Launch {
    app: AppHandle,
    shared: Shared,
    running: Arc<Mutex<Running>>,
    site: Site,
    template: String,
    path_env: String,
}

impl Registry {
    pub async fn start(&self, app: AppHandle, site: Site, path_env: String) -> Result<DevInfo, String> {
        let template = site.dev.clone().ok_or_else(|| {
            let mut m = "This folder has no dev command. Add a `dev` script to package.json or a `dev` entry in supasito.json.".to_string();
            if crate::sites::is_workspace_root(std::path::Path::new(&site.path)) { m.push_str(" This looks like a workspace root; open the app's own folder (for example apps/web)."); }
            m
        })?;
        // Claim the site's slot before spawning. Two starts for one site can arrive milliseconds apart (a
        // switch bouncing back and forth); the check and the insert happen under one map lock, so the
        // second finds the first's entry and returns it instead of spawning a server nobody can stop.
        // The placeholder's own lock is held until the child is recorded in it, so `status`, `stop` and
        // that second start wait for the real pid rather than seeing port 0. (The map lock is never taken
        // while holding an entry that is already in the map, so `persist` cannot deadlock with this.)
        let running = Arc::new(Mutex::new(Running {
            info: DevInfo { site_id: site.id.clone(), port: 0, url: String::new(), status: "starting".into(), command: template.clone(), problem: None },
            pid: 0, log: Vec::new(), child: None, announced_port: None, conflict_port: None, tried: Vec::new(), foreign: None, drained: Arc::new(AtomicBool::new(true)),
        }));
        let slot = loop {
            let stale = {
                let mut map = self.shared.map.lock().await;
                if let Some(existing) = map.get(&site.id).cloned() {
                    let r = existing.lock().await;
                    if r.info.status == "ready" || r.info.status == "starting" { return Ok(r.info.clone()); }
                    drop(r);
                    map.remove(&site.id)
                } else {
                    let slot = running.clone().lock_owned().await;
                    map.insert(site.id.clone(), running.clone());
                    break slot;
                }
            };
            // A server that died or timed out is replaced; kill it first so its port frees up.
            if let Some(stale) = stale { shut_down(&app, &stale, Duration::from_secs(3)).await; }
        };
        // SUPASITO_SMOKE_FORCE_PORT skips the free-port check, so the smoke harness can provoke a real conflict.
        let port = std::env::var("SUPASITO_SMOKE_FORCE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or_else(|| free_port(site.last_port, &[]));
        let l = Launch { app, shared: self.shared.clone(), running, site, template, path_env };
        launch(l, port, slot).await
    }

    pub async fn status(&self, site_id: &str) -> Option<DevInfo> {
        let map = self.shared.map.lock().await;
        let r = map.get(site_id)?;
        let r = r.lock().await;
        Some(r.info.clone())
    }

    pub async fn log(&self, site_id: &str) -> Vec<String> {
        let map = self.shared.map.lock().await;
        match map.get(site_id) {
            Some(r) => r.lock().await.log.clone(),
            None => vec![],
        }
    }

    pub async fn stop(&self, app: &AppHandle, site_id: &str) -> Result<(), String> {
        let running = self.shared.map.lock().await.remove(site_id);
        if let Some(running) = running { shut_down(app, &running, Duration::from_secs(3)).await; }
        self.shared.persist().await;
        Ok(())
    }

    pub async fn stop_all(&self) {
        let all: Vec<_> = self.shared.map.lock().await.drain().map(|(_, v)| v).collect();
        for running in all {
            let mut r = running.lock().await;
            kill_group(r.pid);
            if let Some(child) = r.child.as_mut() {
                let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            }
            r.child = None;
        }
        let _ = std::fs::remove_file(self.shared.pids_file.as_path());
    }

    /// Stop whatever holds the port that `site_id`'s last start failed on: another site's dev server
    /// through the registry, anything else by ending its dev-tool process chain. Returns what was done;
    /// the caller restarts the site afterwards.
    pub async fn free_blocked_port(&self, app: &AppHandle, site_id: &str) -> Result<String, String> {
        let entry = self.shared.map.lock().await.get(site_id).cloned();
        let (port, told) = match entry.as_ref() {
            Some(r) => match r.lock().await.info.problem.clone() { Some(DevProblem::Port { port, holder }) => (port, holder), None => return Err("Nothing is blocking this site's port.".into()) },
            None => return Err("Nothing is blocking this site's port.".into()),
        };
        let Some(mut now) = listener(port).await else { return Ok(format!("Port {port} is free now.")) };
        if told.as_ref().map(|h| h.pid) != Some(now.pid) {
            // Not the process the card named; report the new one instead of killing blind.
            now.site_id = self.shared.site_for_pgid(now.pgid).await;
            if let Some(r) = entry.as_ref() {
                let mut r = r.lock().await;
                r.info.problem = Some(DevProblem::Port { port, holder: Some(now.clone()) });
                let _ = app.emit("dev://status", &r.info);
            }
            return Err(format!("Port {port} is now held by {}. Look again.", describe(&now)));
        }
        if let Some(other) = self.shared.site_for_pgid(now.pgid).await {
            self.stop(app, &other).await?;
            return Ok(format!("Stopped the other site's dev server on port {port}."));
        }
        let chain = chain_to_kill(&process_table().await, now.pid);
        for pid in &chain { unsafe { libc::kill(*pid as i32, libc::SIGTERM); } }
        for _ in 0..10 {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if !port_open(port).await { return Ok(format!("Stopped {}.", describe(&now))); }
        }
        for pid in &chain { unsafe { libc::kill(*pid as i32, libc::SIGKILL); } }
        for _ in 0..5 {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if !port_open(port).await { return Ok(format!("Stopped {}.", describe(&now))); }
        }
        Err(format!("{} would not stop; port {port} is still taken.", describe(&now)))
    }
}

/// One process from `ps`.
#[derive(Debug, Clone, PartialEq)]
struct Proc { pid: u32, ppid: u32, pgid: u32, comm: String }

async fn process_table() -> Vec<Proc> {
    let Ok(out) = tokio::process::Command::new("ps").args(["-axo", "pid=,ppid=,pgid=,comm="]).output().await else { return vec![] };
    parse_process_table(&String::from_utf8_lossy(&out.stdout))
}

fn parse_process_table(text: &str) -> Vec<Proc> {
    text.lines().filter_map(|l| {
        let mut it = l.split_whitespace();
        let pid = it.next()?.parse().ok()?;
        let ppid = it.next()?.parse().ok()?;
        let pgid = it.next()?.parse().ok()?;
        let comm = it.collect::<Vec<_>>().join(" ");
        Some(Proc { pid, ppid, pgid, comm })
    }).collect()
}

/// The listener plus the parents that would just respawn it (`next dev` restarts its `next-server`,
/// `pnpm dev` reports the failure and exits), walking up while they share the listener's process group
/// and are not a shell: an interactive shell that started the server with job control off would be in
/// that group too, and it must survive. Deepest first, so the listener dies before its parent notices.
fn chain_to_kill(table: &[Proc], pid: u32) -> Vec<u32> {
    let by_pid: HashMap<u32, &Proc> = table.iter().map(|p| (p.pid, p)).collect();
    let Some(start) = by_pid.get(&pid) else { return vec![pid] };
    let is_shell = |comm: &str| {
        let base = comm.rsplit('/').next().unwrap_or(comm).trim_start_matches('-');
        matches!(base, "sh" | "bash" | "zsh" | "fish" | "dash" | "ksh" | "tcsh" | "csh" | "login")
    };
    let mut chain = vec![pid];
    let mut cur = *start;
    let me = std::process::id();
    while let Some(parent) = by_pid.get(&cur.ppid) {
        if parent.pid <= 1 || parent.pid == me || parent.pgid != start.pgid || is_shell(&parent.comm) || chain.contains(&parent.pid) { break; }
        chain.push(parent.pid);
        cur = *parent;
    }
    chain
}

/// Spawn the dev command on `port` into the claimed entry and watch it. Boxed because the watcher calls
/// it again when the port turns out to be taken.
fn launch(l: Launch, port: u16, mut slot: OwnedMutexGuard<Running>) -> Pin<Box<dyn Future<Output = Result<DevInfo, String>> + Send>> {
    Box::pin(async move {
        let site = &l.site;
        let command = l.template.replace("{port}", &port.to_string());
        let url = format!("http://localhost:{port}");
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = tokio::process::Command::new(&shell);
        cmd.args(["-lc", &command])
            .current_dir(&site.path)
            .env("PATH", &l.path_env)
            .env("PORT", port.to_string())
            .env("BROWSER", "none")
            .env("FORCE_COLOR", "0")
            .env("NO_COLOR", "1")
            .env_remove("CLAUDECODE")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        cmd.process_group(0);
        let spawned = cmd.spawn().map_err(|e| format!("could not start dev server: {e}")).and_then(|c| match c.id() { Some(pid) => Ok((c, pid)), None => Err("dev server has no pid".into()) });
        let (mut child, pid) = match spawned {
            Ok(v) => v,
            Err(e) => {
                // Give the slot back: nothing is running, and the reply below is what the UI shows.
                slot.info.status = "error".into();
                slot.log.push(e.clone());
                let _ = l.app.emit("dev://status", &slot.info);
                drop(slot);
                let mut map = l.shared.map.lock().await;
                if map.get(&site.id).map(|r| Arc::ptr_eq(r, &l.running)).unwrap_or(false) { map.remove(&site.id); }
                return Err(e);
            }
        };
        let info = DevInfo { site_id: site.id.clone(), port, url: url.clone(), status: "starting".into(), command: command.clone(), problem: None };
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        slot.info = info.clone();
        slot.pid = pid;
        slot.child = Some(child);
        slot.announced_port = None;
        slot.conflict_port = None;
        slot.foreign = None;
        slot.tried.push(port);
        let drained = Arc::new(AtomicBool::new(false));
        slot.drained = drained.clone();
        let _ = l.app.emit("dev://status", &info);
        drop(slot);

        // log pumps
        {
            let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
            pump_lines(stdout, tx.clone());
            pump_lines(stderr, tx);
            let running = l.running.clone();
            let app = l.app.clone();
            let site_id = site.id.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(line) = rx.recv().await {
                    let clean = strip_ansi(&line);
                    let mut moved: Option<DevInfo> = None;
                    {
                        let mut r = running.lock().await;
                        if r.pid != pid { break; } // a retry replaced this server; its lines belong to the old one
                        r.log.push(clean.clone());
                        if r.log.len() > 500 { r.log.drain(0..100); }
                        if r.announced_port.is_none() {
                            if let Some(p) = announced_port(&clean) {
                                r.announced_port = Some(p);
                                if p != r.info.port {
                                    r.info.port = p;
                                    r.info.url = format!("http://localhost:{p}");
                                    moved = Some(r.info.clone());
                                }
                            }
                        }
                        if r.conflict_port.is_none() { r.conflict_port = conflict_port(&clean); }
                    }
                    let _ = app.emit("dev://log", json!({ "siteId": site_id, "line": clean }));
                    if let Some(info) = moved { let _ = app.emit("dev://status", &info); }
                }
                drained.store(true, Ordering::SeqCst);
            });
        }

        // readiness probe, then exit watch
        {
            let l = l.clone();
            tauri::async_runtime::spawn(async move { watch(l, pid).await });
        }
        l.shared.persist().await;
        Ok(info)
    })
}

/// Wait for the server with pid `pid` to answer (or announce its port), then keep watching for its exit.
async fn watch(l: Launch, pid: u32) {
    let running = l.running.clone();
    let app = l.app.clone();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    loop {
        if tokio::time::Instant::now() > deadline {
            let mut r = running.lock().await;
            if r.pid == pid && r.info.status == "starting" {
                let port = r.info.port;
                r.info.status = "error".into();
                let line = match &r.foreign {
                    Some(h) => format!("Supasito waited 90s; port {port} answers, but it is {} rather than this site's server, which never printed its address.", describe(h)),
                    None => format!("Supasito waited 90s but nothing answered on port {port}. Is this the right dev command?"),
                };
                r.log.push(line);
                let _ = app.emit("dev://status", &r.info);
            }
            break;
        }
        // exited or stopped?
        {
            let mut r = running.lock().await;
            if r.pid != pid || r.child.is_none() { return; }
            if let Some(child) = r.child.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    drop(r);
                    exited(&l, pid, status).await;
                    return;
                }
            }
        }
        let (current_port, announced, foreign, ours) = { let r = running.lock().await; (r.info.port, r.announced_port.is_some(), r.foreign.is_some(), r.pid) };
        if announced {
            let mut r = running.lock().await;
            if r.pid != pid || r.child.is_none() { return; }
            r.info.status = "ready".into();
            let _ = app.emit("dev://status", &r.info);
            break;
        }
        if !foreign && port_open(current_port).await {
            // Only our own server counts: it leads the process group we spawned it in.
            let holder = listener(current_port).await;
            let mut r = running.lock().await;
            if r.pid != pid || r.child.is_none() { return; }
            match holder {
                Some(h) if h.pgid != ours => {
                    r.log.push(format!("Port {current_port} answers, but it is {}; waiting for this site's own server.", describe(&h)));
                    r.foreign = Some(h);
                }
                _ => {
                    r.info.status = "ready".into();
                    let _ = app.emit("dev://status", &r.info);
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    // keep watching for exit
    loop {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        let mut r = running.lock().await;
        if r.pid != pid { return; }
        match r.child.as_mut() {
            Some(child) => {
                if let Ok(Some(status)) = child.try_wait() {
                    drop(r);
                    exited(&l, pid, status).await;
                    return;
                }
            }
            None => return,
        }
    }
}

/// The server with pid `pid` is gone. A conflict on the port we chose gets a retry on another port; a
/// conflict on a port the command chose itself becomes an error that names the holder; anything else
/// is the plain stopped/error of before.
async fn exited(l: &Launch, pid: u32, status: std::process::ExitStatus) {
    let running = &l.running;
    // Let the pumps deliver the last lines before judging the exit (the pipes close with the process).
    let drained = { let r = running.lock().await; if r.pid != pid { return; } r.drained.clone() };
    for _ in 0..20 {
        if drained.load(Ordering::SeqCst) { break; }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let (conflict, asked, tried, was_ready, command) = {
        let mut r = running.lock().await;
        if r.pid != pid { return; }
        r.child = None;
        r.log.push(format!("dev server exited with {status}"));
        (r.conflict_port.filter(|_| r.info.status != "ready"), r.info.port, r.tried.clone(), r.info.status == "ready", r.info.command.clone())
    };
    let conflict = conflict.map(|p| if p == 0 { resolve_conflict(asked, &command) } else { p });
    let Some(port) = conflict else {
        let mut r = running.lock().await;
        if r.pid != pid { return; }
        r.info.status = if was_ready { "stopped".into() } else { "error".into() };
        let _ = l.app.emit("dev://status", &r.info);
        return;
    };
    let mut holder = listener(port).await;
    if let Some(h) = holder.as_mut() { h.site_id = l.shared.site_for_pgid(h.pgid).await; }
    let by = holder.as_ref().map(|h| format!(" by {}", describe(h))).unwrap_or_default();
    // The server took the port we gave it, so another one will do: retry, twice at most. A conflict on
    // some other port means the command picks its own and only freeing that port helps.
    if port == asked && tried.len() < 3 {
        let next = free_port(None, &tried);
        let slot = running.clone().lock_owned().await;
        if slot.pid != pid || slot.info.status != "starting" { return; } // stopped meanwhile
        {
            let mut slot = slot;
            slot.log.push(format!("Port {port} is taken{by}; trying {next}."));
            let _ = l.app.emit("dev://log", json!({ "siteId": l.site.id, "line": format!("Port {port} is taken{by}; trying {next}.") }));
            let _ = launch(l.clone(), next, slot).await;
        }
        return;
    }
    let mut r = running.lock().await;
    if r.pid != pid || r.info.status != "starting" { return; }
    r.info.status = "error".into();
    r.log.push(format!("Port {port} is taken{by}, and this dev command uses that port."));
    r.info.problem = Some(DevProblem::Port { port, holder });
    let _ = l.app.emit("dev://status", &r.info);
}

/// Kill a server that has already left the map, wait for it to go, and report it stopped. Taking the
/// entry's lock waits for a start that is still spawning it, so a stop that overtakes a start still
/// ends with that process dead.
async fn shut_down(app: &AppHandle, running: &Arc<Mutex<Running>>, wait: Duration) {
    let mut r = running.lock().await;
    if r.pid == 0 { return; } // the start failed before spawning; its error reply is the report
    kill_group(r.pid);
    if let Some(child) = r.child.as_mut() {
        let _ = tokio::time::timeout(wait, child.wait()).await;
    }
    r.child = None;
    r.info.status = "stopped".into();
    let _ = app.emit("dev://status", &r.info);
}

fn kill_group(pid: u32) {
    if pid == 0 { return; } // kill(-0) would signal our own process group
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
}

pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if n.is_ascii_alphabetic() { break; }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_the_port_the_server_prints() {
        assert_eq!(announced_port("┃ Local    http://localhost:4322/"), Some(4322));
        assert_eq!(announced_port("- Local:         http://localhost:3000"), Some(3000));
        assert_eq!(announced_port("10:42:38 watching for file changes..."), None);
        assert_eq!(strip_ansi("\u{1b}[32mready\u{1b}[0m"), "ready");
    }

    #[test]
    fn reaps_only_what_still_looks_like_our_server() {
        assert!(looks_like_ours("node /x/node_modules/.bin/next dev -p 4321", 4321, "node_modules/.bin/next dev -p 4321"));
        assert!(looks_like_ours("/opt/homebrew/…/Python -m http.server 4321", 4321, "python3 -m http.server 4321"));
        assert!(!looks_like_ours("/opt/homebrew/…/Python -m http.server 4321", 4322, "python3 -m http.server 4322"));
        assert!(!looks_like_ours("/Applications/Safari.app/Contents/MacOS/Safari 4321", 4321, "python3 -m http.server 4321")); // pid reused
    }

    #[test]
    fn reads_the_port_a_taken_line_names() {
        assert_eq!(conflict_port("Error: listen EADDRINUSE: address already in use :::4321"), Some(4321));
        assert_eq!(conflict_port("Error: listen EADDRINUSE: address already in use 0.0.0.0:3000"), Some(3000));
        assert_eq!(conflict_port("    at <unknown> (Error: listen EADDRINUSE: address already in use ::1:4322)"), Some(4322));
        assert_eq!(conflict_port("error when starting dev server:"), None);
        assert_eq!(conflict_port("Error: Port 5173 is already in use"), Some(5173));
        assert_eq!(conflict_port("Port 4321 is in use, trying another one..."), Some(4321));
        assert_eq!(conflict_port("OSError: [Errno 48] Address already in use"), Some(0));
        assert_eq!(conflict_port("✓ Ready in 392ms"), None);
        assert_eq!(conflict_port("- Local: http://localhost:4321"), None);
    }

    /// An unnamed conflict is pinned to whichever port is actually busy: ours, or one the command spells out.
    #[test]
    fn unnamed_conflict_is_pinned_to_the_busy_port() {
        let l = std::net::TcpListener::bind("[::]:0").unwrap();
        let busy = l.local_addr().unwrap().port();
        let idle = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        // that listener is dropped at once, and macOS tears it down a few milliseconds later
        assert!((0..40).any(|_| !accepts(idle) || { std::thread::sleep(Duration::from_millis(25)); false }));
        assert_eq!(resolve_conflict(busy, "python3 -m http.server 1"), busy);
        assert_eq!(resolve_conflict(idle, &format!("python3 -m http.server {busy}")), busy);
        assert_eq!(resolve_conflict(idle, "python3 -m http.server 1"), idle);
    }

    /// A wildcard listener with SO_REUSEADDR (what Node does, and what std does here) must count as taken.
    #[test]
    fn a_wildcard_listener_makes_the_port_busy() {
        let l = std::net::TcpListener::bind("[::]:0").unwrap();
        let port = l.local_addr().unwrap().port();
        assert!(!port_free(port), "port {port} reported free next to a [::] listener");
        assert_ne!(free_port(Some(port), &[]), port);
        drop(l);
        // macOS tears a closed listener down a few milliseconds later; the app never re-checks a port that fast.
        let freed = (0..40).any(|_| port_free(port) || { std::thread::sleep(Duration::from_millis(25)); false });
        assert!(freed, "free again once the listener is gone");
        assert_ne!(free_port(Some(port), &[port]), port, "avoid list is honoured");
    }

    #[test]
    fn kill_chain_stops_at_shells_and_other_groups() {
        let table = parse_process_table("\
   1     0     1 /sbin/launchd
 500   400   500 -zsh
 600   500   600 pnpm
 601   600   600 node
 602   601   600 next-server (v16.3.3)
 700   500   700 zsh
 701   700   700 node
 800   500   500 node
");
        assert_eq!(chain_to_kill(&table, 602), vec![602, 601, 600]); // terminal: pnpm dev, pnpm leads the job
        assert_eq!(chain_to_kill(&table, 701), vec![701]); // zsh -lc wrapper (a Supasito orphan) survives its child
        assert_eq!(chain_to_kill(&table, 800), vec![800]); // job control off: the interactive shell shares the group and must live
        assert_eq!(chain_to_kill(&table, 999), vec![999]); // unknown pid: still signal it
    }
}
