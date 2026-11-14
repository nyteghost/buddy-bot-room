/** No S2 IPC commands, remote origins, shell, file-system or AI services. */
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("S2 Tauri runtime failed");
}

#[cfg(test)]
mod tests {
    #[test]
    fn bundled_local_transparent_window_and_restricted_csp() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["build"]["frontendDist"], "../dist");
        assert_eq!(config["app"]["windows"][0]["transparent"], true);
        assert_eq!(config["app"]["windows"][0]["decorations"], false);
        assert_eq!(config["app"]["windows"][0]["backgroundColor"], "#00000000");
        assert_eq!(config["bundle"]["active"], false);
        assert!(config["app"]["security"]["csp"]
            .as_str()
            .unwrap()
            .contains("connect-src 'none'"));
        assert!(config["app"]["security"]["dangerousRemoteDomainIpcAccess"].is_null());
    }
}
