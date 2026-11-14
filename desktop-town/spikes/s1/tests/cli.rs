//! Process-level CLI checks. These never open a display: argument validation
//! must reject bad input before GTK is initialised.
use std::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_pixel-pals-s1-kwin-overlay");

fn run(args: &[&str]) -> (i32, String, String) {
    let out = Command::new(BIN)
        .args(args)
        // Guarantee no compositor is reachable even on a developer desktop.
        .env_remove("WAYLAND_DISPLAY")
        .env_remove("DISPLAY")
        .output()
        .expect("spawn s1 binary");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn help_exits_zero_without_display() {
    let (code, stdout, _) = run(&["--help"]);
    assert_eq!(code, 0);
    assert!(stdout.contains("--require-overlay"));
}

#[test]
fn invalid_arguments_exit_two_before_gtk() {
    for args in [
        &["--seconds", "0"][..],
        &["--speed", "inf"],
        &["--layer", "overlay"],
        &["--town-only", "--require-overlay"],
        &["--monitor", "../etc"],
        &["--unknown"],
    ] {
        let (code, _, stderr) = run(args);
        assert_eq!(code, 2, "{args:?}");
        assert!(stderr.contains("S1_ARGS_ERROR"), "{args:?}: {stderr}");
    }
}

#[test]
fn require_overlay_without_any_display_fails_closed() {
    let (code, _, stderr) = run(&["--require-overlay", "--seconds", "2"]);
    // GTK cannot open a display → no surface at all, non-zero exit.
    assert_ne!(code, 0, "{stderr}");
    assert!(!stderr.contains("S1_READY"));
}
