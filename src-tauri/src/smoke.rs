//! Debug-only end-to-end checks against the real Claude Code, run from a terminal:
//!
//!   SUPASITO_SMOKE_PROMPT="Change the hero headline to 'Hello'" pnpm tauri dev
//!
//! Environment:
//! - SUPASITO_SMOKE_PROMPT     the message to send ("-" = only start the dev server, then exit)
//! - SUPASITO_SMOKE_SITE       pick the registered site whose name or path contains this
//! - SUPASITO_SMOKE_SITE_PATH  use this folder as the site (registered in memory only, never saved)
//! - SUPASITO_SMOKE_MODEL      model alias for the run (e.g. haiku); an OpenAI id (gpt-5.6-luna) runs the
//!                         scenario on Codex instead (agent/codex.rs). With HOME pointed at an empty
//!                         folder, set CODEX_HOME=~/.codex so Codex stays signed in and SUPASITO_PATH=$PATH.
//! - SUPASITO_SMOKE_EFFORT     --effort for the run (low, medium, high, xhigh, max)
//! - SUPASITO_SMOKE_FAST       1 = start with fast mode on (Opus only)
//! - SUPASITO_SMOKE_SCENARIO   prompt (default) | queue | interrupt | pointing | mode | model | fast | undo | tools | ports | history
//!                         (model: set_model sonnet between two turns, start with SUPASITO_SMOKE_MODEL=haiku;
//!                         fast: apply_flag_settings fastMode between two turns, start with SUPASITO_SMOKE_MODEL=opus)
//!                         (undo: one turn that edits a tracked file and creates a new one, then the same
//!                         `undo_files` call the Undo button makes; needs a clean git repo as the site)
//!                         (tools: print the first-run toolchain check as JSON and exit; combine
//!                         with HOME=<empty dir> for "signed out" and SUPASITO_PATH=/usr/bin:/bin for
//!                         "no Node, no Claude Code")
//!                         (ports: a Node process holds port 4321 on `::`; two scratch sites check that the
//!                         free-port pick skips it, that a forced conflict (SUPASITO_SMOKE_FORCE_PORT, read by
//!                         devserver) retries on another port, and that a fixed-port command ends in a
//!                         port problem naming the holder, which `free_blocked_port` then kills; exits)
//!
//! Permission prompts are auto-allowed. Everything is printed to stderr with a [smoke] prefix.

use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::mpsc;

use crate::{agent, state::AppState};

const HERO_SELECTION: &str = r#"{"page":"/","tag":"h1","id":"","classes":["mx-auto","mt-4","max-w-3xl","font-display","text-6xl","leading-[1.02]","tracking-tight","text-balance"],"text":"Say what you want. Watch it change.","selector":"main > section.px-6.pb-16:nth-of-type(1) > h1.mx-auto.mt-4","rect":{"x":256,"y":193,"w":768,"h":122},"styles":{"color":"rgb(23, 24, 28)","font-family":"Iowan Old Style","font-size":"60px","font-weight":"400"},"outerHtml":"<h1 class=\"mx-auto mt-4 max-w-3xl font-display text-6xl leading-[1.02] tracking-tight text-balance\">Say what you want. Watch it change.</h1>","source":null,"react":{"components":["Hero","Page"]}}"#;

