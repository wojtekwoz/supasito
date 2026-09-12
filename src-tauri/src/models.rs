//! The model catalogue: what the picker offers, fetched rather than typed in (PLAN §8d.1).
//!
//! Codex reports its models over the protocol (`model/list`, verified codex-cli 0.154.0 on 2026-09-12,
//! recorded in src/agent/fixtures/codex-0.154.0-model-list.json). Claude Code has nothing of the kind —
//! `--model` takes an alias or an id and nothing enumerates them — so its list rides on the one request the
//! app already makes: `models.json` next to the update manifest, fetched right after it, same host, no
//! identifier. Both land in the app state so the picker is right before any fetch returns and when offline;
//! the built-in list in src/models.ts is the floor when nothing was ever fetched.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

/// One row of the picker. The same shape for both agents, which is what src/models.ts reads.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Model {
    pub id: String,
    pub label: String,
    pub hint: String,
    /// `claude` or `codex`: which CLI runs a session on this model.
    pub backend: String,
    /// What a session on this backend runs on when no model was chosen (Codex's `isDefault`).
    pub is_default: bool,
    /// The efforts this model accepts; empty means the backend's fixed list.
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
    /// Fast mode exists for this model (Codex: the `priority` service tier is listed).
    pub fast: bool,
    /// Codex marks retired or preview models hidden; they stay out of the picker.
    pub hidden: bool,
}

/// What was fetched and when (ms since the epoch; 0 = never).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Catalogue {
    pub codex: Vec<Model>,
    pub codex_at: i64,
    /// The served file's rows, either backend; Claude's come only from here.
    pub served: Vec<Model>,
    pub served_at: i64,
}

/// Where the Claude catalogue is served from: the site first, the release assets when the site 404s or is down.
const SERVED_URLS: [&str; 2] = [
    "https://supasito.com/updates/models.json",
    "https://github.com/wojtekwoz/supasito/releases/latest/download/models.json",
];

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// The rows in a `model/list` reply. `displayName` is "GPT-6-Astra"; the dashes between the family and
/// the name read better as a space, and the id stays the truth.
pub fn from_codex_list(reply: &Value) -> Vec<Model> {
    let rows = reply.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    rows.iter()
        .filter_map(|m| {
            let id = m.get("id").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty())?.to_string();
            let label = codex_label(m.get("displayName").and_then(|v| v.as_str()).unwrap_or(&id));
            let efforts = m
                .get("supportedReasoningEfforts")
                .and_then(|e| e.as_array())
                .map(|a| a.iter().filter_map(|e| e.get("reasoningEffort").and_then(|r| r.as_str()).or_else(|| e.as_str()).map(String::from)).collect())
                .unwrap_or_default();
            let fast = m
                .get("serviceTiers")
                .and_then(|t| t.as_array())
                .map(|a| a.iter().any(|t| t.get("id").and_then(|i| i.as_str()).or_else(|| t.as_str()) == Some("priority")))
                .unwrap_or(false);
            Some(Model {
                id,
                label,
                hint: m.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                backend: "codex".into(),
                is_default: m.get("isDefault").and_then(|v| v.as_bool()).unwrap_or(false),
                efforts,
                default_effort: m.get("defaultReasoningEffort").and_then(|v| v.as_str()).map(String::from),
                fast,
                hidden: m.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        })
        .collect()
}

/// `GPT-6-Astra` → `GPT-6 Astra`, `GPT-5.3-Codex-Spark` → `GPT-5.3 Codex Spark`; a name without the family prefix stays.
fn codex_label(display: &str) -> String {
    // the family is everything up to the first dash between a digit and a letter (the version keeps its dots)
    let bytes = display.as_bytes();
    let mut cut = None;
    for i in 1..bytes.len().saturating_sub(1) {
        if bytes[i] == b'-' && bytes[i + 1].is_ascii_alphabetic() && bytes[i - 1].is_ascii_digit() {
            cut = Some(i);
            break;
        }
    }
    match cut {
        Some(i) => format!("{} {}", &display[..i], display[i + 1..].replace('-', " ")),
        None => display.to_string(),
    }
}

/// The served file: `{ "models": [ …rows… ] }`, rows in the `Model` shape. Unknown fields are ignored, rows
/// without an id dropped, so a hand-edited file cannot take the picker down.
pub fn from_served(json: &Value) -> Vec<Model> {
    json.get("models")
        .and_then(|m| m.as_array())
        .map(|a| a.iter().filter_map(|r| serde_json::from_value::<Model>(r.clone()).ok()).filter(|m| !m.id.trim().is_empty()).collect())
        .unwrap_or_default()
}

/// Ask the endpoints for `models.json`, the site first. The app's version rides in the query the way the
/// update check's does, and nothing else. Errors are the caller's to log; an empty file is not an error.
pub async fn fetch_served(version: &str) -> Result<Vec<Model>, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let mut last = String::from("no endpoint answered");
    for (i, url) in SERVED_URLS.iter().enumerate() {
        let url = if i == 0 { format!("{url}?v={version}") } else { url.to_string() };
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => return Ok(from_served(&v)),
                Err(e) => last = format!("{url}: {e}"),
            },
            Ok(r) => last = format!("{url}: HTTP {}", r.status()),
            Err(e) => last = format!("{url}: {e}"),
        }
    }
    Err(last)
}

