//! Command-line options. Unknown arguments are rejected (exit code 2) rather
//! than ignored, so a mistyped QA flag can never silently run a different test.

use crate::startup::FaultPlan;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Options {
    /// Headless Data/ round-trip in an isolated sub-folder; no window.
    pub self_test: bool,
    /// Zero-based monitor index; `None` = primary monitor.
    pub monitor_index: Option<usize>,
    /// Automation: run the real overlay for N ms, then save and exit with a
    /// machine-readable Data/s4-smoke.json report.
    pub smoke_ms: Option<u64>,
    /// Automation: count one synthetic Pal click before the smoke exit, so a
    /// restart test can prove state written by run N is loaded by run N+1.
    /// This is NOT evidence of OS mouse delivery.
    pub smoke_click: bool,
    /// QA only: force the first N first-frame presentation attempts (or all,
    /// with `never`) to report Timeout/Lost/Outdated/fatal, to exercise the
    /// fail-closed startup handshake on a real Windows desktop.
    pub fault_first_frame: Option<FaultPlan>,
}

pub const USAGE: &str = "PixelPals.exe [--monitor-index=N] [--self-test] \
[--smoke-test-ms=N [--smoke-click]] \
[--qa-fault-first-frame=timeout|lost|outdated|fatal[:COUNT|:never]]";

/// Upper bound for automation runs so a broken harness cannot leave an
/// always-on-top window behind indefinitely.
const MAX_SMOKE_MS: u64 = 10 * 60 * 1000;

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Options, String> {
    let mut options = Options::default();
    for arg in args {
        if arg == "--self-test" {
            options.self_test = true;
        } else if arg == "--smoke-click" {
            options.smoke_click = true;
        } else if let Some(value) = arg.strip_prefix("--monitor-index=") {
            let index = value
                .parse::<usize>()
                .map_err(|_| format!("invalid monitor index {value:?}"))?;
            options.monitor_index = Some(index);
        } else if let Some(value) = arg.strip_prefix("--smoke-test-ms=") {
            let ms = value
                .parse::<u64>()
                .map_err(|_| format!("invalid smoke duration {value:?}"))?;
            if ms == 0 || ms > MAX_SMOKE_MS {
                return Err(format!("smoke duration must be 1..={MAX_SMOKE_MS} ms"));
            }
            options.smoke_ms = Some(ms);
        } else if let Some(value) = arg.strip_prefix("--qa-fault-first-frame=") {
            options.fault_first_frame = Some(FaultPlan::parse(value)?);
        } else {
            return Err(format!("unknown argument {arg:?}; usage: {USAGE}"));
        }
    }
    if options.smoke_click && options.smoke_ms.is_none() {
        return Err("--smoke-click requires --smoke-test-ms".to_owned());
    }
    if options.self_test && (options.smoke_ms.is_some() || options.fault_first_frame.is_some()) {
        return Err("--self-test cannot be combined with overlay options".to_owned());
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn defaults_to_primary_monitor_interactive_run() {
        assert_eq!(parse(args(&[])).unwrap(), Options::default());
    }

    #[test]
    fn parses_all_flags() {
        let options = parse(args(&[
            "--monitor-index=1",
            "--smoke-test-ms=3000",
            "--smoke-click",
        ]))
        .unwrap();
        assert_eq!(options.monitor_index, Some(1));
        assert_eq!(options.smoke_ms, Some(3000));
        assert!(options.smoke_click);
    }

    #[test]
    fn rejects_unknown_and_malformed_arguments() {
        assert!(parse(args(&["--monitor-index=-1"])).is_err());
        assert!(parse(args(&["--smoke-test-ms=0"])).is_err());
        assert!(parse(args(&["--smoke-test-ms=99999999999"])).is_err());
        assert!(parse(args(&["--selftest"])).is_err());
        assert!(parse(args(&["--smoke-click"])).is_err());
        assert!(parse(args(&["--self-test", "--smoke-test-ms=5"])).is_err());
        assert!(parse(args(&["--qa-fault-first-frame=boom"])).is_err());
        assert!(parse(args(&["--self-test", "--qa-fault-first-frame=lost:1"])).is_err());
    }

    #[test]
    fn parses_first_frame_fault_injection() {
        let options = parse(args(&[
            "--smoke-test-ms=100",
            "--qa-fault-first-frame=lost:3",
        ]))
        .unwrap();
        let plan = options.fault_first_frame.unwrap();
        assert_eq!(plan.outcome, crate::startup::FrameOutcome::Lost);
        assert_eq!(plan.remaining, Some(3));
        let never = parse(args(&["--qa-fault-first-frame=timeout:never"])).unwrap();
        assert_eq!(never.fault_first_frame.unwrap().remaining, None);
    }
}
