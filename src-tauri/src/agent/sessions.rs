//! Reads Claude Code's own session store (~/.claude/projects/<encoded cwd>/*.jsonl)
//! so Supasito never duplicates transcripts.

use std::{io::{BufRead, BufReader}, path::PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::sites::Continuation;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub last_modified: u64,
    pub created_at: Option<u64>,
    pub git_branch: Option<String>,
    pub message_count: usize,
    /// The backend sessions this row stands for, oldest first, when it is the tail of a conversation that
    /// changed agent (PLAN §8d.2); empty for a plain session. The UI replays each in order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub chain: Vec<ChainStep>,
}

/// One session of a chain and the model it started on (None for the head, or when the link did not say).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChainStep {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// One conversation, several backend sessions: a session that another one continues is hidden behind that
/// successor, and the tail row carries the head's title and `created_at`, the tail's `last_modified`, the
/// summed `message_count` and the whole chain. A session is hidden only when a later member of its chain is
/// *in the list* (Codex uninstalled or its list failing must not make a conversation vanish; a middle
/// segment Claude Code cleaned up must not bring the head back as a second row); with two successors the
/// newer one hides the head and the other stays a row of its own. Order is kept: the caller sorts.
pub fn fold_chains(list: Vec<SessionInfo>, links: &[Continuation]) -> Vec<SessionInfo> {
    use std::collections::{HashMap, HashSet};
    if links.is_empty() { return list; }
    let present: HashSet<&str> = list.iter().map(|s| s.id.as_str()).collect();
    // successor per session: the newest link away from it
    let mut successor: HashMap<&str, &Continuation> = HashMap::new();
    for l in links.iter().filter(|l| l.id != l.continues) {
        let newer = successor.get(l.continues.as_str()).map(|s| l.at >= s.at).unwrap_or(true);
        if newer { successor.insert(l.continues.as_str(), l); }
    }
    // hidden when walking the successors from it reaches a session that is in the list
    let hidden = |id: &str| {
        let mut cur = id;
        for _ in 0..50 {
            let Some(next) = successor.get(cur).map(|l| l.id.as_str()) else { return false };
            if present.contains(next) { return true; }
            if next == id { return false; }
            cur = next;
        }
        false
    };
    let continues: HashMap<&str, &Continuation> = links.iter().map(|l| (l.id.as_str(), l)).collect();
    let by_id: HashMap<&str, &SessionInfo> = list.iter().map(|s| (s.id.as_str(), s)).collect();
    let mut out = Vec::with_capacity(list.len());
    for s in &list {
        if hidden(&s.id) { continue; }
        if !continues.contains_key(s.id.as_str()) { out.push(s.clone()); continue; }
        // walk back to the head (a link may name a session no longer on disk: it stays in the chain and the UI says so)
        let mut chain: Vec<ChainStep> = Vec::new();
        let mut cur = s.id.as_str();
        loop {
            let link = continues.get(cur).copied();
            chain.push(ChainStep { id: cur.to_string(), model: link.and_then(|l| l.model.clone()) });
            let Some(prev) = link.map(|l| l.continues.as_str()) else { break };
            if chain.len() > 50 || chain.iter().any(|c| c.id == prev) { break; }
            cur = prev;
        }
        chain.reverse();
        let members: Vec<&SessionInfo> = chain.iter().filter_map(|c| by_id.get(c.id.as_str()).copied()).collect();
        let head = members.first().copied().unwrap_or(s);
        out.push(SessionInfo {
            id: s.id.clone(),
            title: head.title.clone(),
            last_modified: s.last_modified,
            created_at: head.created_at.or(s.created_at),
            git_branch: s.git_branch.clone().or_else(|| head.git_branch.clone()),
            message_count: members.iter().map(|m| m.message_count).sum(),
            chain,
        });
    }
    out
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
        out.push(SessionInfo { id, title: t, last_modified, created_at, git_branch, message_count, chain: Vec::new() });
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

pub fn squash(s: &str) -> String {
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
    use super::*;

    fn s(id: &str, title: &str, t: u64, n: usize) -> SessionInfo {
        SessionInfo { id: id.into(), title: title.into(), last_modified: t, created_at: Some(t.saturating_sub(100)), git_branch: None, message_count: n, chain: Vec::new() }
    }
    fn link(id: &str, continues: &str, at: u64) -> Continuation { Continuation { id: id.into(), continues: continues.into(), at, model: Some(format!("m-{id}")) } }
    fn ids(c: &[ChainStep]) -> Vec<&str> { c.iter().map(|s| s.id.as_str()).collect() }

    #[test]
    fn a_chain_is_one_row_with_the_heads_title() {
        let list = vec![s("codex:tail", "Handed over", 300, 2), s("mid", "Continuing…", 200, 4), s("head", "Roll out the Card style", 100, 6), s("other", "Pricing FAQ", 50, 1)];
        let links = [link("mid", "head", 150), link("codex:tail", "mid", 250)];
        let out = fold_chains(list, &links);
        assert_eq!(out.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["codex:tail", "other"]);
        let tail = &out[0];
        assert_eq!(tail.title, "Roll out the Card style");
        assert_eq!(tail.created_at, Some(0));
        assert_eq!(tail.last_modified, 300);
        assert_eq!(tail.message_count, 12);
        assert_eq!(ids(&tail.chain), ["head", "mid", "codex:tail"]);
        assert_eq!(tail.chain.iter().map(|c| c.model.as_deref()).collect::<Vec<_>>(), [None, Some("m-mid"), Some("m-codex:tail")]);
        assert!(out[1].chain.is_empty());
    }

    #[test]
    fn the_head_stays_when_its_successor_is_missing_from_the_list() {
        // Codex uninstalled: the tail is not listed, so the Claude head must still show
        let out = fold_chains(vec![s("head", "Head", 100, 3)], &[link("codex:tail", "head", 150)]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "head");
        assert!(out[0].chain.is_empty());
    }

    #[test]
    fn a_missing_head_is_still_in_the_chain() {
        // Claude Code cleaned up the head's JSONL: the tail is a row, titled as itself, and the chain names the head so the UI can say so
        let out = fold_chains(vec![s("codex:tail", "Handed over", 300, 2)], &[link("codex:tail", "head", 250)]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "Handed over");
        assert_eq!(ids(&out[0].chain), ["head", "codex:tail"]);
        assert_eq!(out[0].message_count, 2);
    }

    #[test]
    fn a_missing_middle_segment_still_hides_the_head() {
        // Claude Code cleaned up `mid`: the head must not come back as a second row next to the tail
        let list = vec![s("codex:tail", "Handed over", 300, 2), s("head", "Head", 100, 6)];
        let links = [link("mid", "head", 150), link("codex:tail", "mid", 250)];
        let out = fold_chains(list, &links);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "codex:tail");
        assert_eq!(out[0].title, "Head");
        assert_eq!(ids(&out[0].chain), ["head", "mid", "codex:tail"]);
        assert_eq!(out[0].message_count, 8);
    }

    #[test]
    fn two_successors_keep_the_newer_and_leave_the_other_visible() {
        let list = vec![s("b", "B", 300, 1), s("a", "A", 200, 1), s("head", "Head", 100, 1)];
        let links = [link("a", "head", 150), link("b", "head", 250)];
        let out = fold_chains(list, &links);
        assert_eq!(out.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(out[0].title, "Head");
        assert_eq!(ids(&out[1].chain), ["head", "a"]);
    }

    #[test]
    fn no_links_no_change() {
        let list = vec![s("x", "X", 1, 1)];
        assert_eq!(fold_chains(list.clone(), &[]), list);
    }

    #[test]
    fn encodes_cwd_like_claude_code() {
        assert_eq!(super::encode("/Users/you/site/.claude/worktrees/x"), "-Users-you-site--claude-worktrees-x");
        assert_eq!(super::encode("/Users/you/my-site"), "-Users-you-my-site");
    }
}
