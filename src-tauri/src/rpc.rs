use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::Arc};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};

const DEFAULT_INSTANCE: &str = "main";

#[derive(Default)]
pub struct RpcState {
    processes: Mutex<HashMap<String, RpcProcess>>,
    generations: Mutex<HashMap<String, u64>>,
}

struct RpcProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    generation: u64,
    pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcStartOptions {
    pub cwd: String,
    pub pi_path: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcStartResult {
    instance_id: String,
    generation: u64,
    executable: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcEventPayload {
    instance_id: String,
    generation: u64,
    line: String,
}

fn valid_instance_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn discover_pi(override_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = override_path.filter(|p| !p.trim().is_empty()) {
        let expanded = expand_home(path);
        if expanded.is_file() {
            return Ok(expanded);
        }
        return Err(format!(
            "Configured Pi executable does not exist: {}",
            expanded.display()
        ));
    }

    if let Ok(path) = std::env::var("PICHAMBER_PI_PATH") {
        let candidate = expand_home(&path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Ok(path) = which::which("pi") {
        return Ok(path);
    }

    let home = dirs::home_dir().ok_or("Unable to determine the home directory")?;
    for relative in [".bun/bin/pi", ".local/bin/pi", ".npm-global/bin/pi"] {
        let candidate = home.join(relative);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("Pi CLI was not found. Install @mariozechner/pi-coding-agent or configure its path.".into())
}

#[tauri::command]
pub fn find_pi(pi_path: Option<String>) -> Result<String, String> {
    discover_pi(pi_path.as_deref()).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn rpc_start(
    app: AppHandle,
    state: State<'_, RpcState>,
    options: RpcStartOptions,
    instance_id: Option<String>,
) -> Result<RpcStartResult, String> {
    let id = instance_id.unwrap_or_else(|| DEFAULT_INSTANCE.to_string());
    if !valid_instance_id(&id) {
        return Err("Invalid runtime instance ID".into());
    }
    let cwd = std::fs::canonicalize(&options.cwd)
        .map_err(|error| format!("Project directory is unavailable: {error}"))?;
    if !cwd.is_dir() {
        return Err("Project path is not a directory".into());
    }

    rpc_stop_inner(&state, &id).await?;
    let executable = discover_pi(options.pi_path.as_deref())?;
    let generation = {
        let mut generations = state.generations.lock().await;
        let next = generations.get(&id).copied().unwrap_or(0) + 1;
        generations.insert(id.clone(), next);
        next
    };

    let mut command = Command::new(&executable);
    command.arg("--mode").arg("rpc").current_dir(cwd);
    if let Some(provider) = options.provider.filter(|v| !v.is_empty()) {
        command.arg("--provider").arg(provider);
    }
    if let Some(model) = options.model.filter(|v| !v.is_empty()) {
        command.arg("--model").arg(model);
    }
    if let Some(env) = options.env {
        command.envs(env);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start Pi: {error}"))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("Pi stdin was not available")?;
    let stdout = child.stdout.take().ok_or("Pi stdout was not available")?;
    let stderr = child.stderr.take().ok_or("Pi stderr was not available")?;
    let child = Arc::new(Mutex::new(child));

    state.processes.lock().await.insert(
        id.clone(),
        RpcProcess {
            stdin: Arc::new(Mutex::new(stdin)),
            child: child.clone(),
            generation,
            pid,
        },
    );

    let event_app = app.clone();
    let event_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = event_app.emit(
                "rpc-event",
                RpcEventPayload {
                    instance_id: event_id.clone(),
                    generation,
                    line,
                },
            );
        }
        let status = child.lock().await.wait().await.ok().and_then(|s| s.code());
        let _ = event_app.emit(
            "rpc-closed",
            serde_json::json!({"instanceId": event_id, "generation": generation, "code": status}),
        );
    });

    let stderr_app = app;
    let stderr_id = id.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stderr_app.emit(
                "rpc-stderr",
                RpcEventPayload {
                    instance_id: stderr_id.clone(),
                    generation,
                    line,
                },
            );
        }
    });

    Ok(RpcStartResult {
        instance_id: id,
        generation,
        executable: executable.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn rpc_send(
    state: State<'_, RpcState>,
    command: String,
    instance_id: Option<String>,
) -> Result<(), String> {
    let id = instance_id.unwrap_or_else(|| DEFAULT_INSTANCE.to_string());
    serde_json::from_str::<serde_json::Value>(&command)
        .map_err(|error| format!("RPC command is not valid JSON: {error}"))?;
    let stdin = {
        let processes = state.processes.lock().await;
        processes.get(&id).map(|process| process.stdin.clone())
    }
    .ok_or_else(|| format!("Runtime {id} is not running"))?;
    let mut writer = stdin.lock().await;
    writer
        .write_all(command.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    writer.write_all(b"\n").await.map_err(|e| e.to_string())?;
    writer.flush().await.map_err(|e| e.to_string())
}

async fn rpc_stop_inner(state: &RpcState, id: &str) -> Result<(), String> {
    let process = state.processes.lock().await.remove(id);
    if let Some(process) = process {
        let _generation = process.generation;
        let mut child = process.child.lock().await;
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        #[cfg(unix)]
        if let Some(pid) = process.pid {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
            }
        }
        #[cfg(windows)]
        if let Some(pid) = process.pid {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status()
                .await;
        }
        child
            .kill()
            .await
            .map_err(|error| format!("Failed to stop Pi: {error}"))?;
        let _ = child.wait().await;
    }
    Ok(())
}

pub async fn rpc_stop_all(state: &RpcState) {
    let ids = state
        .processes
        .lock()
        .await
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    for id in ids {
        let _ = rpc_stop_inner(state, &id).await;
    }
}

#[tauri::command]
pub async fn rpc_stop(
    state: State<'_, RpcState>,
    instance_id: Option<String>,
) -> Result<(), String> {
    let id = instance_id.unwrap_or_else(|| DEFAULT_INSTANCE.to_string());
    rpc_stop_inner(&state, &id).await
}

#[tauri::command]
pub async fn rpc_is_running(
    state: State<'_, RpcState>,
    instance_id: Option<String>,
) -> Result<bool, String> {
    let id = instance_id.unwrap_or_else(|| DEFAULT_INSTANCE.to_string());
    Ok(state.processes.lock().await.contains_key(&id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_instance_ids() {
        assert!(valid_instance_id("workspace:session-1"));
        assert!(!valid_instance_id(""));
        assert!(!valid_instance_id("bad/id"));
        assert!(!valid_instance_id(&"a".repeat(129)));
    }
}
