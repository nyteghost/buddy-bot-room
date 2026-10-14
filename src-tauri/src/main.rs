// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// Non-streaming Ollama chat call made natively, so the https-loaded window
/// isn't blocked by mixed-content/CORS rules when talking to localhost.
#[tauri::command]
async fn ollama_chat(
    url: String,
    model: String,
    system: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let base = url.trim_end_matches('/').trim_end_matches("/v1");
    let mut msgs = vec![json!({ "role": "system", "content": system })];
    for m in messages {
        msgs.push(json!({ "role": m.role, "content": m.content }));
    }
    let res = reqwest::Client::new()
        .post(format!("{base}/v1/chat/completions"))
        .json(&json!({
            "model": model,
            "stream": false,
            "max_tokens": 400,
            "messages": msgs,
        }))
        .send()
        .await
        .map_err(|e| format!("Can't reach your local server at {url}. Start it with: OLLAMA_ORIGINS=\"*\" ollama serve ({e})"))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(if status.as_u16() == 404 {
            format!("Model not found. Run: ollama pull {model}")
        } else {
            format!("Local server error {status}: {}", &body[..body.len().min(200)])
        });
    }
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Empty reply from local server".to_string())
}

/// Native /api/tags probe for the mascot status.
#[tauri::command]
async fn ollama_tags(url: String) -> Result<Vec<String>, String> {
    let base = url.trim_end_matches('/').trim_end_matches("/v1");
    let res = reqwest::Client::new()
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json["models"]
        .as_array()
        .map(|ms| {
            ms.iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

/// Starts `ollama serve` in the background with OLLAMA_ORIGINS=* so the app can reach it.
#[tauri::command]
fn ollama_start() -> Result<String, String> {
    use std::process::{Command, Stdio};
    match Command::new("ollama")
        .arg("serve")
        .env("OLLAMA_ORIGINS", "*")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => Ok("started".into()),
        Err(e) => {
            // Fall back to a user systemd service if the binary isn't on PATH.
            let ok = Command::new("systemctl")
                .args(["--user", "start", "ollama"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                Ok("service".into())
            } else {
                Err(format!("Couldn't start Ollama ({e}). Install it with: sudo pacman -S ollama-cuda"))
            }
        }
    }
}

// ---------- Terminal (PTY) ----------

struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
struct PtyState(Mutex<Option<Pty>>);

/// Opens your login shell in a pseudo-terminal and streams its output as "pty-output" events.
#[tauri::command]
fn pty_spawn(app: AppHandle, state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = handle.emit("pty-output", String::from_utf8_lossy(&buf[..n]).to_string());
                }
            }
        }
        if let Ok(mut g) = handle.state::<PtyState>().0.lock() {
            *g = None;
        }
        let _ = handle.emit("pty-exit", ());
    });
    *guard = Some(Pty { writer, master: pair.master, _child: child });
    Ok(())
}

#[tauri::command]
fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let pty = guard.as_mut().ok_or("Terminal is not running")?;
    pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    pty.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pty_resize(state: State<PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = guard.as_ref() {
        pty.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Read-only helpers for the Linux Mode pals ----------

fn sh(cmd: &str) -> String {
    std::process::Command::new("sh")
        .args(["-c", cmd])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn expand(path: &str) -> String {
    match (path.strip_prefix("~"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}{rest}"),
        _ => path.to_string(),
    }
}

/// GPU, memory, disk and pending updates — read-only.
#[tauri::command]
fn system_stats() -> String {
    format!(
        "GPU: {}\nMemory:\n{}\nDisk (/ and home):\n{}\nPending updates: {}\nUptime: {}",
        sh("nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader 2>/dev/null || echo 'nvidia-smi not available'"),
        sh("free -h"),
        sh("df -h / \"$HOME\" | sort -u"),
        sh("(checkupdates 2>/dev/null || true) | wc -l"),
        sh("uptime -p"),
    )
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = std::fs::read_dir(expand(&path))
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| {
            let dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            format!("{}{}", e.file_name().to_string_lossy(), if dir { "/" } else { "" })
        })
        .collect();
    names.sort();
    names.truncate(200);
    Ok(names)
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let text = std::fs::read_to_string(expand(&path)).map_err(|e| e.to_string())?;
    Ok(text.chars().take(4000).collect())
}

/// Saves a note the user approved into their notes folder (no subfolders or "..").
#[tauri::command]
fn write_note(dir: String, name: String, content: String) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Err("Invalid note name".into());
    }
    let dir = expand(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = format!("{}/{}", dir.trim_end_matches('/'), name);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

// ---------- Updates ----------

#[tauri::command]
fn app_info() -> Value {
    json!({ "sha": env!("PIXELPALS_GIT_SHA"), "dir": env!("PIXELPALS_SRC_DIR") })
}

/// Opens a terminal that pulls the latest code from GitHub and reinstalls Pixel Pals.
#[tauri::command]
fn run_update() -> Result<(), String> {
    use std::process::Command;
    let dir = env!("PIXELPALS_SRC_DIR");
    let script = format!(
        "cd '{dir}' && bash packaging/install.sh; echo; echo 'Restart Pixel Pals to use the new version.'; read -p 'Press Enter to close' _"
    );
    let terminals: [(&str, &[&str]); 6] = [
        ("ghostty", &["-e", "bash", "-c"]),
        ("konsole", &["-e", "bash", "-c"]),
        ("gnome-terminal", &["--", "bash", "-c"]),
        ("kitty", &["bash", "-c"]),
        ("alacritty", &["-e", "bash", "-c"]),
        ("xterm", &["-e", "bash", "-c"]),
    ];
    for (bin, args) in terminals {
        if Command::new(bin).args(args).arg(&script).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(format!("No terminal found. Run this yourself: cd {dir} && bash packaging/install.sh"))
}

fn main() {
    // WebKitGTK + NVIDIA: avoid blank windows from the DMA-BUF renderer.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            ollama_chat,
            ollama_tags,
            ollama_start,
            pty_spawn,
            pty_write,
            pty_resize,
            system_stats,
            list_dir,
            read_text,
            write_note,
            app_info,
            run_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pixel Pals");
}
