//! Debug-only end-to-end checks against the real Claude Code, run from a terminal:
//!
//!   OPEN_SMOKE_PROMPT="Change the hero headline to 'Hello'" pnpm tauri dev
//!
//! Environment:
//! - OPEN_SMOKE_PROMPT     the message to send ("-" = only start the dev server, then exit)
//! - OPEN_SMOKE_SITE       pick the registered site whose name or path contains this
//! - OPEN_SMOKE_SITE_PATH  use this folder as the site (registered in memory only, never saved)
//! - OPEN_SMOKE_MODEL      model alias for the run (e.g. haiku)
//! - OPEN_SMOKE_SCENARIO   prompt (default) | queue | interrupt | pointing | mode
//!
//! Permission prompts are auto-allowed. Everything is printed to stderr with a [smoke] prefix.

use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::mpsc;

use crate::{agent, state::AppState};

const HERO_SELECTION: &str = r#"{"page":"/","tag":"h1","id":"","classes":["mx-auto","mt-4","max-w-3xl","font-display","text-6xl","leading-[1.02]","tracking-tight","text-balance"],"text":"Say what you want. Watch it change.","selector":"main > section.px-6.pb-16:nth-of-type(1) > h1.mx-auto.mt-4","rect":{"x":256,"y":193,"w":768,"h":122},"styles":{"color":"rgb(23, 24, 28)","font-family":"Iowan Old Style","font-size":"60px","font-weight":"400"},"outerHtml":"<h1 class=\"mx-auto mt-4 max-w-3xl font-display text-6xl leading-[1.02] tracking-tight text-balance\">Say what you want. Watch it change.</h1>","source":null,"react":{"components":["Hero","Page"]}}"#;

fn summarize(m: &Value) {
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
        Some("system") => { if m["subtype"] == "init" { eprintln!("[smoke] system/init model={}", m["model"]); } }
        Some("stream_event") | Some("rate_limit_event") => {}
        other => eprintln!("[smoke] {:?}", other),
    }
}

/// Wait for the next `result` message (or process exit / timeout).
async fn wait_result(rx: &mut mpsc::Receiver<Value>, secs: u64) -> Option<Value> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(secs);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() { eprintln!("[smoke] timed out waiting for a result"); return None; }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(m)) => {
                if m["type"] == "__exit" { eprintln!("[smoke] process exited while waiting"); return None; }
                if m["type"] == "result" { return Some(m); }
            }
            Ok(None) => return None,
            Err(_) => { eprintln!("[smoke] timed out waiting for a result"); return None; }
        }
    }
}

pub async fn run(app: AppHandle, prompt: String) {
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let state = app.state::<AppState>();

    if let Ok(p) = std::env::var("OPEN_SMOKE_SITE_PATH") {
        match crate::sites::Site::from_path(&p) {
            Ok(site) => { eprintln!("[smoke] using ad-hoc site {} (not saved)", site.path); state.persisted.lock().unwrap().sites.insert(0, site); }
            Err(e) => { eprintln!("[smoke] bad OPEN_SMOKE_SITE_PATH: {e}"); app.exit(1); return; }
        }
    }
    let wanted = std::env::var("OPEN_SMOKE_SITE").ok();
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
    for _ in 0..120 {
        if let Some(d) = state.dev.status(&site.id).await { if d.status == "ready" || d.status == "error" { break; } }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if state.dev.status(&site.id).await.map(|d| d.status == "error").unwrap_or(false) {
        for line in state.dev.log(&site.id).await.iter().rev().take(6).rev() { eprintln!("[smoke] dev log: {line}"); }
    }
    if let Ok(out) = std::env::var("OPEN_SMOKE_CAPTURE") {
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
                if let Some(h) = st.agents.get(&sid).await {
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

    let session_id = match crate::start_agent(&app, &site.id, None).await {
        Ok(id) => id,
        Err(e) => { eprintln!("[smoke] agent start failed: {e}"); app.exit(1); return; }
    };
    eprintln!("[smoke] session {session_id}");
    let h = state.agents.get(&session_id).await.expect("handle");
    let send = |text: &str, sel: Option<Value>| h.send_user(agent::compose_user_content(text, sel.as_ref(), &[]));

    let scenario = std::env::var("OPEN_SMOKE_SCENARIO").unwrap_or_else(|_| "prompt".into());
    let started = std::time::Instant::now();
    match scenario.as_str() {
        "queue" => {
            eprintln!("[smoke] scenario queue: two messages back to back");
            let _ = send("Reply with exactly the single word ONE and nothing else.", None).await;
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let _ = send("Reply with exactly the single word TWO and nothing else.", None).await;
            let r1 = wait_result(&mut rx, 90).await;
            eprintln!("[smoke] first result after {:.1}s: {}", started.elapsed().as_secs_f32(), r1.as_ref().map(|r| r["result"].to_string()).unwrap_or("none".into()));
            let r2 = wait_result(&mut rx, 90).await;
            eprintln!("[smoke] second result after {:.1}s: {}", started.elapsed().as_secs_f32(), r2.as_ref().map(|r| r["result"].to_string()).unwrap_or("none".into()));
            eprintln!("[smoke] QUEUE {}", if r1.is_some() && r2.is_some() { "OK: both turns completed in order" } else { "FAILED" });
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
    state.dev.stop_all().await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    app.exit(0);
}
