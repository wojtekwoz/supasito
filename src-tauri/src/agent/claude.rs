//! Drives the user's `claude` binary over the stream-json control protocol.
//! Verified against Claude Code 2.1.257: with `--permission-prompt-tool stdio` the CLI emits
//! `control_request{subtype:"can_use_tool"}` and blocks until a `control_response` arrives.

use std::{collections::HashMap, process::Stdio, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{mpsc, Mutex},
};

const ARGS: &[&str] = &[
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool", "stdio",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOpts {
    pub session_id: String,
    pub site_id: String,
    pub cwd: String,
    pub resume: bool,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub system_append: String,
    pub claude_path: String,
    pub path_env: String,
}

pub struct Handle {
    pub session_id: String,
    pub site_id: String,
    pid: u32,
    tx: Mutex<Option<mpsc::Sender<String>>>,
}

impl Handle {
    async fn write(&self, v: Value) -> Result<(), String> {
        let tx = self.tx.lock().await.clone().ok_or("session input is closed")?;
        let mut line = v.to_string();
        line.push('\n');
        tx.send(line).await.map_err(|_| "session input is closed".to_string())
    }

    pub async fn send_user(&self, content: Value) -> Result<(), String> {
        self.write(json!({
            "type": "user",
            "message": { "role": "user", "content": content },
            "parent_tool_use_id": Value::Null,
            "session_id": self.session_id,
        }))
        .await
    }

    pub async fn respond(&self, request_id: &str, response: Value) -> Result<(), String> {
        self.write(json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": request_id, "response": response }
        }))
        .await
    }

    pub async fn interrupt(&self) -> Result<(), String> {
        self.write(json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": { "subtype": "interrupt" }
        }))
        .await
    }

    async fn close_input(&self) {
        self.tx.lock().await.take();
    }

    fn signal(&self, sig: libc::c_int) {
        unsafe {
            libc::kill(self.pid as libc::pid_t, sig);
        }
    }
}

pub struct Registry {
    inner: Mutex<HashMap<String, Arc<Handle>>>,
    /// Pids of claude processes we started, so a later launch can stop any that outlived an app
    /// instance that died without cleaning up.
    pids_file: std::path::PathBuf,
}

/// Stop claude processes recorded by a previous app instance if they are still running.
fn reap_orphans(file: &std::path::Path) {
    let Ok(text) = std::fs::read_to_string(file) else { return };
    let Ok(entries) = serde_json::from_str::<Vec<Value>>(&text) else { return };
    for e in entries {
        let (Some(pid), Some(sid)) = (e["pid"].as_u64(), e["sessionId"].as_str()) else { continue };
        let Ok(out) = std::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output() else { continue };
        let cmdline = String::from_utf8_lossy(&out.stdout);
        if cmdline.contains("claude") && cmdline.contains(sid) {
            unsafe {
                libc::kill(pid as i32, libc::SIGINT);
            }
        }
    }
    let _ = std::fs::remove_file(file);
}

impl Registry {
    pub fn new(pids_file: std::path::PathBuf) -> Self {
        reap_orphans(&pids_file);
        Self { inner: Mutex::new(HashMap::new()), pids_file }
    }

    async fn persist(&self) {
        let map = self.inner.lock().await;
        let entries: Vec<Value> = map.values().map(|h| json!({ "sessionId": h.session_id, "pid": h.pid })).collect();
        let _ = std::fs::write(&self.pids_file, serde_json::to_string(&entries).unwrap_or_default());
    }

    pub async fn get(&self, session_id: &str) -> Option<Arc<Handle>> {
        self.inner.lock().await.get(session_id).cloned()
    }

    pub async fn running(&self) -> Vec<Value> {
        self.inner
            .lock()
            .await
            .values()
            .map(|h| json!({ "sessionId": h.session_id, "siteId": h.site_id }))
            .collect()
    }

