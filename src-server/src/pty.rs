use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast;
use uuid::Uuid;

pub struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    pub data_tx: broadcast::Sender<String>,
    #[cfg(windows)]
    pid: Option<u32>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, Arc<Mutex<PtyHandle>>>>);

impl Drop for PtyState {
    fn drop(&mut self) {
        if let Ok(mut handles) = self.0.lock() {
            for (_, handle) in handles.drain() {
                if let Ok(mut handle) = handle.lock() {
                    let _ = handle.child.kill();
                }
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyStartOptions {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub shell: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyStartResult {
    pub pty_id: String,
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) { "powershell.exe".into() } else { "/bin/zsh".into() }
    })
}

impl PtyState {
    pub fn start(&self, options: PtyStartOptions) -> Result<PtyStartResult, String> {
        let cwd = std::fs::canonicalize(options.cwd)
            .map_err(|error| format!("Invalid terminal directory: {error}"))?;
        if !cwd.is_dir() {
            return Err("Terminal directory is not a folder".into());
        }
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows: options.rows.max(2),
                cols: options.cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut command = CommandBuilder::new(options.shell.unwrap_or_else(default_shell));
        command.cwd(cwd);
        let child = pair.slave.spawn_command(command).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let pid = child.process_id();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let id = Uuid::new_v4().to_string();

        let (data_tx, _) = broadcast::channel(256);

        let handle = Arc::new(Mutex::new(PtyHandle {
            master: pair.master,
            writer,
            child,
            #[cfg(windows)]
            pid,
            data_tx: data_tx.clone(),
        }));
        self.0.lock().map_err(|_| "PTY registry lock failed")?
            .insert(id.clone(), handle);

        let tx = data_tx.clone();
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(size) => {
                        let data = String::from_utf8_lossy(&buffer[..size]).into_owned();
                        let _ = tx.send(data);
                    }
                }
            }
            let _ = tx.send(String::from("\x1b[31mTerminal exited\x1b[0m\r\n"));
        });

        Ok(PtyStartResult { pty_id: id })
    }

    pub fn write(&self, pty_id: &str, data: &str) -> Result<(), String> {
        let handle = self.0.lock().map_err(|_| "PTY registry lock failed")?
            .get(pty_id).cloned()
            .ok_or("Terminal is not running")?;
        let mut handle = handle.lock().map_err(|_| "PTY handle lock failed")?;
        handle.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        handle.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let handle = {
            let handles = self.0.lock().map_err(|_| "PTY registry lock failed")?;
            handles.get(pty_id).cloned().ok_or("Terminal is not running")?
        };
        let guard = handle.lock().map_err(|_| "PTY handle lock failed")?;
        guard.master.resize(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    pub fn stop(&self, pty_id: &str) -> Result<(), String> {
        let handle = self.0.lock().map_err(|_| "PTY registry lock failed")?
            .get(pty_id).cloned();
        if let Some(handle) = handle {
            let mut handle = handle.lock().map_err(|_| "PTY handle lock failed")?;
            #[cfg(windows)]
            if let Some(pid) = handle.pid {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"]).status();
            }
            handle.child.kill().map_err(|e| e.to_string())?;
            drop(handle);
            self.0.lock().map_err(|_| "PTY registry lock failed")?.remove(pty_id);
        }
        Ok(())
    }

    pub fn stop_all(&self) {
        if let Ok(mut handles) = self.0.lock() {
            for (_, handle) in handles.drain() {
                if let Ok(mut handle) = handle.lock() {
                    #[cfg(windows)]
                    if let Some(pid) = handle.pid {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/PID", &pid.to_string(), "/T", "/F"]).status();
                    }
                    let _ = handle.child.kill();
                }
            }
        }
    }
}