/// Fetch the served catalogue and remember it. Called after the daily update check and by "Check now".
pub async fn refresh_served(app: &AppHandle) -> Result<(), String> {
    let version = app.package_info().version.to_string();
    let rows = fetch_served(&version).await?;
    let state = app.state::<AppState>();
    {
        let mut p = state.persisted.lock().unwrap();
        p.models.served = rows;
        p.models.served_at = now_ms();
    }
    state.save()
}

/// The Codex default from the cache, for a session started with no model chosen; None when never fetched.
pub fn codex_default(cat: &Catalogue) -> Option<String> {
    cat.codex.iter().find(|m| m.is_default && !m.hidden).map(|m| m.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = include_str!("../../src/agent/fixtures/codex-0.154.0-model-list.json");

    #[test]
    fn parses_the_recorded_model_list() {
        let rows = from_codex_list(&serde_json::from_str(LIST).unwrap());
        assert_eq!(rows.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.3-codex-spark"]);
        let astra = &rows[0];
        assert!(astra.is_default);
        assert_eq!(astra.label, "GPT-6 Astra");
        assert_eq!(astra.efforts, ["low", "medium", "high", "xhigh", "max", "ultra"]);
        assert_eq!(astra.default_effort.as_deref(), Some("medium"));
        assert!(astra.fast);
        assert_eq!(astra.backend, "codex");
        // Luna has no `ultra`; Spark lists no service tier, so no Fast
        assert_eq!(rows[3].efforts.last().map(String::as_str), Some("max"));
        let spark = &rows[5];
        assert!(!spark.fast);
        assert_eq!(spark.label, "GPT-5.3 Codex Spark");
        assert_eq!(spark.efforts.last().map(String::as_str), Some("xhigh"));
        assert!(rows.iter().all(|m| !m.hidden));
        assert_eq!(codex_default(&Catalogue { codex: rows, ..Default::default() }).as_deref(), Some("gpt-6-astra"));
    }

    #[test]
    fn served_rows_tolerate_junk() {
        let v: Value = serde_json::from_str(r#"{"models":[{"id":"claude-opus-5","label":"Opus 5","hint":"strong","backend":"claude","fast":true,"extra":1},{"label":"no id"},"junk"]}"#).unwrap();
        let rows = from_served(&v);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "claude-opus-5");
        assert!(rows[0].fast);
        assert!(rows[0].efforts.is_empty());
        assert!(from_served(&Value::Null).is_empty());
    }

    #[test]
    fn labels() {
        assert_eq!(codex_label("GPT-6-Astra"), "GPT-6 Astra");
        assert_eq!(codex_label("GPT-5.6-Sol"), "GPT-5.6 Sol");
        assert_eq!(codex_label("GPT-5.5"), "GPT-5.5");
        assert_eq!(codex_label("o3"), "o3");
    }
}
