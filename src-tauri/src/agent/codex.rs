//! Drives the user's `codex` binary as an app-server: JSON-RPC 2.0, one message per line over stdio.
//! Verified against codex-cli 0.149.0 (2026-09-10, see CODEX.md §3 and scripts/codex-probe.mjs):
//! `initialize` → `initialized` → `thread/start` | `thread/resume` → `turn/start` per message. Approvals
//! arrive as server→client requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`)
//! and block the turn until answered; so does every other server request, which is why anything this file
//! does not implement is answered with a JSON-RPC error rather than left hanging.
//!
//! One app-server per site hosts every Codex thread of that site. Thread ids are Codex's own (it mints them);
//! the rest of the app sees them as `codex:<thread id>` so every string-keyed map works unchanged.
//! `codex` on PATH may be npm's Node wrapper, which spawns the real binary as a child: the process group
//! is what gets signalled, never just the pid.

use std::{collections::HashMap, process::Stdio, sync::{atomic::{AtomicU64, Ordering}, Arc}, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{mpsc, oneshot, Mutex},
};

/// Session ids of Codex threads carry this prefix everywhere outside this file.
pub const PREFIX: &str = "codex:";

pub fn is_codex_session(session_id: &str) -> bool {
    session_id.starts_with(PREFIX)
}

pub fn thread_id(session_id: &str) -> &str {
    session_id.strip_prefix(PREFIX).unwrap_or(session_id)
}

/// The model picker is the backend picker: OpenAI model ids start a Codex thread, everything else a claude process.
pub fn is_codex_model(model: &str) -> bool {
    let m = model.trim().to_ascii_lowercase();
    m.starts_with("gpt-") || m.starts_with("o3") || m.starts_with("o4") || m.contains("codex")
}

