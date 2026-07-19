use serde::Serialize;
use serde_json::Value;
use std::{
    io::BufRead,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    id: String,
    name: Option<String>,
    path: String,
    cwd: Option<String>,
    created_at: u64,
    modified_at: u64,
    message_count: usize,
    tokens: u64,
    cost: f64,
}

fn sessions_root() -> Result<PathBuf, String> {
    if let Ok(base) = std::env::var("PI_CODING_AGENT_DIR") {
        return Ok(PathBuf::from(base).join("sessions"));
    }
    dirs::home_dir()
        .map(|home| home.join(".pi/agent/sessions"))
        .ok_or("Unable to find the Pi sessions directory".into())
}

fn timestamp(metadata: &std::fs::Metadata, created: bool) -> u64 {
    let value = if created {
        metadata.created().or_else(|_| metadata.modified())
    } else {
        metadata.modified()
    };
    value
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|v| v.as_secs())
        .unwrap_or(0)
}

fn parse_session(path: &Path) -> Result<SessionInfo, String> {
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("Session file exceeds the indexing limit".into());
    }
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut id = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("session")
        .to_string();
    let mut name = None;
    let mut cwd = None;
    let mut message_count = 0;
    let mut tokens = 0;
    let mut cost = 0.0;
    for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(value_id) = value.get("id").and_then(Value::as_str) {
            if value.get("type").and_then(Value::as_str) == Some("session") {
                id = value_id.to_string();
            }
        }
        if name.is_none() {
            name = value
                .get("name")
                .or_else(|| value.get("sessionName"))
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        if cwd.is_none() {
            cwd = value.get("cwd").and_then(Value::as_str).map(str::to_string);
        }
        if value.get("type").and_then(Value::as_str) == Some("message")
            || value.get("role").is_some()
        {
            message_count += 1;
        }
        let usage = value
            .pointer("/message/usage")
            .or_else(|| value.get("usage"));
        if let Some(usage) = usage {
            tokens += usage
                .get("totalTokens")
                .or_else(|| usage.get("total_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            cost += usage
                .pointer("/cost/total")
                .or_else(|| usage.get("cost"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
        }
    }
    Ok(SessionInfo {
        id,
        name,
        path: path.to_string_lossy().into_owned(),
        cwd,
        created_at: timestamp(&metadata, true),
        modified_at: timestamp(&metadata, false),
        message_count,
        tokens,
        cost,
    })
}

#[tauri::command]
pub fn list_sessions() -> Result<Vec<SessionInfo>, String> {
    let root = sessions_root()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = WalkDir::new(root)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry.path().extension().and_then(|v| v.to_str()) == Some("jsonl")
        })
        .take(10_000)
        .filter_map(|entry| parse_session(entry.path()).ok())
        .collect::<Vec<_>>();
    sessions.sort_by_key(|session| std::cmp::Reverse(session.modified_at));
    Ok(sessions)
}

#[tauri::command]
pub fn delete_session(session_path: String) -> Result<(), String> {
    let root = std::fs::canonicalize(sessions_root()?).map_err(|error| error.to_string())?;
    let target = std::fs::canonicalize(&session_path).map_err(|error| error.to_string())?;
    if !target.starts_with(root)
        || target.extension().and_then(|value| value.to_str()) != Some("jsonl")
    {
        return Err("Session path is outside the Pi sessions directory".into());
    }
    std::fs::remove_file(target).map_err(|error| format!("Unable to delete session: {error}"))
}
