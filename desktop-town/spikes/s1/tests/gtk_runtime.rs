//! GTK/Wayland runtime integration checks (custom harness, single-threaded).
//!
//! Opt-in: set `S1_GTK_RUNTIME_TESTS=1` inside a Wayland session. CI runs
//! this under headless sway (wlroots, layer-shell present) and headless
//! weston (no wlr-layer-shell → must fall back). Set
//! `S1_EXPECT_LAYER_SHELL=0` for the latter.
//!
//! A pass here is evidence for *that* compositor only, not KWin/NVIDIA.
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_pixel-pals-s1-kwin-overlay");

struct Run {
    code: Option<i32>,
    out: String,
}

fn spawn(args: &[&str]) -> Child {
    Command::new(BIN).args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("spawn")
}

/// Collect stdout+stderr lines; optionally SIGTERM once `trigger` appears.
fn run_with(args: &[&str], trigger: Option<&str>, limit: Duration) -> Run {
    let mut child = spawn(args);
    let (tx, rx) = mpsc::channel::<String>();
    for stream in [
        Box::new(child.stdout.take().unwrap()) as Box<dyn std::io::Read + Send>,
        Box::new(child.stderr.take().unwrap()),
    ] {
        let tx = tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
    }
    drop(tx);
    let start = Instant::now();
    let mut out = String::new();
    let mut signalled = false;
    loop {
        while let Ok(line) = rx.try_recv() {
            if let Some(t) = trigger
                && !signalled
                && line.contains(t)
            {
                let _ = Command::new("kill").args(["-TERM", &child.id().to_string()]).status();
                signalled = true;
            }
            out.push_str(&line);
            out.push('\n');
        }
        if let Some(status) = child.try_wait().expect("wait") {
            thread::sleep(Duration::from_millis(100));
            out.extend(rx.try_iter().map(|l| l + "\n"));
            return Run { code: status.code(), out };
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            out.push_str("HARNESS_TIMEOUT\n");
            return Run { code: None, out };
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn no_runtime_warnings(out: &str) -> bool {
    !["S1_SPURIOUS_CLICK", "Gtk-CRITICAL", "Gdk-CRITICAL", "GLib-CRITICAL", "Gtk-WARNING", "panicked"]
        .iter()
        .any(|w| out.contains(w))
}

type Case = (&'static str, fn(bool) -> Result<(), String>);

fn case_require_overlay(layer_shell: bool) -> Result<(), String> {
    let r = run_with(&["--require-overlay", "--seconds", "2", "--speed", "0"], None, Duration::from_secs(15));
    if layer_shell {
        let ok = r.code == Some(0)
            && r.out.contains("S1_READY")
            && r.out.contains("S1_ALLOCATED")
            && r.out.contains("S1_TIMEOUT_EXIT")
            && no_runtime_warnings(&r.out);
        if ok { Ok(()) } else { Err(r.out) }
    } else {
        let ok = r.code == Some(2) && r.out.contains("S1_SAFE_FALLBACK") && !r.out.contains("S1_READY");
        if ok { Ok(()) } else { Err(r.out) }
    }
}

fn case_fallback_window(_: bool) -> Result<(), String> {
    let r = run_with(&["--seconds", "2"], None, Duration::from_secs(15));
    // On a layer-shell compositor this is the overlay; otherwise the safe
    // town window. Either way: clean bounded exit, never both.
    let overlay = r.out.contains("S1_READY");
    let town = r.out.contains("S1_TOWN_ONLY_READY");
    if r.code == Some(0) && overlay != town && r.out.contains("S1_TIMEOUT_EXIT") && no_runtime_warnings(&r.out) {
        Ok(())
    } else {
        Err(r.out)
    }
}

fn case_town_only(_: bool) -> Result<(), String> {
    let r = run_with(&["--town-only", "--seconds", "1"], None, Duration::from_secs(15));
    let ok = r.code == Some(0)
        && r.out.contains("S1_SAFE_FALLBACK reason=Forced by --town-only")
        && r.out.contains("S1_TOWN_ONLY_READY")
        && !r.out.contains("S1_READY ");
    if ok { Ok(()) } else { Err(r.out) }
}

fn case_sigterm(layer_shell: bool) -> Result<(), String> {
    let trigger = if layer_shell { "S1_ALLOCATED" } else { "S1_TOWN_ONLY_READY" };
    let r = run_with(&["--seconds", "60", "--speed", "4"], Some(trigger), Duration::from_secs(15));
    if r.code == Some(0) && r.out.contains("S1_SIGNAL_EXIT signal=SIGTERM") { Ok(()) } else { Err(r.out) }
}

fn case_unknown_connector(_: bool) -> Result<(), String> {
    let r = run_with(&["--require-overlay", "--monitor", "NOPE-9", "--seconds", "2"], None, Duration::from_secs(15));
    if r.code == Some(2) && !r.out.contains("S1_READY") { Ok(()) } else { Err(r.out) }
}

fn case_lifecycle_5(layer_shell: bool) -> Result<(), String> {
    for n in 1..=5 {
        case_require_overlay(layer_shell).map_err(|e| format!("cycle {n}: {e}"))?;
    }
    Ok(())
}

fn main() {
    if std::env::var("S1_GTK_RUNTIME_TESTS").as_deref() != Ok("1") {
        println!("gtk_runtime: SKIP (set S1_GTK_RUNTIME_TESTS=1 inside a Wayland session)");
        return;
    }
    let layer_shell = std::env::var("S1_EXPECT_LAYER_SHELL").as_deref() != Ok("0");
    let cases: [Case; 6] = [
        ("require_overlay", case_require_overlay),
        ("default_mode_bounded", case_fallback_window),
        ("town_only", case_town_only),
        ("sigterm_clean_exit", case_sigterm),
        ("unknown_connector_fails_closed", case_unknown_connector),
        ("lifecycle_5", case_lifecycle_5),
    ];
    let mut failed = 0;
    for (name, f) in cases {
        match f(layer_shell) {
            Ok(()) => println!("test {name} ... ok"),
            Err(log) => {
                failed += 1;
                println!("test {name} ... FAILED\n{log}");
            }
        }
    }
    println!("gtk_runtime (layer_shell_expected={layer_shell}): {} passed; {failed} failed", cases.len() - failed);
    if failed > 0 {
        std::process::exit(1);
    }
}
