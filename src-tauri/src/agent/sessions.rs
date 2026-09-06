//! Reads Claude Code's own session store (~/.claude/projects/<encoded cwd>/*.jsonl)
//! so Supasito never duplicates transcripts.

use std::{io::{BufRead, BufReader}, path::PathBuf};

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub last_modified: u64,
    pub created_at: Option<u64>,
    pub git_branch: Option<String>,
    pub message_count: usize,
}

fn encode(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

pub fn project_dir(cwd: &str) -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("projects").join(encode(cwd)))
}

fn first_text(msg: &Value) -> Option<String> {
    let content = msg.pointer("/message/content")?;
    if let Some(s) = content.as_str() { return Some(s.to_string()); }
    for block in content.as_array()? {
        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = block.get("text").and_then(|t| t.as_str()) { return Some(t.to_string()); }
        }
    }
    None
}

fn is_real_user_message(v: &Value) -> bool {
    v.get("type").and_then(|t| t.as_str()) == Some("user")
        && v.get("isMeta").and_then(|b| b.as_bool()) != Some(true)
        && v.get("isSidechain").and_then(|b| b.as_bool()) != Some(true)
        && v.pointer("/message/role").and_then(|r| r.as_str()) == Some("user")
        && first_text(v).map(|t| !t.trim_start().starts_with('<') && !t.trim().is_empty()).unwrap_or(false)
}

pub fn list(cwd: &str) -> Vec<SessionInfo> {
    let Some(dir) = project_dir(cwd) else { return vec![] };
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jsonl") || name.starts_with("agent-") { continue; }
        let id = name.trim_end_matches(".jsonl").to_string();
        let Ok(meta) = entry.metadata() else { continue };
        let last_modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        let Ok(file) = std::fs::File::open(&path) else { continue };
        let reader = BufReader::new(file);
        let mut title: Option<String> = None;
        let mut custom_title: Option<String> = None;
        let mut created_at: Option<u64> = None;
        let mut git_branch: Option<String> = None;
        let mut message_count = 0usize;
        for line in reader.lines().take(4000) {
            let Ok(line) = line else { break };
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            match v.get("type").and_then(|t| t.as_str()) {
                Some("custom-title") | Some("custom_title") => {
                    custom_title = v.get("customTitle").or(v.get("title")).and_then(|t| t.as_str()).map(|s| s.to_string());
                }
                Some("user") => {
                    if is_real_user_message(&v) {
                        message_count += 1;
                        if title.is_none() {
                            title = first_text(&v).map(|t| squash(&t));
                            created_at = v.get("timestamp").and_then(|t| t.as_str()).and_then(parse_ts);
                            git_branch = v.get("gitBranch").and_then(|b| b.as_str()).map(|s| s.to_string());
                        }
                    }
                }
                Some("assistant") => { message_count += 1; }
                _ => {}
            }
        }
        let Some(t) = custom_title.or(title) else { continue };
        out.push(SessionInfo { id, title: t, last_modified, created_at, git_branch, message_count });
    }
    out.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    out
}

/// The user/assistant lines of a session, in order, for re-rendering a resumed session.
pub fn transcript(cwd: &str, session_id: &str) -> Result<Vec<Value>, String> {
    let dir = project_dir(cwd).ok_or("no home dir")?;
    let path = dir.join(format!("{session_id}.jsonl"));
    let file = std::fs::File::open(&path).map_err(|e| format!("cannot read session: {e}"))?;
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let t = v.get("type").and_then(|t| t.as_str());
        if v.get("isSidechain").and_then(|b| b.as_bool()) == Some(true) { continue; }
        match t {
            Some("user") => {
                if v.get("isMeta").and_then(|b| b.as_bool()) == Some(true) { continue; }
                // keep tool_result messages and real user prompts; drop system-injected text
                let is_tool_result = v.pointer("/message/content").and_then(|c| c.as_array()).map(|a| a.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))).unwrap_or(false);
                if is_tool_result || is_real_user_message(&v) { out.push(v); }
            }
            Some("assistant") => out.push(v),
            // a compaction boundary lets the UI reset its context estimate and say so
            Some("system") if v.get("subtype").and_then(|s| s.as_str()) == Some("compact_boundary") => out.push(v),
            _ => {}
        }
    }
    Ok(out)
}

fn squash(s: &str) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > 90 { format!("{}…", one.chars().take(90).collect::<String>()) } else { one }
}

fn parse_ts(s: &str) -> Option<u64> {
    // 2026-08-20T16:00:34.895Z → epoch millis (good enough: date + time, UTC)
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let (y, m, day): (i64, i64, i64) = (d.next()?.parse().ok()?, d.next()?.parse().ok()?, d.next()?.parse().ok()?);
    let time = time.trim_end_matches('Z');
    let mut t = time.split(':');
    let (h, mi): (i64, i64) = (t.next()?.parse().ok()?, t.next()?.parse().ok()?);
    let sec: f64 = t.next()?.parse().ok()?;
    // days from civil (Howard Hinnant)
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days as f64 * 86400.0 + h as f64 * 3600.0 + mi as f64 * 60.0 + sec;
    Some((secs * 1000.0) as u64)
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodes_cwd_like_claude_code() {
        assert_eq!(super::encode("/Users/you/site/.claude/worktrees/x"), "-Users-you-site--claude-worktrees-x");
        assert_eq!(super::encode("/Users/you/my-site"), "-Users-you-my-site");
    }
}
