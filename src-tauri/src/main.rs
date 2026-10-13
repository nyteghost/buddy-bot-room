// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use serde_json::{json, Value};

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

fn main() {
    // WebKitGTK + NVIDIA: avoid blank windows from the DMA-BUF renderer.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ollama_chat, ollama_tags, ollama_start])
        .run(tauri::generate_context!())
        .expect("error while running Pixel Pals");
}