    pub async fn start(&self, app: AppHandle, opts: StartOpts) -> Result<Arc<Handle>, String> {
        if let Some(existing) = self.get(&opts.session_id).await {
            return Ok(existing);
        }
        let mut cmd = Command::new(&opts.claude_path);
        cmd.current_dir(&opts.cwd)
            .env("PATH", &opts.path_env)
            .env("FORCE_COLOR", "0")
            .env("NO_COLOR", "1")
            .env("CLAUDE_CODE_ENTRYPOINT", "sdk-open")
            .env_remove("CLAUDECODE")
            .args(ARGS);
        if opts.resume {
            cmd.args(["--resume", &opts.session_id]);
        } else {
            cmd.args(["--session-id", &opts.session_id]);
        }
        if let Some(m) = opts.model.as_deref().filter(|m| !m.is_empty()) {
            cmd.args(["--model", m]);
        }
        let mode = opts.permission_mode.clone().filter(|m| !m.is_empty()).unwrap_or_else(|| "acceptEdits".into());
        cmd.args(["--permission-mode", &mode]);
        if !opts.system_append.is_empty() {
            cmd.args(["--append-system-prompt", &opts.system_append]);
        }
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(false);
        cmd.process_group(0);

        let mut child = cmd.spawn().map_err(|e| format!("could not start claude: {e}"))?;
        let pid = child.id().ok_or("claude has no pid")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        let (tx, rx) = mpsc::channel::<String>(256);
        let handle = Arc::new(Handle {
            session_id: opts.session_id.clone(),
            site_id: opts.site_id.clone(),
            pid,
            tx: Mutex::new(Some(tx)),
        });
        self.inner.lock().await.insert(opts.session_id.clone(), handle.clone());
        self.persist().await;

        tauri::async_runtime::spawn(writer(stdin, rx));

        // stderr → UI (diagnostics only)
        {
            let app = app.clone();
            let sid = opts.session_id.clone();
            let mut lines = BufReader::new(stderr).lines();
            tauri::async_runtime::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = app.emit("agent://stderr", json!({ "sessionId": sid, "line": line }));
                }
            });
        }

        // stdout → parse → events
        {
            let app = app.clone();
            let sid = opts.session_id.clone();
            let h = handle.clone();
            let mut lines = BufReader::new(stdout).lines();
            tauri::async_runtime::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();
                    if trimmed.is_empty() { continue; }
                    let v: Value = match serde_json::from_str(trimmed) {
                        Ok(v) => v,
                        Err(_) => {
                            let _ = app.emit("agent://stderr", json!({ "sessionId": sid, "line": trimmed }));
                            continue;
                        }
                    };
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("control_request") => {
                            let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("").to_string();
                            let subtype = v.pointer("/request/subtype").and_then(|s| s.as_str()).unwrap_or("");
                            if subtype == "can_use_tool" {
                                let _ = app.emit("agent://permission", json!({
                                    "sessionId": sid,
                                    "requestId": request_id,
                                    "request": v.get("request").cloned().unwrap_or(Value::Null),
                                }));
                            } else {
                                // Anything we don't implement must still be answered or the CLI blocks.
                                let _ = h.write(json!({
                                    "type": "control_response",
                                    "response": { "subtype": "error", "request_id": request_id, "error": format!("{subtype} is not supported by Open") }
                                })).await;
                            }
                        }
                        _ => {
                            let _ = app.emit("agent://message", json!({ "sessionId": sid, "message": v }));
                        }
                    }
                }
            });
        }

        // exit watcher
        {
            let app = app.clone();
            let sid = opts.session_id.clone();
            tauri::async_runtime::spawn(async move {
                let status = child.wait().await;
                let code = status.ok().and_then(|s| s.code());
                let state = app.state::<crate::state::AppState>();
                state.agents.inner.lock().await.remove(&sid);
                state.agents.persist().await;
                let _ = app.emit("agent://exit", json!({ "sessionId": sid, "code": code }));
            });
        }

        Ok(handle)
    }

    pub async fn stop(&self, session_id: &str) -> Result<(), String> {
        let h = self.inner.lock().await.get(session_id).cloned();
        if let Some(h) = h {
            h.close_input().await;
            tokio::time::sleep(Duration::from_millis(150)).await;
            h.signal(libc::SIGINT);
            let hh = h.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(5)).await;
                hh.signal(libc::SIGTERM);
            });
        }
        Ok(())
    }

    pub async fn stop_all(&self) {
        let all: Vec<Arc<Handle>> = self.inner.lock().await.values().cloned().collect();
        for h in &all {
            h.close_input().await;
            h.signal(libc::SIGINT);
        }
        if !all.is_empty() {
            tokio::time::sleep(Duration::from_millis(800)).await;
            for h in &all { h.signal(libc::SIGTERM); }
        }
        let _ = std::fs::remove_file(&self.pids_file);
    }
}

async fn writer(mut stdin: ChildStdin, mut rx: mpsc::Receiver<String>) {
    while let Some(line) = rx.recv().await {
        if stdin.write_all(line.as_bytes()).await.is_err() { break; }
        if stdin.flush().await.is_err() { break; }
    }
    let _ = stdin.shutdown().await;
}

/// Find the claude binary: configured path, then the login-shell PATH, then well-known spots.
pub async fn locate(configured: Option<&str>, path_env: &str) -> Option<String> {
    if let Some(p) = configured {
        if std::path::Path::new(p).is_file() { return Some(p.to_string()); }
    }
    for dir in path_env.split(':') {
        let p = std::path::Path::new(dir).join("claude");
        if p.is_file() { return Some(p.to_string_lossy().to_string()); }
    }
    if let Some(home) = dirs::home_dir() {
        for rel in [".claude/local/claude", ".local/bin/claude"] {
            let p = home.join(rel);
            if p.is_file() { return Some(p.to_string_lossy().to_string()); }
        }
    }
    None
}

pub async fn version(path: &str, path_env: &str) -> Option<String> {
    let out = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new(path).env("PATH", path_env).env_remove("CLAUDECODE").arg("--version").output(),
    )
    .await
    .ok()?
    .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Some(s.split_whitespace().next().unwrap_or(&s).to_string())
}