/// Codex's approval policy and sandbox for each of Supasito's permission modes (Claude Code's names).
/// `plan` has no equivalent; read-only is the honest fallback since it cannot change the site.
pub fn policy_for_mode(mode: &str) -> (&'static str, Value) {
    match mode {
        "default" => ("untrusted", json!({ "type": "workspaceWrite" })),
        "bypassPermissions" => ("never", json!({ "type": "dangerFullAccess" })),
        "plan" => ("untrusted", json!({ "type": "readOnly" })),
        _ => ("on-request", json!({ "type": "workspaceWrite" })),
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOpts {
    /// The thread to resume (without the prefix); None starts a new one.
    pub resume: Option<String>,
    pub site_id: String,
    pub cwd: String,
    pub model: String,
    pub effort: Option<String>,
    pub fast_mode: bool,
    pub permission_mode: Option<String>,
    pub developer_instructions: String,
    pub codex_path: String,
    pub path_env: String,
}

/// What the next `turn/start` sends; the UI changes these between turns (model, effort, fast, mode).
#[derive(Clone, Default)]
struct TurnOpts {
    model: String,
    effort: Option<String>,
    fast_mode: bool,
    mode: String,
}

pub struct Thread {
    pub session_id: String,
    pub thread_id: String,
    pub site_id: String,
    server: Arc<Server>,
    turn_id: Mutex<Option<String>>,
    opts: Mutex<TurnOpts>,
}

struct Server {
    site_id: String,
    pid: u32,
    tx: Mutex<Option<mpsc::Sender<String>>>,
    next_id: AtomicU64,
    /// Our own requests waiting for their response, by JSON-RPC id.
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    /// Approval requests the UI has not answered yet: JSON-RPC id → thread id.
    approvals: Mutex<HashMap<u64, String>>,
    /// `fileChange` items by id, kept because the approval request for one carries no diff (verified 0.149.0).
    file_changes: Mutex<HashMap<String, Value>>,
    threads: Mutex<HashMap<String, Arc<Thread>>>,
}

impl Server {
    async fn write(&self, v: Value) -> Result<(), String> {
        debug_log(&format!("→ {}", v.to_string().chars().take(160).collect::<String>()));
        let tx = self.tx.lock().await.clone().ok_or("codex input is closed")?;
        let mut line = v.to_string();
        line.push('\n');
        tx.send(line).await.map_err(|_| "codex input is closed".to_string())
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(json!({ "jsonrpc": "2.0", "method": method, "params": params })).await
    }

    /// Send a request and wait for its response (or the app-server's error).
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        self.write(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await?;
        match tokio::time::timeout(Duration::from_secs(120), rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("codex closed before answering".into()),
            Err(_) => { self.pending.lock().await.remove(&id); Err(format!("codex did not answer {method} in time")) }
        }
    }

    async fn reply(&self, id: u64, result: Value) {
        let _ = self.write(json!({ "jsonrpc": "2.0", "id": id, "result": result })).await;
    }

    async fn reply_error(&self, id: u64, message: String) {
        let _ = self.write(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": message } })).await;
    }

    async fn session_for(&self, thread_id: &str) -> Option<String> {
        self.threads.lock().await.get(thread_id).map(|t| t.session_id.clone())
    }

    async fn close_input(&self) {
        self.tx.lock().await.take();
    }

    fn signal_group(&self, sig: libc::c_int) {
        unsafe {
            libc::kill(-(self.pid as libc::pid_t), sig);
            libc::kill(self.pid as libc::pid_t, sig);
        }
    }
}

impl Thread {
    /// The user's turn. `content` is the Claude-shaped block array `compose_user_content` builds (text, selection
    /// text, base64 images) so lib.rs needs no branch; it becomes Codex's `UserInput` list here.
    pub async fn send_user(&self, content: Value) -> Result<(), String> {
        let input = user_input(&content);
        let active = self.turn_id.lock().await.clone();
        if let Some(turn) = active {
            // Mid-turn: steer the running turn. Its id is a precondition, so a turn that just ended fails
            // here and the message starts the next one instead.
            let steered = self.server.request("turn/steer", json!({ "threadId": self.thread_id, "expectedTurnId": turn, "input": input })).await;
            if steered.is_ok() { return Ok(()); }
        }
        let o = self.opts.lock().await.clone();
        let (approval, sandbox) = policy_for_mode(&o.mode);
        let mut params = json!({
            "threadId": self.thread_id,
            "input": input,
            "model": o.model,
            "summary": "auto",
            "approvalPolicy": approval,
            "sandboxPolicy": sandbox,
        });
        if let Some(e) = o.effort.as_deref().filter(|e| !e.is_empty()) { params["effort"] = json!(e); }
        if o.fast_mode { params["serviceTier"] = json!("priority"); }
        let r = self.server.request("turn/start", params).await?;
        if let Some(id) = r.pointer("/turn/id").and_then(|v| v.as_str()) {
            *self.turn_id.lock().await = Some(id.to_string());
        }
        Ok(())
    }

    /// Answer an approval card. `response` is Claude-shaped (`behavior: allow|deny`, `updatedPermissions`, `message`)
    /// because that is what the card sends; it maps onto Codex's four decisions. A deny reason has no field of
    /// its own, so it follows as a steer — the same thing Claude's `message` does.
    pub async fn respond(&self, request_id: &str, response: Value) -> Result<(), String> {
        let id: u64 = request_id.parse().map_err(|_| format!("not a codex request id: {request_id}"))?;
        self.server.approvals.lock().await.remove(&id);
        let allow = response.get("behavior").and_then(|b| b.as_str()) == Some("allow");
        let remember = response.get("updatedPermissions").map(|p| !p.is_null()).unwrap_or(false);
        let decision = if allow && remember { "acceptForSession" } else if allow { "accept" } else { "decline" };
        self.server.reply(id, json!({ "decision": decision })).await;
        if !allow {
            let reason = response.get("message").and_then(|m| m.as_str()).unwrap_or("").trim();
            if !reason.is_empty() && reason != "The user declined this action." {
                if let Some(turn) = self.turn_id.lock().await.clone() {
                    let _ = self.server.request("turn/steer", json!({ "threadId": self.thread_id, "expectedTurnId": turn, "input": [{ "type": "text", "text": format!("The user declined that action: {reason}") }] })).await;
                }
            }
        }
        Ok(())
    }

    pub async fn interrupt(&self) -> Result<(), String> {
        let Some(turn) = self.turn_id.lock().await.clone() else { return Ok(()) };
        self.server.request("turn/interrupt", json!({ "threadId": self.thread_id, "turnId": turn })).await.map(|_| ())
    }

    /// Takes effect on the next turn (approval policy and sandbox are per-turn parameters).
    pub async fn set_permission_mode(&self, mode: &str) -> Result<(), String> {
        self.opts.lock().await.mode = mode.to_string();
        Ok(())
    }

    pub async fn set_model(&self, model: &str) -> Result<String, String> {
        self.opts.lock().await.model = model.to_string();
        Ok(String::new())
    }

    /// The same keys Claude's `apply_flag_settings` takes (`fastMode`, `effortLevel`), applied to the next turn.
    pub async fn apply_settings(&self, settings: Value) -> Result<String, String> {
        let mut o = self.opts.lock().await;
        if let Some(f) = settings.get("fastMode").and_then(|v| v.as_bool()) { o.fast_mode = f; }
        if let Some(e) = settings.get("effortLevel") { o.effort = e.as_str().map(String::from).filter(|s| !s.is_empty()); }
        Ok(String::new())
    }

    /// Decline whatever the UI has not answered, so a stopped thread is not saved mid-approval.
    async fn decline_pending(&self) {
        let ids: Vec<u64> = self.server.approvals.lock().await.iter().filter(|(_, t)| **t == self.thread_id).map(|(id, _)| *id).collect();
        for id in ids {
            self.server.approvals.lock().await.remove(&id);
            self.server.reply(id, json!({ "decision": "decline" })).await;
        }
    }
}

/// Claude-shaped content blocks → Codex `UserInput`s. Images travel as data URLs (unverified on 0.149.0: the
/// schema accepts any `url`; `localImage{path}` is the fallback if it turns out to want a file).
fn user_input(content: &Value) -> Value {
    let mut out = Vec::new();
    if let Some(blocks) = content.as_array() {
        for b in blocks {
            match b.get("type").and_then(|t| t.as_str()) {
                Some("text") => out.push(json!({ "type": "text", "text": b.get("text").and_then(|t| t.as_str()).unwrap_or("") })),
                Some("image") => {
                    let media = b.pointer("/source/media_type").and_then(|m| m.as_str()).unwrap_or("image/png");
                    let data = b.pointer("/source/data").and_then(|d| d.as_str()).unwrap_or("");
                    out.push(json!({ "type": "image", "url": format!("data:{media};base64,{data}") }));
                }
                _ => {}
            }
        }
    } else if let Some(s) = content.as_str() {
        out.push(json!({ "type": "text", "text": s }));
    }
    Value::Array(out)
}

/// The Claude-shaped `can_use_tool` request the approval card renders, built from a Codex approval request.
fn shim_permission(method: &str, params: &Value, file_change: Option<&Value>) -> Value {
    let item_id = params.get("itemId").cloned().unwrap_or(Value::Null);
    if method == "item/commandExecution/requestApproval" {
        return json!({
            "subtype": "can_use_tool",
            "tool_name": "Bash",
            "input": { "command": params.get("command").cloned().unwrap_or(Value::Null), "cwd": params.get("cwd").cloned().unwrap_or(Value::Null), "itemId": item_id },
            "description": params.get("reason").cloned().unwrap_or(Value::Null),
        });
    }
    let changes: Vec<Value> = file_change.and_then(|fc| fc.get("changes")).and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let paths: Vec<Value> = changes.iter().filter_map(|c| c.get("path").cloned()).collect();
    let all_new = !changes.is_empty() && changes.iter().all(|c| c.pointer("/kind/type").and_then(|t| t.as_str()) == Some("add"));
    let diff = changes.iter().filter_map(|c| c.get("diff").and_then(|d| d.as_str())).collect::<Vec<_>>().join("\n");
    json!({
        "subtype": "can_use_tool",
        "tool_name": if all_new { "Write" } else { "Edit" },
        "input": { "file_path": paths.first().cloned().unwrap_or(Value::Null), "files": paths, "diff": diff, "itemId": item_id },
        "description": params.get("reason").cloned().unwrap_or(Value::Null),
    })
}

pub struct Registry {
    servers: Arc<Mutex<HashMap<String, Arc<Server>>>>,
    threads: Arc<Mutex<HashMap<String, Arc<Thread>>>>,
    /// Pids of app-servers we started, so a later launch can stop any that outlived an app instance.
    pids_file: std::path::PathBuf,
}

/// Stop app-servers recorded by a previous app instance if they are still ours (the argv marker says so;
/// the ChatGPT desktop app runs app-servers of its own that must not be touched).
fn reap_orphans(file: &std::path::Path) {
    let Ok(text) = std::fs::read_to_string(file) else { return };
    let Ok(entries) = serde_json::from_str::<Vec<Value>>(&text) else { return };
    for e in entries {
        let (Some(pid), Some(site)) = (e["pid"].as_u64(), e["siteId"].as_str()) else { continue };
        let Ok(out) = std::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output() else { continue };
        let cmdline = String::from_utf8_lossy(&out.stdout);
        if cmdline.contains("app-server") && cmdline.contains(&format!("supasito.site=\"{site}\"")) {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
    }
    let _ = std::fs::remove_file(file);
}

impl Registry {
    pub fn new(pids_file: std::path::PathBuf) -> Self {
        reap_orphans(&pids_file);
        Self { servers: Arc::new(Mutex::new(HashMap::new())), threads: Arc::new(Mutex::new(HashMap::new())), pids_file }
    }

    async fn persist(&self) {
        let map = self.servers.lock().await;
        let entries: Vec<Value> = map.values().map(|s| json!({ "siteId": s.site_id, "pid": s.pid })).collect();
        let _ = std::fs::write(&self.pids_file, serde_json::to_string(&entries).unwrap_or_default());
    }

    pub async fn get(&self, session_id: &str) -> Option<Arc<Thread>> {
        self.threads.lock().await.get(session_id).cloned()
    }

    pub async fn running(&self) -> Vec<Value> {
        self.threads.lock().await.values().map(|t| json!({ "sessionId": t.session_id, "siteId": t.site_id })).collect()
    }

    /// Start (or resume) a thread on the site's app-server, spawning the server first if the site has none.
    /// Returns the prefixed session id.
    pub async fn start(&self, app: AppHandle, opts: StartOpts) -> Result<String, String> {
        if let Some(id) = opts.resume.as_deref() {
            if let Some(existing) = self.get(&format!("{PREFIX}{id}")).await { return Ok(existing.session_id.clone()); }
        }
        // The guard must not live across the spawn (a match scrutinee's temporary would): bind it first.
        let existing = self.servers.lock().await.get(&opts.site_id).cloned();
        let server = match existing {
            Some(s) => s,
            None => {
                let s = self.spawn(app.clone(), &opts).await?;
                self.servers.lock().await.insert(opts.site_id.clone(), s.clone());
                self.persist().await;
                s
            }
        };
        debug_log(&format!("app-server ready for site {}", opts.site_id));
        let (approval, sandbox_mode) = match opts.permission_mode.as_deref().unwrap_or("acceptEdits") {
            "default" | "plan" => ("untrusted", if opts.permission_mode.as_deref() == Some("plan") { "read-only" } else { "workspace-write" }),
            "bypassPermissions" => ("never", "danger-full-access"),
            _ => ("on-request", "workspace-write"),
        };
        let mut params = json!({
            "cwd": opts.cwd,
            "model": opts.model,
            "approvalPolicy": approval,
            "sandbox": sandbox_mode,
            "developerInstructions": opts.developer_instructions,
        });
        let method = match &opts.resume {
            Some(id) => { params["threadId"] = json!(id); "thread/resume" }
            None => "thread/start",
        };
        debug_log(&format!("{method} …"));
        let r = server.request(method, params).await?;
        debug_log(&format!("{method} answered"));
        let tid = r.pointer("/thread/id").and_then(|v| v.as_str()).ok_or("codex answered thread/start without a thread id")?.to_string();
        let mode = opts.permission_mode.clone().filter(|m| !m.is_empty()).unwrap_or_else(|| "acceptEdits".into());
        let thread = Arc::new(Thread {
            session_id: format!("{PREFIX}{tid}"),
            thread_id: tid.clone(),
            site_id: opts.site_id.clone(),
            server: server.clone(),
            turn_id: Mutex::new(None),
            opts: Mutex::new(TurnOpts { model: opts.model.clone(), effort: opts.effort.clone(), fast_mode: opts.fast_mode, mode: mode.clone() }),
        });
        server.threads.lock().await.insert(tid.clone(), thread.clone());
        self.threads.lock().await.insert(thread.session_id.clone(), thread.clone());
        // The Thread object carries neither model nor mode (verified 0.149.0); tell the transcript what was asked for.
        let _ = app.emit("agent://message", json!({ "sessionId": thread.session_id, "message": { "method": "supasito/session", "params": { "threadId": tid, "model": opts.model, "mode": mode } } }));
        Ok(thread.session_id.clone())
    }

    async fn spawn(&self, app: AppHandle, opts: &StartOpts) -> Result<Arc<Server>, String> {
        let mut cmd = Command::new(&opts.codex_path);
        cmd.current_dir(&opts.cwd)
            .env("PATH", &opts.path_env)
            .env("NO_COLOR", "1")
            .args(["-c", &format!("supasito.site=\"{}\"", opts.site_id), "app-server"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(false);
        cmd.process_group(0);
        let mut child = cmd.spawn().map_err(|e| format!("could not start codex: {e}"))?;
        let pid = child.id().ok_or("codex has no pid")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let (tx, rx) = mpsc::channel::<String>(256);
        let server = Arc::new(Server {
            site_id: opts.site_id.clone(),
            pid,
            tx: Mutex::new(Some(tx)),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            file_changes: Mutex::new(HashMap::new()),
            threads: Mutex::new(HashMap::new()),
        });
        tauri::async_runtime::spawn(writer(stdin, rx));

        // stderr → debug pane of every thread on this server
        {
            let app = app.clone();
            let s = server.clone();
            let mut lines = BufReader::new(stderr).lines();
            tauri::async_runtime::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    for sid in s.threads.lock().await.values().map(|t| t.session_id.clone()) {
                        let _ = app.emit("agent://stderr", json!({ "sessionId": sid, "line": line }));
                    }
                }
            });
        }

        // stdout → route
        {
            let app = app.clone();
            let s = server.clone();
            let mut lines = BufReader::new(stdout).lines();
            tauri::async_runtime::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();
                    if trimmed.is_empty() { continue; }
                    let Ok(v) = serde_json::from_str::<Value>(trimmed) else { continue };
                    handle_line(&app, &s, v).await;
                }
            });
        }

        // exit watcher: every thread on this server is over
        {
            let app = app.clone();
            let s = server.clone();
            let servers = self.servers.clone();
            let threads = self.threads.clone();
            tauri::async_runtime::spawn(async move {
                let status = child.wait().await;
                let code = status.ok().and_then(|st| st.code());
                servers.lock().await.remove(&s.site_id);
                let gone: Vec<Arc<Thread>> = s.threads.lock().await.drain().map(|(_, t)| t).collect();
                for t in gone {
                    threads.lock().await.remove(&t.session_id);
                    let _ = app.emit("agent://exit", json!({ "sessionId": t.session_id, "code": code }));
                }
                let state = app.state::<crate::state::AppState>();
                state.codex.persist().await;
            });
        }

        debug_log(&format!("spawned codex app-server pid {pid}; initialize …"));
        server.request("initialize", json!({ "clientInfo": { "name": "supasito", "version": app.package_info().version.to_string() } })).await?;
        debug_log("initialize answered");
        server.notify("initialized", json!({})).await?;
        Ok(server)
    }

    /// Stop one thread; the app-server goes with it when it was the site's last.
    pub async fn stop(&self, session_id: &str) -> Result<(), String> {
        let Some(t) = self.threads.lock().await.remove(session_id) else { return Ok(()) };
        t.decline_pending().await;
        let _ = t.interrupt().await;
        t.server.threads.lock().await.remove(&t.thread_id);
        let app_exit = t.server.threads.lock().await.is_empty();
        if app_exit {
            self.servers.lock().await.remove(&t.site_id);
            self.persist().await;
            shutdown(t.server.clone()).await;
        }
        Ok(())
    }

    pub async fn stop_all(&self) {
        let all: Vec<Arc<Server>> = self.servers.lock().await.drain().map(|(_, s)| s).collect();
        self.threads.lock().await.clear();
        for s in &all { s.close_input().await; s.signal_group(libc::SIGINT); }
        if !all.is_empty() {
            tokio::time::sleep(Duration::from_millis(800)).await;
            for s in &all { s.signal_group(libc::SIGTERM); }
        }
        let _ = std::fs::remove_file(&self.pids_file);
    }
}

