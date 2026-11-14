//! Embeds the Windows application manifest (asInvoker, PerMonitorV2 DPI,
//! Windows 10/11 compatibility) using the MSVC linker directly, so no extra
//! build dependency or resource compiler is required.
use std::{env, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
        .join("windows")
        .join("PixelPals.exe.manifest");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}",
            manifest.display()
        );
        // The UAC level comes from the manifest file (asInvoker); do not let
        // the linker add a second trustInfo block.
        println!("cargo:rustc-link-arg-bins=/MANIFESTUAC:NO");
    }
}
