use serde_json::Value;

fn desktop_config() -> Value {
    serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config")
}

fn desktop_capability() -> Value {
    serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("valid Tauri capability")
}

#[test]
fn desktop_loads_only_bundled_assets() {
    let config = desktop_config();
    assert_eq!(config["build"]["frontendDist"].as_str(), Some("./ui"));
    assert!(config["build"].get("devUrl").is_none());
    assert!(config["build"].get("beforeDevCommand").is_none());
    assert!(include_str!("../ui/index.html").contains("./style.css"));
}

#[test]
fn no_remote_origin_grants_or_native_capabilities() {
    let capability = desktop_capability();
    assert_eq!(capability["windows"][0].as_str(), Some("main"));
    assert!(capability.get("remote").is_none());
    assert!(capability["permissions"]
        .as_array()
        .expect("permissions is an array")
        .is_empty());
}

#[test]
fn restrictive_csp_rejects_remote_or_inline_active_content() {
    let config = desktop_config();
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("CSP must be enabled");
    for required in [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "connect-src 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
    ] {
        assert!(csp.contains(required), "missing CSP directive: {required}");
    }
    for forbidden in ["'unsafe-inline'", "'unsafe-eval'", "http:", "https:", "*"] {
        assert!(!csp.contains(forbidden), "weak CSP contains: {forbidden}");
    }
}

#[test]
fn untrusted_content_cannot_invoke_privileged_custom_commands() {
    let main = include_str!("../src/main.rs");
    for forbidden in [
        "#[tauri::command]",
        "generate_handler!",
        "portable_pty",
        "Command::new(",
        "std::fs::",
        "OLLAMA_ORIGINS",
        "run_update",
        "pty_spawn",
        "pty_write",
        "read_text",
        "list_dir",
        "write_note",
    ] {
        assert!(
            !main.contains(forbidden),
            "privileged native surface reintroduced: {forbidden}"
        );
    }
}

#[test]
fn bundled_page_does_not_embed_external_executable_content() {
    let html = include_str!("../ui/index.html");
    assert!(!html.contains("<script"));
    assert!(!html.contains("<iframe"));
    assert!(!html.contains("<form"));
    assert!(!html.contains("<a "));
    assert!(!html.contains("href=\"http"));
    assert!(!html.contains("src=\"http"));
}

#[test]
fn legacy_updater_is_disabled_and_installer_does_not_fetch_code() {
    let installer = include_str!("../../packaging/install.sh");
    let old_updater = include_str!("../../packaging/pull.sh");
    for forbidden in ["git fetch", "git pull", "git merge", "git reset", "pull.sh"] {
        assert!(
            !installer.contains(forbidden),
            "installer must not update source: {forbidden}"
        );
    }
    for forbidden in ["git fetch", "git pull", "git merge", "git reset", "git checkout"] {
        assert!(
            !old_updater.contains(forbidden),
            "legacy updater must not mutate repository: {forbidden}"
        );
    }
    assert!(old_updater.contains("disabled"));
}
