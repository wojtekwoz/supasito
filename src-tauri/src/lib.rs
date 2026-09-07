mod agent;
mod capture;
mod devserver;
mod sites;
#[cfg(debug_assertions)]
mod smoke;
mod state;
mod toolchain;

use serde_json::{json, Value};
use state::AppState;
use tauri::{AppHandle, Emitter, Manager, State};

const PICKER_JS: &str = include_str!("picker.js");

// ---------- settings / environment ----------

#[tauri::command]
fn settings_get(state: State<'_, AppState>) -> Value {
    let p = state.persisted.lock().unwrap().clone();
    json!({
        "claudePath": p.claude_path,
        "model": p.model,
        "permissionMode": p.permission_mode,
        "effort": p.effort,
        "fastMode": p.fast_mode,
        "hidden": p.hidden,
    })
}

#[tauri::command]
fn settings_set(state: State<'_, AppState>, patch: Value) -> Result<(), String> {
    {
        let mut p = state.persisted.lock().unwrap();
        if let Some(v) = patch.get("claudePath") { p.claude_path = v.as_str().map(|s| s.to_string()).filter(|s| !s.is_empty()); }
        if let Some(v) = patch.get("model") { p.model = v.as_str().map(|s| s.to_string()).filter(|s| !s.is_empty()); }
        if let Some(v) = patch.get("permissionMode") { p.permission_mode = v.as_str().map(|s| s.to_string()).filter(|s| !s.is_empty()); }
        if let Some(v) = patch.get("effort") { p.effort = v.as_str().map(|s| s.to_string()).filter(|s| agent::claude::EFFORTS.contains(&s.as_str())); }
        if let Some(v) = patch.get("fastMode") { p.fast_mode = v.as_bool().unwrap_or(false); }
        if let Some(v) = patch.get("hidden") { p.hidden = v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(); }
    }
    state.save()
}

/// What this Mac has (Node, package manager, git, Claude Code and its login), for the checklist.
#[tauri::command]
async fn toolchain_check(state: State<'_, AppState>) -> Result<toolchain::Toolchain, String> {
    let configured = state.persisted.lock().unwrap().claude_path.clone();
    Ok(toolchain::check(configured.as_deref(), &state.path_env).await)
}

// ---------- sites ----------

#[tauri::command]
fn sites_list(state: State<'_, AppState>) -> Vec<sites::Site> {
    state.persisted.lock().unwrap().sites.clone()
}

