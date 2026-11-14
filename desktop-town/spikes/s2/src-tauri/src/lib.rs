/** Intentionally no Tauri IPC commands, remote origins, or external services. */
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("S2 Tauri runtime failed");
}

#[cfg(test)]
mod tests {
    #[test]
    fn bundled_local_transparent_window_and_restricted_csp() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["build"]["frontendDist"], "../dist");
        assert_eq!(config["app"]["windows"][0]["transparent"], true);
        assert!(config["app"]["security"]["csp"].as_str().unwrap().contains("connect-src 'none'"));
        assert_eq!(config["bundle"]["active"], false);
    }
}