/// Close stdin (a well-behaved app-server exits on EOF), then SIGINT, then SIGTERM the group.
async fn shutdown(server: Arc<Server>) {
    server.close_input().await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    server.signal_group(libc::SIGINT);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        server.signal_group(libc::SIGTERM);
    });
}

/// Step-by-step trace of the protocol, debug builds only (the smoke test reads it).
fn debug_log(msg: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[codex] {msg}");
    #[cfg(not(debug_assertions))]
    let _ = msg;
}

async fn handle_line(app: &AppHandle, s: &Arc<Server>, v: Value) {
    // Trace everything but the firehose (token deltas, MCP startup) in debug builds.
    if !v["method"].as_str().map(|m| m.contains("/delta") || m.contains("startupStatus")).unwrap_or(false) {
        debug_log(&format!("← {}", v.to_string().chars().take(160).collect::<String>()));
    }
    let id = v.get("id").and_then(|i| i.as_u64());
    let method = v.get("method").and_then(|m| m.as_str()).map(String::from);
    match (method, id) {
        (Some(method), Some(id)) => {
            // A server request: an approval, or something we must refuse so the turn is not stuck.
            let params = v.get("params").cloned().unwrap_or(Value::Null);
            let tid = params.get("threadId").and_then(|t| t.as_str()).unwrap_or("").to_string();
            let is_approval = method == "item/commandExecution/requestApproval" || method == "item/fileChange/requestApproval";
            let sid = s.session_for(&tid).await;
            match (is_approval, sid) {
                (true, Some(sid)) => {
                    let fc = match params.get("itemId").and_then(|i| i.as_str()) { Some(i) => s.file_changes.lock().await.get(i).cloned(), None => None };
                    s.approvals.lock().await.insert(id, tid.clone());
                    let _ = app.emit("agent://permission", json!({ "sessionId": sid, "requestId": id.to_string(), "request": shim_permission(&method, &params, fc.as_ref()) }));
                }
                _ => s.reply_error(id, format!("{method} is not supported by Supasito")).await,
            }
        }
        (Some(method), None) => {
            let params = v.get("params").cloned().unwrap_or(Value::Null);
            let tid = params.get("threadId").and_then(|t| t.as_str()).map(String::from);
            if method == "item/started" && params.pointer("/item/type").and_then(|t| t.as_str()) == Some("fileChange") {
                if let Some(item_id) = params.pointer("/item/id").and_then(|i| i.as_str()) {
                    s.file_changes.lock().await.insert(item_id.to_string(), params["item"].clone());
                }
            }
            if method == "turn/completed" {
                if let Some(tid) = tid.as_deref() {
                    if let Some(t) = s.threads.lock().await.get(tid).cloned() { *t.turn_id.lock().await = None; }
                }
                s.file_changes.lock().await.clear();
            }
            if matches!(method.as_str(), "warning" | "configWarning" | "deprecationNotice" | "guardianWarning") {
                let text = params.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
                for sid in s.threads.lock().await.values().map(|t| t.session_id.clone()) {
                    let _ = app.emit("agent://stderr", json!({ "sessionId": sid, "line": format!("{method}: {text}") }));
                }
            }
            let targets: Vec<String> = match tid {
                Some(tid) => s.session_for(&tid).await.into_iter().collect(),
                None => s.threads.lock().await.values().map(|t| t.session_id.clone()).collect(),
            };
            for sid in targets {
                let _ = app.emit("agent://message", json!({ "sessionId": sid, "message": v }));
            }
        }
        (None, Some(id)) => {
            if let Some(tx) = s.pending.lock().await.remove(&id) {
                let r = if let Some(err) = v.get("error") {
                    Err(err.get("message").and_then(|m| m.as_str()).map(String::from).unwrap_or_else(|| err.to_string()))
                } else {
                    Ok(v.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(r);
            }
        }
        _ => {}
    }
}

async fn writer(mut stdin: ChildStdin, mut rx: mpsc::Receiver<String>) {
    while let Some(line) = rx.recv().await {
        if stdin.write_all(line.as_bytes()).await.is_err() { break; }
        if stdin.flush().await.is_err() { break; }
    }
    let _ = stdin.shutdown().await;
}

/// Find the codex binary: configured path, then the login-shell PATH, then where npm and Homebrew put it.
pub async fn locate(configured: Option<&str>, path_env: &str) -> Option<String> {
    if let Some(p) = configured {
        if std::path::Path::new(p).is_file() { return Some(p.to_string()); }
    }
    for dir in path_env.split(':') {
        let p = std::path::Path::new(dir).join("codex");
        if p.is_file() { return Some(p.to_string_lossy().to_string()); }
    }
    for p in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        if std::path::Path::new(p).is_file() { return Some(p.to_string()); }
    }
    if let Some(home) = dirs::home_dir() {
        for rel in [".codex/bin/codex", ".npm-global/bin/codex", ".local/bin/codex"] {
            let p = home.join(rel);
            if p.is_file() { return Some(p.to_string_lossy().to_string()); }
        }
    }
    None
}

/// `codex --version` prints `codex-cli 0.149.0`; the number is what the checklist shows.
pub async fn version(path: &str, path_env: &str) -> Option<String> {
    let out = tokio::time::timeout(Duration::from_secs(15), Command::new(path).env("PATH", path_env).arg("--version").output()).await.ok()?.ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Some(s.split_whitespace().last().unwrap_or(&s).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_ids_pick_the_backend() {
        assert!(is_codex_model("gpt-5.6-luna"));
        assert!(is_codex_model("GPT-5.6-Sol"));
        assert!(is_codex_model("o3"));
        assert!(!is_codex_model("claude-opus-5"));
        assert!(!is_codex_model("opus"));
        assert!(!is_codex_model(""));
    }

    #[test]
    fn session_ids_are_prefixed_once() {
        assert!(is_codex_session("codex:01a0"));
        assert!(!is_codex_session("01a0"));
        assert_eq!(thread_id("codex:01a0"), "01a0");
        assert_eq!(thread_id("01a0"), "01a0");
    }

    #[test]
    fn modes_map_onto_policy_and_sandbox() {
        assert_eq!(policy_for_mode("default").0, "untrusted");
        assert_eq!(policy_for_mode("acceptEdits").0, "on-request");
        assert_eq!(policy_for_mode("bypassPermissions").1["type"], "dangerFullAccess");
        assert_eq!(policy_for_mode("plan").1["type"], "readOnly");
        assert_eq!(policy_for_mode("").0, "on-request");
    }

    #[test]
    fn claude_blocks_become_codex_input() {
        let v = user_input(&json!([
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAAA" } },
            { "type": "text", "text": "make it blue" },
            { "type": "tool_result", "content": "ignored" }
        ]));
        assert_eq!(v[0]["type"], "image");
        assert_eq!(v[0]["url"], "data:image/png;base64,AAAA");
        assert_eq!(v[1]["text"], "make it blue");
        assert_eq!(v.as_array().unwrap().len(), 2);
    }

    #[test]
    fn approvals_look_like_claude_requests() {
        let cmd = shim_permission("item/commandExecution/requestApproval", &json!({ "itemId": "exec-1", "command": "/bin/zsh -lc 'pnpm add x'", "cwd": "/s" }), None);
        assert_eq!(cmd["tool_name"], "Bash");
        assert_eq!(cmd["input"]["command"], "/bin/zsh -lc 'pnpm add x'");
        let fc = json!({ "id": "exec-2", "changes": [{ "path": "/s/a.ts", "kind": { "type": "add" }, "diff": "+hi" }] });
        let w = shim_permission("item/fileChange/requestApproval", &json!({ "itemId": "exec-2" }), Some(&fc));
        assert_eq!(w["tool_name"], "Write");
        assert_eq!(w["input"]["file_path"], "/s/a.ts");
        assert_eq!(w["input"]["diff"], "+hi");
        let e = shim_permission("item/fileChange/requestApproval", &json!({ "itemId": "exec-3" }), None);
        assert_eq!(e["tool_name"], "Edit");
        assert!(e["input"]["file_path"].is_null());
    }
}
