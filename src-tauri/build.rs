fn main() {
    // Bake the checked-out commit and source folder into the binary so the
    // app can tell when GitHub has a newer version and where to rebuild it.
    let sha = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=PIXELPALS_GIT_SHA={sha}");
    println!("cargo:rustc-env=PIXELPALS_SRC_DIR={dir}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");
    tauri_build::build()
}