fn summarize(m: &Value) {
    if let Some(method) = m["method"].as_str() {
        // Codex app-server notifications (the interesting ones; deltas and housekeeping stay quiet)
        let p = &m["params"];
        match method {
            "item/completed" => match p["item"]["type"].as_str() {
                Some("agentMessage") => eprintln!("[smoke] codex: {}", p["item"]["text"].as_str().unwrap_or("").replace('\n', " ")),
                Some("commandExecution") => eprintln!("[smoke] command {} exit={} status={}", p["item"]["command"], p["item"]["exitCode"], p["item"]["status"]),
                Some("fileChange") => eprintln!("[smoke] fileChange {} status={}", p["item"]["changes"].as_array().map(|c| c.iter().map(|x| format!("{}:{}", x["kind"]["type"], x["path"])).collect::<Vec<_>>().join(",")).unwrap_or_default(), p["item"]["status"]),
                Some("reasoning") => eprintln!("[smoke] reasoning: {}", p["item"]["summary"]),
                _ => {}
            },
            "turn/completed" => eprintln!("[smoke] turn/completed status={} error={} durationMs={}", p["turn"]["status"], p["turn"]["error"]["message"], p["turn"]["durationMs"]),
            "supasito/session" => eprintln!("[smoke] codex thread {} model={} mode={}", p["threadId"], p["model"], p["mode"]),
            "thread/tokenUsage/updated" => eprintln!("[smoke] tokens: last.input={} window={}", p["tokenUsage"]["last"]["inputTokens"], p["tokenUsage"]["modelContextWindow"]),
            "account/rateLimits/updated" => eprintln!("[smoke] rate limit: primary {}% of a {} min window", p["rateLimits"]["primary"]["usedPercent"], p["rateLimits"]["primary"]["windowDurationMins"]),
            "error" => eprintln!("[smoke] codex error: {} willRetry={}", p["error"]["message"], p["willRetry"]),
            _ => {}
        }
        return;
    }
    match m["type"].as_str() {
        Some("assistant") => {
            for b in m["message"]["content"].as_array().cloned().unwrap_or_default() {
                match b["type"].as_str() {
                    Some("text") => eprintln!("[smoke] claude: {}", b["text"].as_str().unwrap_or("").replace('\n', " ")),
                    Some("tool_use") => eprintln!("[smoke] tool_use {} {}", b["name"], b["input"].to_string().chars().take(140).collect::<String>()),
                    _ => {}
                }
            }
        }
        Some("user") => eprintln!("[smoke] tool_result"),
        Some("result") => eprintln!("[smoke] result: subtype={} is_error={} turns={} cost={}", m["subtype"], m["is_error"], m["num_turns"], m["total_cost_usd"]),
        Some("system") => { if m["subtype"] == "init" { eprintln!("[smoke] system/init model={} fast_mode_state={}", m["model"], m["fast_mode_state"]); } }
        Some("stream_event") | Some("rate_limit_event") => {}
        other => eprintln!("[smoke] {:?}", other),
    }
}

/// Wait for the next `result` message (or process exit / timeout).
async fn wait_result(rx: &mut mpsc::Receiver<Value>, secs: u64) -> Option<Value> {
    wait_turn(rx, secs).await.0
}

/// Like `wait_result`, also returning the model of the last assistant message seen on the way.
async fn wait_turn(rx: &mut mpsc::Receiver<Value>, secs: u64) -> (Option<Value>, Option<String>) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(secs);
    let mut model = None;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { eprintln!("[smoke] timed out waiting for a result"); return (None, model); }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(m)) => {
                if m["type"] == "__exit" { eprintln!("[smoke] process exited while waiting"); return (None, model); }
                if m["type"] == "assistant" { if let Some(s) = m["message"]["model"].as_str() { model = Some(s.to_string()); } }
                if m["method"] == "supasito/session" { if let Some(s) = m["params"]["model"].as_str() { model = Some(s.to_string()); } }
                if m["type"] == "result" || m["method"] == "turn/completed" { return (Some(m), model); }
            }
            Ok(None) => return (None, model),
            Err(_) => { eprintln!("[smoke] timed out waiting for a result"); return (None, model); }
        }
    }
}

/// Like `wait_result`, also collecting the files the turn's Edit/MultiEdit/Write/NotebookEdit calls
/// named (absolute paths as the CLI sent them, deduplicated, in order) — what the UI's Undo hands to
/// `undo_files` as `files`.
async fn wait_turn_files(rx: &mut mpsc::Receiver<Value>, secs: u64) -> (Option<Value>, Vec<String>) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(secs);
    let mut files: Vec<String> = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { eprintln!("[smoke] timed out waiting for a result"); return (None, files); }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(m)) => {
                if m["type"] == "__exit" { eprintln!("[smoke] process exited while waiting"); return (None, files); }
                if m["type"] == "assistant" {
                    for b in m["message"]["content"].as_array().cloned().unwrap_or_default() {
                        if b["type"] != "tool_use" { continue; }
                        let path = match b["name"].as_str() {
                            Some("Edit") | Some("MultiEdit") | Some("Write") => b["input"]["file_path"].as_str(),
                            Some("NotebookEdit") => b["input"]["notebook_path"].as_str(),
                            _ => None,
                        };
                        if let Some(p) = path { if !files.iter().any(|f| f == p) { files.push(p.to_string()); } }
                    }
                }
                if m["method"] == "item/started" && m["params"]["item"]["type"] == "fileChange" {
                    for c in m["params"]["item"]["changes"].as_array().cloned().unwrap_or_default() {
                        if let Some(p) = c["path"].as_str() { if !files.iter().any(|f| f == p) { files.push(p.to_string()); } }
                    }
                }
                if m["type"] == "result" || m["method"] == "turn/completed" { return (Some(m), files); }
            }
            Ok(None) => return (None, files),
            Err(_) => { eprintln!("[smoke] timed out waiting for a result"); return (None, files); }
        }
    }
}

