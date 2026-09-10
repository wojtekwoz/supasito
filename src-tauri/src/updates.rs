//! Checking for a newer Supasito and installing it.
//!
//! The check is the only request the app makes on its own. It goes to the endpoints in
//! `tauri.conf.json` (supasito.com first, GitHub Releases as the fallback), carries the version,
//! target and arch in the URL and nothing else — no identifier, no cookie, no event — and it runs at
//! most once a day. Settings → Updates turns it off. Debug builds never check on their own so a
//! `pnpm tauri dev` session does not count as an install; "Check now" still works there.

use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::AppState;

/// How often the app asks. One check per install per day is also what makes the count on the other
/// end mean "installs that ran today".
#[cfg(not(debug_assertions))]
const EVERY_MS: i64 = 24 * 60 * 60 * 1000;
/// Long enough after launch that the check never competes with the first paint.
#[cfg(not(debug_assertions))]
const AFTER_LAUNCH: Duration = Duration::from_secs(8);

/// What the last check found, so Install does not have to ask again.
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

/// A newer version, as the UI sees it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Ask the endpoints. `Ok(None)` means this is the newest version.
async fn look(app: &AppHandle) -> Result<Option<Available>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| e.to_string())?;
    {
        // The guard must be dropped before `save`, which locks `persisted` again.
        let state = app.state::<AppState>();
        state.persisted.lock().unwrap().update_checked_at = now_ms();
        let _ = state.save();
    }
    let pending = app.state::<Pending>();
    match found {
        Some(u) => {
            let seen = Available {
                version: u.version.clone(),
                current: u.current_version.clone(),
                notes: u.body.clone(),
                date: u.date.map(|d| d.to_string()),
            };
            *pending.0.lock().unwrap() = Some(u);
            Ok(Some(seen))
        }
        None => {
            *pending.0.lock().unwrap() = None;
            Ok(None)
        }
    }
}

/// Settings → Updates, "Check now". Reports the error, unlike the daily check.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Available>, String> {
    look(&app).await
}

/// Download the update found by the last check, verify its signature, replace this app and restart.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app.state::<Pending>().0.lock().unwrap().clone();
    let Some(update) = update else {
        return Err("Nothing to install. Check for an update first.".into());
    };
    let progress = app.clone();
    let mut got: usize = 0;
    update
        .download_and_install(
            move |chunk, total| {
                got += chunk;
                let _ = progress.emit("update://progress", json!({ "got": got, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    // macOS installs in place; the new version only runs after a relaunch.
    app.restart()
}

/// "Not now" for this version: the banner stays away until a later one appears.
#[tauri::command]
pub fn update_dismiss(app: AppHandle, version: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.persisted.lock().unwrap().update_skipped = Some(version);
    state.save()
}

/// The version this app was built as, for Settings.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The daily check. Announces a newer version once with `update://available`; a version the user
/// dismissed is not announced again. Release builds only — a dev session is not an install.
pub fn watch(app: AppHandle) {
    #[cfg(debug_assertions)]
    let _ = app;
    #[cfg(not(debug_assertions))]
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(AFTER_LAUNCH).await;
        loop {
            let (enabled, last) = {
                let state = app.state::<AppState>();
                let p = state.persisted.lock().unwrap();
                (p.updates_enabled, p.update_checked_at)
            };
            if enabled && now_ms() - last >= EVERY_MS {
                match look(&app).await {
                    Ok(Some(found)) => {
                        let skipped = {
                            app.state::<AppState>().persisted.lock().unwrap().update_skipped.clone()
                        };
                        if skipped.as_deref() != Some(found.version.as_str()) {
                            let _ = app.emit("update://available", found);
                        }
                    }
                    // Offline, or the endpoints are down: nothing to say, try again in an hour.
                    Ok(None) => {}
                    Err(e) => log_check_error(&e),
                }
            }
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
        }
    });
}

#[cfg(not(debug_assertions))]
fn log_check_error(e: &str) {
    eprintln!("update check failed: {e}");
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    /// The updater refuses any package not signed by the key behind the `pubkey` in tauri.conf.json, and a
    /// mismatch is invisible until an update fails to install on someone else's Mac. This runs the same check
    /// the shipped app will run, against the artifacts `pnpm release` just built.
    ///
    /// `cargo test -- --ignored updater_package_verifies` after a release build.
    #[test]
    #[ignore = "needs the artifacts from a release build"]
    fn updater_package_verifies_against_the_shipped_pubkey() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let tarball = root.join("target/release/bundle/macos/Supasito.app.tar.gz");
        let sig = tarball.with_extension("gz.sig");
        assert!(tarball.exists(), "no {tarball:?} — run `pnpm release` first");

        let conf: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("tauri.conf.json")).unwrap()).unwrap();
        let shipped = conf["plugins"]["updater"]["pubkey"].as_str().expect("no pubkey in tauri.conf.json");
        let decoded = base64::engine::general_purpose::STANDARD.decode(shipped).unwrap();
        let key = minisign_verify::PublicKey::decode(std::str::from_utf8(&decoded).unwrap().trim()).unwrap();

        let armored = std::fs::read_to_string(&sig).expect("no .sig — was TAURI_SIGNING_PRIVATE_KEY set?");
        let armored = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(armored.trim()).unwrap()).unwrap();
        let signature = minisign_verify::Signature::decode(&armored).unwrap();
        key.verify(&std::fs::read(&tarball).unwrap(), &signature, true)
            .expect("the release was signed with a key the shipped pubkey does not match");
    }
}
