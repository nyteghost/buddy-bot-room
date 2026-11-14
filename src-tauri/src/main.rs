// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// This legacy wrapper intentionally loads only packaged, local UI assets.
/// It registers no native IPC commands. Remote content must not launch shells,
/// read/write files, start services or update executable code through this app.
fn main() {
    // WebKitGTK + NVIDIA: avoid blank windows from the DMA-BUF renderer.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Pixel Pals");
}