/// The `ports` scenario; returns the exit code (0 = every expectation held).
async fn ports(app: &AppHandle) -> i32 {
    use crate::devserver::DevProblem;
    let state = app.state::<AppState>();
    let mut failures = 0;
    let mut check = |ok: bool, what: &str| { eprintln!("[smoke] {} {what}", if ok { "ok  " } else { "FAIL" }); if !ok { failures += 1; } };
    let dir = std::env::temp_dir().join(format!("supasito-ports-{}", std::process::id()));
    let mk = |name: &str, dev: &str| -> crate::sites::Site {
        let p = dir.join(name);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("supasito.json"), format!(r#"{{"name":"{name}","dev":"{dev}"}}"#)).unwrap();
        crate::sites::Site::from_path(p.to_str().unwrap()).unwrap()
    };
    let flexible = mk("ports-a", "python3 -m http.server {port}");
    let fixed = mk("ports-b", "python3 -m http.server 4321");
    let mut holder = std::process::Command::new("node");
    holder.args(["-e", "require('net').createServer().listen(4321, () => setTimeout(() => {}, 120000))"]).stdin(std::process::Stdio::null());
    std::os::unix::process::CommandExt::process_group(&mut holder, 0);
    let mut holder = match holder.spawn() { Ok(h) => h, Err(e) => { eprintln!("[smoke] cannot start the node holder: {e}"); return 1; } };
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    app.listen_any("dev://status", |e| eprintln!("[smoke] dev: {}", e.payload()));
    app.listen_any("dev://log", |e| eprintln!("[smoke] log: {}", e.payload()));
    let settle = |site_id: String| async move {
        let state = app.state::<AppState>();
        for _ in 0..60 {
            if let Some(d) = state.dev.status(&site_id).await { if d.status == "ready" || d.status == "error" { return Some(d); } }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        state.dev.status(&site_id).await
    };

    eprintln!("[smoke] A: {{port}} command while node holds 4321");
    let _ = state.dev.start(app.clone(), flexible.clone(), state.path_env.clone()).await;
    let a = settle(flexible.id.clone()).await;
    check(a.as_ref().map(|d| d.status == "ready" && d.port != 4321).unwrap_or(false), &format!("skipped the taken port: {:?}", a.as_ref().map(|d| (d.status.clone(), d.port))));
    let _ = state.dev.stop(app, &flexible.id).await;

    eprintln!("[smoke] C: forced onto 4321, expect a retry on another port");
    std::env::set_var("SUPASITO_SMOKE_FORCE_PORT", "4321");
    let _ = state.dev.start(app.clone(), flexible.clone(), state.path_env.clone()).await;
    std::env::remove_var("SUPASITO_SMOKE_FORCE_PORT");
    let c = settle(flexible.id.clone()).await;
    let log = state.dev.log(&flexible.id).await;
    check(c.as_ref().map(|d| d.status == "ready" && d.port != 4321).unwrap_or(false), &format!("retried onto a free port: {:?}", c.as_ref().map(|d| (d.status.clone(), d.port))));
    check(log.iter().any(|l| l.starts_with("Port 4321 is taken by node")), "log names the holder");
    let _ = state.dev.stop(app, &flexible.id).await;

    eprintln!("[smoke] B: fixed-port command, expect a port problem naming node, then free it");
    let _ = state.dev.start(app.clone(), fixed.clone(), state.path_env.clone()).await;
    let b = settle(fixed.id.clone()).await;
    let problem = b.as_ref().and_then(|d| d.problem.clone());
    let named = match &problem { Some(DevProblem::Port { port, holder: Some(h) }) => *port == 4321 && h.pid == holder.id() && h.name == "node", _ => false };
    check(named, &format!("problem: {problem:?}"));
    match state.dev.free_blocked_port(app, &fixed.id).await {
        Ok(report) => { eprintln!("[smoke] free_blocked_port: {report}"); check(report.starts_with("Stopped node"), "the holder was stopped"); }
        Err(e) => check(false, &format!("free_blocked_port failed: {e}")),
    }
    check(holder.try_wait().map(|s| s.is_some()).unwrap_or(false), "node holder is gone");
    let _ = state.dev.stop(app, &fixed.id).await;
    let _ = state.dev.start(app.clone(), fixed.clone(), state.path_env.clone()).await;
    let b2 = settle(fixed.id.clone()).await;
    check(b2.as_ref().map(|d| d.status == "ready" && d.port == 4321).unwrap_or(false), &format!("fixed-port site ready after freeing: {:?}", b2.as_ref().map(|d| (d.status.clone(), d.port))));

    // D: the shape that started this — a package.json dev script that hardcodes its own port and cannot
    // take an appended --port. Supasito must run it as written and find where it actually went, which no
    // output can tell it: python's banner is block-buffered behind our pipe and never arrives.
    eprintln!("[smoke] D: package.json script with a port of its own");
    let own = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let p = dir.join("ports-d");
    std::fs::create_dir_all(&p).unwrap();
    std::fs::write(p.join("package.json"), format!(r#"{{"name":"ports-d","scripts":{{"dev":"python3 -m http.server {own} --bind 127.0.0.1"}}}}"#)).unwrap();
    std::fs::write(p.join("index.html"), "<h1>d</h1>").unwrap();
    let own_port = crate::sites::Site::from_path(p.to_str().unwrap()).unwrap();
    check(own_port.dev.as_deref() == Some("npm run dev"), &format!("no port flag appended to a script we do not recognise: {:?}", own_port.dev));
    let _ = state.dev.start(app.clone(), own_port.clone(), state.path_env.clone()).await;
    let d = settle(own_port.id.clone()).await;
    check(d.as_ref().map(|x| x.status == "ready" && x.port == own).unwrap_or(false), &format!("followed the server to its own port {own}: {:?}", d.as_ref().map(|x| (x.status.clone(), x.port))));
    let served = tokio::process::Command::new("curl").args(["-s", &format!("http://127.0.0.1:{own}/")]).output().await
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    check(served.contains("<h1>d</h1>"), &format!("the preview URL serves the site: {served:?}"));
    let _ = state.dev.stop(app, &own_port.id).await;

    let _ = holder.kill();
    let _ = std::fs::remove_dir_all(&dir);
    eprintln!("[smoke] ports: {failures} failure(s)");
    if failures == 0 { 0 } else { 1 }
}

pub async fn run(app: AppHandle, prompt: String) {
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let state = app.state::<AppState>();

    if std::env::var("SUPASITO_SMOKE_SCENARIO").as_deref() == Ok("tools") {
        let configured = state.persisted.lock().unwrap().claude_path.clone();
        let t = crate::toolchain::check(configured.as_deref(), &state.path_env).await;
        eprintln!("[smoke] PATH: {}", state.path_env);
        eprintln!("[smoke] toolchain: {}", serde_json::to_string_pretty(&t).unwrap_or_default());
        app.exit(0);
        return;
    }

    if std::env::var("SUPASITO_SMOKE_SCENARIO").as_deref() == Ok("ports") {
        let code = ports(&app).await;
        state.dev.stop_all().await;
        app.exit(code);
        return;
    }

    if let Ok(p) = std::env::var("SUPASITO_SMOKE_SITE_PATH") {
        match crate::sites::Site::from_path(&p) {
            Ok(site) => { eprintln!("[smoke] using ad-hoc site {} (not saved)", site.path); state.persisted.lock().unwrap().sites.insert(0, site); }
            Err(e) => { eprintln!("[smoke] bad SUPASITO_SMOKE_SITE_PATH: {e}"); app.exit(1); return; }
        }
    }
    let wanted = std::env::var("SUPASITO_SMOKE_SITE").ok();
    let site = {
        let sites = state.persisted.lock().unwrap().sites.clone();
        match &wanted {
            Some(w) => sites.into_iter().find(|s| s.name.contains(w.as_str()) || s.path.contains(w.as_str())),
            None => sites.into_iter().next(),
        }
    };
    let Some(site) = site else { eprintln!("[smoke] no matching site registered; add one first"); app.exit(1); return; };
    eprintln!("[smoke] site: {} ({})", site.name, site.path);

    app.listen_any("dev://status", |e| eprintln!("[smoke] dev: {}", e.payload()));
    match state.dev.start(app.clone(), site.clone(), state.path_env.clone()).await {
        Ok(info) => eprintln!("[smoke] dev server starting on {}", info.url),
        Err(e) => eprintln!("[smoke] dev server failed: {e}"),
    }
    // long enough to see the 90 s "never opened its port" timeout become an error
    for _ in 0..240 {
        if let Some(d) = state.dev.status(&site.id).await { if d.status == "ready" || d.status == "error" { break; } }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if state.dev.status(&site.id).await.map(|d| d.status == "error").unwrap_or(false) {
        for line in state.dev.log(&site.id).await.iter().rev().take(6).rev() { eprintln!("[smoke] dev log: {line}"); }
    }
    if let Ok(out) = std::env::var("SUPASITO_SMOKE_CAPTURE") {
        use tauri::Manager;
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        if let Some(w) = app.get_webview_window("main") {
            let size = w.inner_size().unwrap_or(tauri::PhysicalSize::new(1440, 900));
            let scale = w.scale_factor().unwrap_or(2.0);
            let (cw, ch) = (size.width as f64 / scale, size.height as f64 / scale);
            eprintln!("[smoke] capture window {cw}x{ch} css px (scale {scale})");
            // the right-hand 55% of the window is where the preview pane lives
            let x = cw * 0.45;
            match crate::capture::capture_region(&app, x, 0.0, cw - x, ch).await {
                Ok(bytes) => { let _ = std::fs::write(&out, &bytes); eprintln!("[smoke] capture written to {out} ({} bytes)", bytes.len()); }
                Err(e) => eprintln!("[smoke] capture failed: {e}"),
            }
        }
    }
    if prompt == "-" {
        let d = state.dev.status(&site.id).await;
        eprintln!("[smoke] dev server final status: {:?}", d.map(|d| format!("{} {}", d.status, d.url)));
        state.dev.stop_all().await;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        app.exit(0);
        return;
    }

    let (tx, mut rx) = mpsc::channel::<Value>(512);
    {
        let tx = tx.clone();
        app.listen_any("agent://message", move |e| {
            let v: Value = serde_json::from_str(e.payload()).unwrap_or(Value::Null);
            let m = v["message"].clone();
            summarize(&m);
            let _ = tx.try_send(m);
        });
    }
    {
        let app2 = app.clone();
        app.listen_any("agent://permission", move |e| {
            let v: Value = serde_json::from_str(e.payload()).unwrap_or(Value::Null);
            eprintln!("[smoke] permission request for {} → allowing", v["request"]["tool_name"]);
            let sid = v["sessionId"].as_str().unwrap_or("").to_string();
            let rid = v["requestId"].as_str().unwrap_or("").to_string();
            let input = v["request"]["input"].clone();
            let app3 = app2.clone();
            tauri::async_runtime::spawn(async move {
                let st = app3.state::<AppState>();
                if let Ok(h) = st.agent(&sid).await {
                    let _ = h.respond(&rid, json!({ "behavior": "allow", "updatedInput": input })).await;
                }
            });
        });
    }
    {
        let tx = tx.clone();
        app.listen_any("agent://exit", move |e| { eprintln!("[smoke] exit: {}", e.payload()); let _ = tx.try_send(json!({ "type": "__exit" })); });
    }
    app.listen_any("agent://stderr", |e| eprintln!("[smoke] stderr: {}", e.payload()));
    app.listen_any("agent://control_error", |e| eprintln!("[smoke] CONTROL ERROR: {}", e.payload()));

    let session_id = match crate::start_agent(&app, &site.id, None, None).await {
        Ok(id) => id,
        Err(e) => { eprintln!("[smoke] agent start failed: {e}"); app.exit(1); return; }
    };
    eprintln!("[smoke] session {session_id}");
    let h = state.agent(&session_id).await.expect("handle");
    let send = |text: &str, sel: Option<Value>| h.send_user(agent::compose_user_content(text, sel.as_ref(), &[]));

    let scenario = std::env::var("SUPASITO_SMOKE_SCENARIO").unwrap_or_else(|_| "prompt".into());
    let started = std::time::Instant::now();
    match scenario.as_str() {
        "queue" => {
            eprintln!("[smoke] scenario queue: two messages back to back");
            // Codex answers within the turn: the second message is steered into the running one (turn/steer),
            // so both words arrive in a single turn/completed. Collect what the agent said to check that.
            let said = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
            {
                let said = said.clone();
                app.listen_any("agent://message", move |e| {
                    let v: Value = serde_json::from_str(e.payload()).unwrap_or(Value::Null);
                    let m = &v["message"];
                    if m["method"] == "item/completed" && m["params"]["item"]["type"] == "agentMessage" {
                        if let Some(t) = m["params"]["item"]["text"].as_str() { said.lock().unwrap().push(t.to_string()); }
                    }
                });
            }
            let _ = send("Reply with exactly the single word ONE and nothing else.", None).await;
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let _ = send("Reply with exactly the single word TWO and nothing else.", None).await;
            let r1 = wait_result(&mut rx, 90).await;
            eprintln!("[smoke] first result after {:.1}s: {}", started.elapsed().as_secs_f32(), r1.as_ref().map(|r| r["result"].to_string()).unwrap_or("none".into()));
            if agent::codex::is_codex_session(&session_id) {
                let said = said.lock().unwrap().clone();
                let both = said.iter().any(|t| t.contains("ONE")) && said.iter().any(|t| t.contains("TWO"));
                eprintln!("[smoke] codex said: {said:?}");
                eprintln!("[smoke] QUEUE {}", if r1.is_some() && both { "OK: the second message was steered into the running turn and both were answered" } else { "FAILED" });
            } else {
                let r2 = wait_result(&mut rx, 90).await;
                eprintln!("[smoke] second result after {:.1}s: {}", started.elapsed().as_secs_f32(), r2.as_ref().map(|r| r["result"].to_string()).unwrap_or("none".into()));
                eprintln!("[smoke] QUEUE {}", if r1.is_some() && r2.is_some() { "OK: both turns completed in order" } else { "FAILED" });
            }
        }
        "interrupt" => {
            eprintln!("[smoke] scenario interrupt: long task, stop after 6s, then a follow-up");
            let _ = send("Count from 1 to 400, one number per line, slowly and without using any tools. Do not stop early.", None).await;
            tokio::time::sleep(std::time::Duration::from_secs(6)).await;
            eprintln!("[smoke] sending interrupt");
            let _ = h.interrupt().await;
            let r1 = wait_result(&mut rx, 60).await;
            eprintln!("[smoke] result after interrupt at {:.1}s: {}", started.elapsed().as_secs_f32(), r1.as_ref().map(|r| format!("subtype={} is_error={} text={}", r["subtype"], r["is_error"], r["result"].to_string().chars().take(80).collect::<String>())).unwrap_or("none".into()));
            let _ = send("Reply with exactly the single word OK and nothing else.", None).await;
            let r2 = wait_result(&mut rx, 60).await;
            eprintln!("[smoke] follow-up result: {}", r2.as_ref().map(|r| r["result"].to_string()).unwrap_or("none".into()));
            eprintln!("[smoke] INTERRUPT {}", if r1.is_some() && r2.is_some() { "OK: turn ended on interrupt and the session kept working" } else { "FAILED" });
        }
        "mode" => {
            eprintln!("[smoke] scenario mode: switch the running session to bypassPermissions, then ask for a Bash command");
            let _ = send("Reply with the single word READY and nothing else.", None).await;
            let _ = wait_result(&mut rx, 60).await;
            let _ = h.set_permission_mode("bypassPermissions").await;
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let permission_seen = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            {
                let seen = permission_seen.clone();
                app.listen_any("agent://permission", move |_| { seen.store(true, std::sync::atomic::Ordering::SeqCst); });
            }
            let _ = send("Use the Bash tool to run exactly: echo open-mode-check. Then reply with its output.", None).await;
            let r = wait_result(&mut rx, 90).await;
            let seen = permission_seen.load(std::sync::atomic::Ordering::SeqCst);
            eprintln!("[smoke] result: {} · permission prompt seen: {seen}", r.as_ref().map(|r| r["result"].to_string()).unwrap_or("none".into()));
            eprintln!("[smoke] MODE {}", if r.is_some() && !seen { "OK: bypassPermissions applied mid-session (no prompt)" } else { "FAILED or prompt still shown" });
        }
        "model" => {
            eprintln!("[smoke] scenario model: one turn, set_model sonnet, another turn (start with SUPASITO_SMOKE_MODEL=haiku)");
            let _ = send("Reply with the single word ONE and nothing else.", None).await;
            let (r1, m1) = wait_turn(&mut rx, 90).await;
            match h.set_model("sonnet").await { Ok(id) => eprintln!("[smoke] set_model sent ({id})"), Err(e) => eprintln!("[smoke] set_model failed: {e}") }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = send("Reply with the single word TWO and nothing else.", None).await;
            let (r2, m2) = wait_turn(&mut rx, 90).await;
            eprintln!("[smoke] models: turn 1 = {m1:?}, turn 2 = {m2:?}");
            let switched = r1.is_some() && r2.is_some() && m2.as_deref().map(|m| m.contains("sonnet")).unwrap_or(false) && m1 != m2;
            eprintln!("[smoke] MODEL {}", if switched { "OK: set_model switched the running session" } else { "FAILED: the second turn did not run on sonnet (see CONTROL ERROR lines)" });
        }
        "fast" => {
            eprintln!("[smoke] scenario fast: one turn, apply_flag_settings fastMode+effortLevel, another turn (start with SUPASITO_SMOKE_MODEL=opus; about $0.25 a turn)");
            let _ = send("Reply with the single word ONE and nothing else.", None).await;
            let r1 = wait_result(&mut rx, 90).await;
            let before = r1.as_ref().map(|r| r["fast_mode_state"].to_string()).unwrap_or("none".into());
            match h.apply_settings(json!({ "fastMode": true, "effortLevel": "low" })).await { Ok(id) => eprintln!("[smoke] apply_flag_settings sent ({id})"), Err(e) => eprintln!("[smoke] apply_flag_settings failed: {e}") }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = send("Reply with the single word TWO and nothing else.", None).await;
            let r2 = wait_result(&mut rx, 90).await;
            let after = r2.as_ref().map(|r| r["fast_mode_state"].to_string()).unwrap_or("none".into());
            let speed = r2.as_ref().map(|r| r["usage"]["speed"].to_string()).unwrap_or("none".into());
            eprintln!("[smoke] fast_mode_state: before={before} after={after} · usage.speed={speed}");
            eprintln!("[smoke] FAST {}", if after == "\"on\"" { "OK: apply_flag_settings turned fast mode on mid-session" } else { "FAILED: fast mode did not turn on (Opus only; see CONTROL ERROR lines)" });
        }
        "undo" => {
            eprintln!("[smoke] scenario undo: edit a tracked file and create a new one, then undo the turn the way the Undo button does");
            let git = |label: &str| -> Option<crate::sites::GitStatus> {
                match crate::sites::git_status(&site.path, &state.path_env) {
                    Ok(g) => { eprintln!("[smoke] git {label}: {}", if !g.is_git { "not a git repo".to_string() } else if g.files.is_empty() { "clean".to_string() } else { format!("{:?}", g.files) }); Some(g) }
                    Err(e) => { eprintln!("[smoke] git {label}: status failed: {e}"); None }
                }
            };
            let clean = git("before").map(|g| g.is_git && g.files.is_empty()).unwrap_or(false);
            if !clean {
                eprintln!("[smoke] UNDO SKIPPED: site is not a clean git repo");
            } else {
                // what the UI keeps from `agent://fs`: Write calls whose target did not exist yet
                let created = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
                {
                    let created = created.clone();
                    app.listen_any("agent://fs", move |e| {
                        let v: Value = serde_json::from_str(e.payload()).unwrap_or(Value::Null);
                        if v["existed"] == false { if let Some(f) = v["file"].as_str() { created.lock().unwrap().push(f.to_string()); } }
                    });
                }
                let _ = send("Create a new file `smoke-undo.txt` at the site root containing the single line `undo me` (use the Write tool), and use the Edit tool to append the line `// smoke-undo` to the end of `components/footer.tsx`. Do not run any commands. Reply with one sentence.", None).await;
                let (r, files) = wait_turn_files(&mut rx, 240).await;
                let created: Vec<String> = created.lock().unwrap().clone();
                eprintln!("[smoke] touched: {files:?} created: {created:?}");
                let after_turn = git("after turn").map(|g| g.files).unwrap_or_default();
                let edited = "components/footer.tsx".to_string();
                let new_file = "smoke-undo.txt".to_string();
                let mut failed: Option<String> = None;
                if r.is_none() { failed = Some("the turn did not complete".into()); }
                else if !(after_turn.iter().any(|f| f == "components/footer.tsx") && after_turn.iter().any(|f| f == "smoke-undo.txt")) { failed = Some(format!("git status after the turn should list both files, got {after_turn:?}")); }
                else if !(files.iter().any(|f| f.ends_with(&edited)) && files.iter().any(|f| f.ends_with(&new_file))) { failed = Some(format!("the turn's tool_use blocks should name both files, got {files:?}")); }
                else if created.len() != 1 || !created[0].ends_with(&new_file) { failed = Some(format!("agent://fs should report only smoke-undo.txt as created, got {created:?}")); }
                if failed.is_none() {
                    match crate::undo_files(&app, &site.id, files.clone(), created.clone()).await {
                        Ok(rep) => {
                            eprintln!("[smoke] undo report: restored={:?} deleted={:?} skipped={:?}", rep.restored, rep.deleted, rep.skipped);
                            let after_undo = git("after undo").map(|g| g.files).unwrap_or_default();
                            if rep.restored != vec!["components/footer.tsx".to_string()] { failed = Some(format!("restored should be [components/footer.tsx], got {:?}", rep.restored)); }
                            else if rep.deleted != vec!["smoke-undo.txt".to_string()] { failed = Some(format!("deleted should be [smoke-undo.txt], got {:?}", rep.deleted)); }
                            else if !rep.skipped.is_empty() { failed = Some(format!("skipped should be empty, got {:?}", rep.skipped)); }
                            else if !after_undo.is_empty() { failed = Some(format!("git status after undo should be clean, got {after_undo:?}")); }
                            else if std::path::Path::new(&site.path).join(&new_file).exists() { failed = Some("smoke-undo.txt still exists after undo".into()); }
                        }
                        Err(e) => failed = Some(format!("undo_files failed: {e}")),
                    }
                }
                match failed {
                    None => eprintln!("[smoke] UNDO OK: tracked file restored, created file removed, git status clean"),
                    Some(why) => eprintln!("[smoke] UNDO FAILED: {why}"),
                }
            }
        }
        "history" => {
            // One turn, then what the rail and a resumed session ask for: the thread list for this site and the
            // thread's replay (thread/list, thread/read). Codex only.
            eprintln!("[smoke] scenario history: one turn, then list and replay it");
            let _ = send(&prompt, None).await;
            let r = wait_result(&mut rx, 240).await;
            let codex_path = agent::codex::locate(None, &state.path_env).await.unwrap_or_default();
            let list = state.codex.list(&app, &site.id, &site.path, &codex_path, &state.path_env).await;
            let mine = list.as_ref().ok().and_then(|l| l.iter().find(|s| s.id == session_id).cloned());
            eprintln!("[smoke] thread list: {} entries, ours = {:?}", list.as_ref().map(|l| l.len()).unwrap_or(0), mine.as_ref().map(|s| (&s.title, s.last_modified, &s.git_branch)));
            let lines = state.codex.transcript(&app, &site.id, &site.path, agent::codex::thread_id(&session_id), &codex_path, &state.path_env).await;
            let kinds: Vec<String> = lines.as_ref().map(|l| l.iter().filter(|m| m["method"] == "item/completed").map(|m| m["params"]["item"]["type"].as_str().unwrap_or("?").to_string()).collect()).unwrap_or_default();
            eprintln!("[smoke] replay: {} lines, items {:?}", lines.as_ref().map(|l| l.len()).unwrap_or(0), kinds);
            let ok = r.is_some() && mine.as_ref().map(|s| s.title.starts_with(&prompt.chars().take(20).collect::<String>())).unwrap_or(false) && kinds.iter().any(|k| k == "agentMessage") && kinds.iter().any(|k| k == "userMessage");
            eprintln!("[smoke] HISTORY {}", if ok { "OK: the thread is listed under its first message and replays its items" } else { "FAILED" });
        }
        "pointing" => {
            eprintln!("[smoke] scenario pointing: message with an attached selection (the starter's hero h1)");
            let sel: Value = serde_json::from_str(HERO_SELECTION).unwrap();
            let _ = send(&prompt, Some(sel)).await;
            let r = wait_result(&mut rx, 240).await;
            eprintln!("[smoke] POINTING {}", if r.is_some() { "turn completed; check the git diff below" } else { "FAILED" });
        }
        _ => {
            let _ = send(&prompt, None).await;
            let _ = wait_result(&mut rx, 240).await;
        }
    }

    match crate::sites::git_status(&site.path, &state.path_env) {
        Ok(g) => eprintln!("[smoke] changed files: {:?}", g.files),
        Err(e) => eprintln!("[smoke] git status failed: {e}"),
    }
    state.agents.stop_all().await;
    state.codex.stop_all().await;
    state.dev.stop_all().await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    app.exit(0);
}