#[tauri::command]
async fn site_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title("Open a site folder").pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => Ok(Some(fp.into_path().map_err(|e| e.to_string())?.to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn site_add(state: State<'_, AppState>, path: String) -> Result<sites::Site, String> {
    let site = sites::Site::from_path(&path)?;
    sites::mark_trusted(&site.path);
    {
        let mut p = state.persisted.lock().unwrap();
        if let Some(existing) = p.sites.iter().find(|s| s.path == site.path) {
            return Ok(existing.clone());
        }
        p.sites.insert(0, site.clone());
    }
    state.save()?;
    Ok(site)
}

#[tauri::command]
fn site_remove(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    state.persisted.lock().unwrap().sites.retain(|s| s.id != site_id);
    state.save()
}

#[tauri::command]
fn site_refresh(state: State<'_, AppState>, site_id: String) -> Result<sites::Site, String> {
    let mut p = state.persisted.lock().unwrap();
    let site = p.sites.iter_mut().find(|s| s.id == site_id).ok_or("unknown site")?;
    site.refresh()?;
    let out = site.clone();
    drop(p);
    state.save()?;
    Ok(out)
}

#[tauri::command]
async fn site_install(app: AppHandle, state: State<'_, AppState>, site_id: String) -> Result<sites::Site, String> {
    let site = state.site(&site_id)?;
    sites::run_install(app, &site, &state.path_env).await?;
    let mut p = state.persisted.lock().unwrap();
    let s = p.sites.iter_mut().find(|s| s.id == site_id).ok_or("unknown site")?;
    s.refresh()?;
    let out = s.clone();
    drop(p);
    state.save()?;
    Ok(out)
}

#[tauri::command]
async fn site_git_status(state: State<'_, AppState>, site_id: String) -> Result<sites::GitStatus, String> {
    let site = state.site(&site_id)?;
    let env = state.path_env.clone();
    tauri::async_runtime::spawn_blocking(move || sites::git_status(&site.path, &env)).await.map_err(|e| e.to_string())?
}

/// Shared by the `site_undo_files` command (the Undo button) and the debug smoke test.
pub(crate) async fn undo_files(app: &AppHandle, site_id: &str, files: Vec<String>, created: Vec<String>) -> Result<sites::RestoreReport, String> {
    let state = app.state::<AppState>();
    let site = state.site(site_id)?;
    let env = state.path_env.clone();
    tauri::async_runtime::spawn_blocking(move || sites::git_restore(&site.path, &files, &created, &env)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn site_undo_files(app: AppHandle, site_id: String, files: Vec<String>, created: Option<Vec<String>>) -> Result<sites::RestoreReport, String> {
    undo_files(&app, &site_id, files, created.unwrap_or_default()).await
}

/// Diagnostics from the preview pane (visible when the app is launched from a terminal).
#[tauri::command]
fn preview_event(kind: String, detail: String) {
    eprintln!("[preview] {kind}: {detail}");
}

/// `key` is "publish" (production) or "preview".
#[tauri::command]
fn site_set_publish(state: State<'_, AppState>, site_id: String, command: String, key: Option<String>) -> Result<sites::Site, String> {
    let site = state.site(&site_id)?;
    let key = match key.as_deref() { Some("preview") => "preview", _ => "publish" };
    sites::write_site_json(&site.path, key, &command)?;
    let mut p = state.persisted.lock().unwrap();
    let s = p.sites.iter_mut().find(|s| s.id == site_id).ok_or("unknown site")?;
    s.refresh()?;
    let out = s.clone();
    drop(p);
    state.save()?;
    Ok(out)
}

#[tauri::command]
async fn site_git_commit(state: State<'_, AppState>, site_id: String, message: String) -> Result<sites::GitStatus, String> {
    let site = state.site(&site_id)?;
    let env = state.path_env.clone();
    tauri::async_runtime::spawn_blocking(move || sites::git_commit(&site.path, &message, &env)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn site_git_diff(state: State<'_, AppState>, site_id: String, files: Vec<String>) -> Result<String, String> {
    let site = state.site(&site_id)?;
    let env = state.path_env.clone();
    tauri::async_runtime::spawn_blocking(move || sites::git_diff(&site.path, &files, &env)).await.map_err(|e| e.to_string())?
}

/// Screenshot of the preview region. `x, y, w, h` in CSS pixels (the webview's own coordinates).
#[tauri::command]
async fn preview_capture(app: AppHandle, x: f64, y: f64, w: f64, h: f64, _scale: f64) -> Result<Value, String> {
    use base64::Engine;
    let bytes = capture::capture_region(&app, x, y, w, h).await?;
    Ok(json!({ "mediaType": "image/png", "data": base64::engine::general_purpose::STANDARD.encode(&bytes), "bytes": bytes.len() }))
}

/// Open the site folder in the user's code editor (code, cursor, zed on PATH), else in Finder.
#[tauri::command]
async fn site_open_editor(state: State<'_, AppState>, site_id: String) -> Result<String, String> {
    let site = state.site(&site_id)?;
    let path_env = state.path_env.clone();
    let find = |bin: &str| path_env.split(':').map(|d| std::path::Path::new(d).join(bin)).find(|p| p.is_file());
    for bin in ["code", "cursor", "zed", "windsurf"] {
        if let Some(exe) = find(bin) {
            tokio::process::Command::new(exe).arg(&site.path).env("PATH", &path_env).spawn().map_err(|e| e.to_string())?;
            return Ok(bin.to_string());
        }
    }
    tokio::process::Command::new("open").arg(&site.path).spawn().map_err(|e| e.to_string())?;
    Ok("finder".into())
}

/// Dock badge with the number of approvals waiting (macOS); None clears it.
#[tauri::command]
fn set_badge(app: AppHandle, count: i64) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.set_badge_count(if count > 0 { Some(count) } else { None }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Bounce the Dock icon once when something needs the user and the window is in the background.
#[tauri::command]
fn request_attention(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.request_user_attention(Some(tauri::UserAttentionType::Informational)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn site_file(site: &sites::Site, rel: &str) -> Result<std::path::PathBuf, String> {
    let rel = rel.trim_start_matches('/');
    if rel.is_empty() || rel.split('/').any(|seg| seg == "..") { return Err("invalid path".into()); }
    Ok(std::path::Path::new(&site.path).join(rel))
}

/// Read a text file inside the site (used for CLAUDE.md editing). Empty string if it does not exist.
#[tauri::command]
fn site_read_text(state: State<'_, AppState>, site_id: String, rel: String) -> Result<String, String> {
    let site = state.site(&site_id)?;
    let path = site_file(&site, &rel)?;
    if !path.exists() { return Ok(String::new()); }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 512 * 1024 { return Err("That file is too large to edit here.".into()); }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_write_text(state: State<'_, AppState>, site_id: String, rel: String, content: String) -> Result<(), String> {
    let site = state.site(&site_id)?;
    let path = site_file(&site, &rel)?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_rename(state: State<'_, AppState>, site_id: String, name: String) -> Result<sites::Site, String> {
    let site = state.site(&site_id)?;
    let name = name.trim().to_string();
    if name.is_empty() { return Err("Give the site a name.".into()); }
    sites::write_site_json(&site.path, "name", &name)?;
    let mut p = state.persisted.lock().unwrap();
    let s = p.sites.iter_mut().find(|s| s.id == site_id).ok_or("unknown site")?;
    s.name = name;
    let out = s.clone();
    drop(p);
    state.save()?;
    Ok(out)
}

#[tauri::command]
async fn site_git_init(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    let site = state.site(&site_id)?;
    let env = state.path_env.clone();
    tauri::async_runtime::spawn_blocking(move || sites::git_init(&site.path, &env)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn site_favorite(state: State<'_, AppState>, site_id: String, on: bool) -> Result<sites::Site, String> {
    let out = {
        let mut p = state.persisted.lock().unwrap();
        let s = p.sites.iter_mut().find(|s| s.id == site_id).ok_or("unknown site")?;
        s.favorite = on;
        s.clone()
    };
    state.save()?;
    Ok(out)
}

/// The site was selected: stamp `last_opened` so the switcher can order by recency.
#[tauri::command]
fn site_opened(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    {
        let mut p = state.persisted.lock().unwrap();
        if let Some(s) = p.sites.iter_mut().find(|s| s.id == site_id) { s.last_opened = now; }
    }
    state.save()
}

#[tauri::command]
fn site_set_last_session(state: State<'_, AppState>, site_id: String, session_id: Option<String>) -> Result<(), String> {
    {
        let mut p = state.persisted.lock().unwrap();
        if let Some(s) = p.sites.iter_mut().find(|s| s.id == site_id) { s.last_session_id = session_id; }
    }
    state.save()
}

#[tauri::command]
async fn site_new(app: AppHandle, state: State<'_, AppState>, parent: String, name: String) -> Result<sites::Site, String> {
    let starter = starter_dir(&app).ok_or("starter template not found")?;
    let log_app = app.clone();
    let site = sites::create_from_starter(&starter, &parent, &name, &state.path_env, move |line| { let _ = log_app.emit("install://log", json!({ "siteId": null, "line": line })); }).await?;
    sites::mark_trusted(&site.path);
    {
        let mut p = state.persisted.lock().unwrap();
        p.sites.insert(0, site.clone());
    }
    state.save()?;
    Ok(site)
}

fn starter_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    // dev: <repo>/starters/next ; bundled: <resources>/starters/next
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../starters/next");
    if dev.join("package.json").exists() { return Some(dev); }
    let res = app.path().resource_dir().ok()?.join("starters/next");
    if res.join("package.json").exists() { Some(res) } else { None }
}

// ---------- dev server ----------

#[tauri::command]
async fn dev_start(app: AppHandle, state: State<'_, AppState>, site_id: String) -> Result<devserver::DevInfo, String> {
    let site = state.site(&site_id)?;
    let info = state.dev.start(app.clone(), site, state.path_env.clone()).await?;
    {
        let mut p = state.persisted.lock().unwrap();
        if let Some(s) = p.sites.iter_mut().find(|s| s.id == site_id) {
            if s.last_port != Some(info.port) { s.last_port = Some(info.port); drop(p); let _ = state.save(); }
        }
    }
    Ok(info)
}

#[tauri::command]
async fn dev_stop(app: AppHandle, state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    state.dev.stop(&app, &site_id).await
}

/// Stop whatever holds the port the site's dev command needs (see `devserver::Registry::free_blocked_port`).
#[tauri::command]
async fn dev_free_port(app: AppHandle, state: State<'_, AppState>, site_id: String) -> Result<String, String> {
    state.dev.free_blocked_port(&app, &site_id).await
}

#[tauri::command]
async fn dev_status(state: State<'_, AppState>, site_id: String) -> Result<Option<devserver::DevInfo>, String> {
    Ok(state.dev.status(&site_id).await)
}

#[tauri::command]
async fn dev_log(state: State<'_, AppState>, site_id: String) -> Result<Vec<String>, String> {
    Ok(state.dev.log(&site_id).await)
}

// ---------- publish ----------

/// `target` is "production" (default) or "preview".
#[tauri::command]
async fn publish_run(app: AppHandle, state: State<'_, AppState>, site_id: String, target: Option<String>) -> Result<Value, String> {
    let site = state.site(&site_id)?;
    let preview = target.as_deref() == Some("preview");
    let cmd = if preview { site.preview.clone().ok_or("No preview command set for this site.")? } else { site.publish.clone().ok_or("No publish command set for this site.")? };
    sites::run_publish(app, &site, &cmd, &state.path_env).await
}

#[tauri::command]
async fn site_git_push(state: State<'_, AppState>, site_id: String) -> Result<String, String> {
    let site = state.site(&site_id)?;
    let env = state.path_env.clone();
    tauri::async_runtime::spawn_blocking(move || sites::git_push(&site.path, &env)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn publish_cancel(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    let pid = state.publishes.lock().await.get(&site_id).copied().ok_or("no publish is running")?;
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
        libc::kill(pid as i32, libc::SIGTERM);
    }
    Ok(())
}

// ---------- agent ----------

/// Shared by the `agent_start` command and the debug smoke test.
pub(crate) async fn start_agent(app: &AppHandle, site_id: &str, resume: Option<String>, overrides: Option<agent::claude::Overrides>) -> Result<String, String> {
    let state = app.state::<AppState>();
    let site = state.site(site_id)?;
    let (configured, model, mode, effort, fast_mode) = {
        let p = state.persisted.lock().unwrap();
        (p.claude_path.clone(), p.model.clone(), p.permission_mode.clone(), p.effort.clone(), p.fast_mode)
    };
    // The session's own choices win over the Settings defaults.
    let o = overrides.unwrap_or_default();
    let model = o.model.filter(|m| !m.is_empty()).or(model);
    let effort = o.effort.filter(|e| !e.is_empty()).or(effort);
    let fast_mode = o.fast_mode.unwrap_or(fast_mode);
    #[cfg(debug_assertions)]
    let model = std::env::var("SUPASITO_SMOKE_MODEL").ok().or(model);
    #[cfg(debug_assertions)]
    let effort = std::env::var("SUPASITO_SMOKE_EFFORT").ok().or(effort);
    #[cfg(debug_assertions)]
    let fast_mode = std::env::var("SUPASITO_SMOKE_FAST").map(|v| v == "1").unwrap_or(fast_mode);
    let claude_path = agent::claude::locate(configured.as_deref(), &state.path_env).await.ok_or("Claude Code was not found. Install it from https://claude.com/claude-code and sign in, or set its path in Settings.")?;
    let preview = state.dev.status(site_id).await.map(|d| d.url);
    let session_id = resume.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let opts = agent::claude::StartOpts {
        session_id: session_id.clone(),
        site_id: site_id.to_string(),
        cwd: site.path.clone(),
        resume: resume.is_some(),
        model,
        effort,
        fast_mode,
        permission_mode: mode,
        system_append: agent::system_prompt(&site, preview.as_deref()),
        claude_path,
        path_env: state.path_env.clone(),
    };
    state.agents.start(app.clone(), opts).await?;
    Ok(session_id)
}

#[tauri::command]
async fn agent_start(app: AppHandle, site_id: String, resume: Option<String>, overrides: Option<agent::claude::Overrides>) -> Result<String, String> {
    start_agent(&app, &site_id, resume, overrides).await
}

/// Both return the control request id; a rejection reaches the UI as `agent://control_error` with that id.
#[tauri::command]
async fn agent_set_model(state: State<'_, AppState>, session_id: String, model: String) -> Result<String, String> {
    let h = state.agents.get(&session_id).await.ok_or("session is not running")?;
    h.set_model(&model).await
}

#[tauri::command]
async fn agent_apply_settings(state: State<'_, AppState>, session_id: String, settings: Value) -> Result<String, String> {
    let h = state.agents.get(&session_id).await.ok_or("session is not running")?;
    h.apply_settings(settings).await
}

#[tauri::command]
async fn agent_send(state: State<'_, AppState>, session_id: String, text: String, selection: Option<Value>, images: Option<Vec<agent::ImageIn>>) -> Result<(), String> {
    let h = state.agents.get(&session_id).await.ok_or("session is not running")?;
    h.send_user(agent::compose_user_content(&text, selection.as_ref(), &images.unwrap_or_default())).await
}

#[tauri::command]
async fn agent_respond(state: State<'_, AppState>, session_id: String, request_id: String, response: Value) -> Result<(), String> {
    let h = state.agents.get(&session_id).await.ok_or("session is not running")?;
    h.respond(&request_id, response).await
}

#[tauri::command]
async fn agent_set_mode(state: State<'_, AppState>, session_id: String, mode: String) -> Result<(), String> {
    let h = state.agents.get(&session_id).await.ok_or("session is not running")?;
    h.set_permission_mode(&mode).await
}

#[tauri::command]
async fn agent_interrupt(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let h = state.agents.get(&session_id).await.ok_or("session is not running")?;
    h.interrupt().await
}

#[tauri::command]
async fn agent_stop(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.agents.stop(&session_id).await
}

#[tauri::command]
async fn agent_running(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    Ok(state.agents.running().await)
}

#[tauri::command]
async fn sessions_list(state: State<'_, AppState>, site_id: String) -> Result<Vec<agent::sessions::SessionInfo>, String> {
    let site = state.site(&site_id)?;
    tauri::async_runtime::spawn_blocking(move || agent::sessions::list(&site.path)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn session_transcript(state: State<'_, AppState>, site_id: String, session_id: String) -> Result<Vec<Value>, String> {
    let site = state.site(&site_id)?;
    tauri::async_runtime::spawn_blocking(move || agent::sessions::transcript(&site.path, &session_id)).await.map_err(|e| e.to_string())?
}

// ---------- app ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::load(app.handle())?;
            app.manage(state);
            #[cfg(debug_assertions)]
            if let Ok(prompt) = std::env::var("SUPASITO_SMOKE_PROMPT") {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move { smoke::run(handle, prompt).await });
            }
            let builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Supasito")
                .inner_size(1440.0, 900.0)
                .min_inner_size(980.0, 620.0)
                .initialization_script_for_all_frames(PICKER_JS)
                // Let the page handle HTML5 drag and drop itself (images dropped into the composer).
                .disable_drag_drop_handler();
            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
            builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_get, settings_set, toolchain_check,
            sites_list, site_pick_folder, site_add, site_remove, site_refresh, site_install, site_git_status, site_git_init, site_read_text, site_write_text, site_rename, site_git_commit, site_git_diff, site_git_push, site_undo_files, preview_event, site_set_publish, set_badge, request_attention, preview_capture, site_open_editor, site_set_last_session, site_favorite, site_opened, site_new,
            dev_start, dev_stop, dev_status, dev_log, dev_free_port,
            publish_run, publish_cancel,
            agent_start, agent_send, agent_respond, agent_set_mode, agent_set_model, agent_apply_settings, agent_interrupt, agent_stop, agent_running,
            sessions_list, session_transcript
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<AppState>();
                let agents = &state.agents;
                let dev = &state.dev;
                tauri::async_runtime::block_on(async {
                    agents.stop_all().await;
                    dev.stop_all().await;
                });
                let _ = app.emit("app://exiting", ());
            }
        });
}
