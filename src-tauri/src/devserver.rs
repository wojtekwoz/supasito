use std::{collections::HashMap, process::Stdio, sync::Arc, time::Duration};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::{process::Child, sync::Mutex};

use crate::sites::Site;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DevInfo {
    pub site_id: String,
    pub port: u16,
    pub url: String,
    pub status: String, // starting | ready | error | stopped
    pub command: String,
}

struct Running {
    info: DevInfo,
    pid: u32,
    log: Vec<String>,
    child: Option<Child>,
    /// Port printed by the dev server itself ("Local: http://localhost:4322/"), which wins over
    /// the one we asked for when a framework silently picks the next free port.
    announced_port: Option<u16>,
}

pub struct Registry {
    inner: Mutex<HashMap<String, Arc<Mutex<Running>>>>,
    /// Records the pids of dev servers we started, so a later launch can kill any that outlived
    /// an app instance that died without cleaning up (e.g. `tauri dev` relaunching on rebuild).
    pids_file: std::path::PathBuf,
}

impl Registry {
    pub fn new(pids_file: std::path::PathBuf) -> Self {
        reap_orphans(&pids_file);
        Self { inner: Mutex::new(HashMap::new()), pids_file }
    }

    async fn persist(&self) {
        let map = self.inner.lock().await;
        let mut entries = Vec::new();
        for (site_id, r) in map.iter() {
            let r = r.lock().await;
            if r.child.is_some() {
                entries.push(json!({ "siteId": site_id, "pid": r.pid, "port": r.info.port, "command": r.info.command }));
            }
        }
        let _ = std::fs::write(&self.pids_file, serde_json::to_string(&entries).unwrap_or_default());
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
        // Only kill if it still looks like the dev server we started (same port in its arguments).
        if cmdline.contains(&port.to_string()) && (cmdline.contains("dev") || cmdline.contains("node")) {
            kill_group(pid as u32);
            unsafe { libc::kill(pid as i32, libc::SIGTERM); }
        }
    }
    let _ = std::fs::remove_file(file);
}

/// A port is free only if nothing listens on it over IPv4 *or* IPv6: Vite-based servers bind
/// `localhost`, which macOS resolves to `::1`.
fn port_free(p: u16) -> bool {
    if std::net::TcpListener::bind(("127.0.0.1", p)).is_err() { return false; }
    match std::net::TcpListener::bind(("::1", p)) {
        Ok(_) => true,
        Err(e) => e.kind() != std::io::ErrorKind::AddrInUse,
    }
}

fn free_port(preferred: Option<u16>) -> u16 {
    if let Some(p) = preferred {
        if port_free(p) { return p; }
    }
    for p in [4321u16, 4322, 4323, 4324, 4325, 5173, 5174, 3000, 3001] {
        if port_free(p) { return p; }
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

impl Registry {
    pub async fn start(&self, app: AppHandle, site: Site, path_env: String) -> Result<DevInfo, String> {
        if let Some(existing) = self.status(&site.id).await {
            if existing.status == "ready" || existing.status == "starting" { return Ok(existing); }
            self.stop(&app, &site.id).await.ok();
        }
        let template = site.dev.clone().ok_or_else(|| {
            let mut m = "This folder has no dev command. Add a `dev` script to package.json or a `dev` entry in supasito.json.".to_string();
            if crate::sites::is_workspace_root(std::path::Path::new(&site.path)) { m.push_str(" This looks like a workspace root; open the app's own folder (for example apps/web)."); }
            m
        })?;
        let port = free_port(site.last_port);
        let command = template.replace("{port}", &port.to_string());
        let url = format!("http://localhost:{port}");
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = tokio::process::Command::new(&shell);
        cmd.args(["-lc", &command])
            .current_dir(&site.path)
            .env("PATH", &path_env)
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
        let mut child = cmd.spawn().map_err(|e| format!("could not start dev server: {e}"))?;
        let pid = child.id().ok_or("dev server has no pid")?;
        let info = DevInfo { site_id: site.id.clone(), port, url: url.clone(), status: "starting".into(), command: command.clone() };
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let running = Arc::new(Mutex::new(Running { info: info.clone(), pid, log: Vec::new(), child: Some(child), announced_port: None }));
        self.inner.lock().await.insert(site.id.clone(), running.clone());
        let _ = app.emit("dev://status", &info);

        // log pumps
        {
            let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
            pump_lines(stdout, tx.clone());
            pump_lines(stderr, tx);
            let running = running.clone();
            let app = app.clone();
            let site_id = site.id.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(line) = rx.recv().await {
                    let clean = strip_ansi(&line);
                    let mut moved: Option<DevInfo> = None;
                    {
                        let mut r = running.lock().await;
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
                    }
                    let _ = app.emit("dev://log", json!({ "siteId": site_id, "line": clean }));
                    if let Some(info) = moved { let _ = app.emit("dev://status", &info); }
                }
            });
        }

        // readiness probe
        {
            let running = running.clone();
            let app = app.clone();
            let _ = port;
            tauri::async_runtime::spawn(async move {
                let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
                loop {
                    if tokio::time::Instant::now() > deadline {
                        let mut r = running.lock().await;
                        if r.info.status == "starting" {
                            let port = r.info.port;
                            r.info.status = "error".into();
                            r.log.push(format!("Supasito waited 90s but nothing answered on port {port}. Is this the right dev command?"));
                            let _ = app.emit("dev://status", &r.info);
                        }
                        break;
                    }
                    // exited or stopped?
                    {
                        let mut r = running.lock().await;
                        if r.child.is_none() { return; }
                        if let Some(child) = r.child.as_mut() {
                            if let Ok(Some(status)) = child.try_wait() {
                                r.info.status = "error".into();
                                r.log.push(format!("dev server exited with {status}"));
                                let _ = app.emit("dev://status", &r.info);
                                return;
                            }
                        }
                    }
                    let (current_port, announced) = { let r = running.lock().await; (r.info.port, r.announced_port.is_some()) };
                    if port_open(current_port).await || announced {
                        let mut r = running.lock().await;
                        r.info.status = "ready".into();
                        let _ = app.emit("dev://status", &r.info);
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                // keep watching for exit
                loop {
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                    let mut r = running.lock().await;
                    match r.child.as_mut() {
                        Some(child) => {
                            if let Ok(Some(status)) = child.try_wait() {
                                r.info.status = if r.info.status == "ready" { "stopped".into() } else { "error".into() };
                                r.log.push(format!("dev server exited with {status}"));
                                let _ = app.emit("dev://status", &r.info);
                                r.child = None;
                                return;
                            }
                        }
                        None => return,
                    }
                }
            });
        }
        self.persist().await;
        Ok(info)
    }

    pub async fn status(&self, site_id: &str) -> Option<DevInfo> {
        let map = self.inner.lock().await;
        let r = map.get(site_id)?;
        let r = r.lock().await;
        Some(r.info.clone())
    }

    pub async fn log(&self, site_id: &str) -> Vec<String> {
        let map = self.inner.lock().await;
        match map.get(site_id) {
            Some(r) => r.lock().await.log.clone(),
            None => vec![],
        }
    }

    pub async fn stop(&self, app: &AppHandle, site_id: &str) -> Result<(), String> {
        let running = self.inner.lock().await.remove(site_id);
        if let Some(running) = running {
            let mut r = running.lock().await;
            kill_group(r.pid);
            if let Some(child) = r.child.as_mut() {
                let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
            }
            r.child = None;
            r.info.status = "stopped".into();
            let _ = app.emit("dev://status", &r.info);
        }
        self.persist().await;
        Ok(())
    }

    pub async fn stop_all(&self) {
        let all: Vec<_> = self.inner.lock().await.drain().map(|(_, v)| v).collect();
        for running in all {
            let mut r = running.lock().await;
            kill_group(r.pid);
            if let Some(child) = r.child.as_mut() {
                let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            }
            r.child = None;
        }
        let _ = std::fs::remove_file(&self.pids_file);
    }
}

fn kill_group(pid: u32) {
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
}
