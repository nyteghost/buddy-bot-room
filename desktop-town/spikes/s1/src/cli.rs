//! Command-line options. Parsed without touching GTK so invalid input fails
//! before any surface exists.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayerChoice {
    Top,
    Bottom,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MonitorChoice {
    /// GDK monitor list index (unstable across hotplug; default 0).
    Index(usize),
    /// Stable output connector name, e.g. `DP-1`, `HDMI-A-1`.
    Connector(String),
    All,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Overlay,
    TownOnly,
    /// QA-only normal window that counts clicks reaching "the desktop".
    QaUnderlay {
        fullscreen: bool,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    pub seconds: u32,
    pub speed: f64,
    pub monitor: MonitorChoice,
    pub layer: LayerChoice,
    pub require_overlay: bool,
    pub mode: Mode,
    pub trace_region: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    Run,
    Help,
}

pub const HELP: &str = "Pixel Pals S1 Wayland overlay spike (research prototype)
  --seconds N           Self-close after N seconds (default 300, max 3600)
  --speed N             Pal pixels per 80ms tick, 0..24 (default 4)
  --monitor-index N     GDK monitor index (default 0)
  --monitor NAME        Output connector, e.g. DP-1 (stable; preferred)
  --all-monitors        One independently clipped layer surface per output
  --layer top|bottom    Default top; bottom may be hidden behind windows
  --town-only           Safe normal-window mode, no layer shell
  --require-overlay     Exit 2 instead of falling back (QA automation)
  --trace-region        Log every input-region change (QA evidence)
  --qa-underlay         QA: ordinary click-counting window, not an overlay
  --qa-fullscreen       QA: with --qa-underlay, request fullscreen
No keyboard grab, no exclusive zone, no desktop/window enumeration.";

impl Default for Options {
    fn default() -> Self {
        Self {
            seconds: 300,
            speed: 4.0,
            monitor: MonitorChoice::Index(0),
            layer: LayerChoice::Top,
            require_overlay: false,
            mode: Mode::Overlay,
            trace_region: false,
        }
    }
}

impl Options {
    /// Parse arguments (excluding argv[0]).
    ///
    /// # Errors
    /// Returns a human-readable message for any unknown, missing or
    /// out-of-range value, or for mutually exclusive flags.
    pub fn parse<I, S>(args: I) -> Result<(Self, Parsed), String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut opt = Self::default();
        let mut monitor_set = false;
        let mut underlay = false;
        let mut underlay_fullscreen = false;
        let mut town_only = false;
        let mut args = args.into_iter().map(Into::into);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--seconds" => {
                    let v = args.next().ok_or("--seconds requires 1..=3600")?;
                    opt.seconds = v.parse::<u32>().map_err(|_| "invalid --seconds")?;
                    if !(1..=3600).contains(&opt.seconds) {
                        return Err("--seconds must be 1..=3600".into());
                    }
                }
                "--speed" => {
                    let v = args.next().ok_or("--speed requires 0..=24")?;
                    opt.speed = v.parse::<f64>().map_err(|_| "invalid --speed")?;
                    if !opt.speed.is_finite() || !(0.0..=24.0).contains(&opt.speed) {
                        return Err("--speed must be a finite number 0..=24".into());
                    }
                }
                "--monitor-index" => {
                    let v = args.next().ok_or("--monitor-index requires an integer")?;
                    let index = v.parse::<usize>().map_err(|_| "invalid --monitor-index")?;
                    if monitor_set {
                        return Err("choose only one monitor option".into());
                    }
                    opt.monitor = MonitorChoice::Index(index);
                    monitor_set = true;
                }
                "--monitor" => {
                    let v = args.next().ok_or("--monitor requires a connector name")?;
                    let valid = !v.is_empty()
                        && v.len() <= 64
                        && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                    if !valid {
                        return Err("--monitor must be a connector like DP-1".into());
                    }
                    if monitor_set {
                        return Err("choose only one monitor option".into());
                    }
                    opt.monitor = MonitorChoice::Connector(v);
                    monitor_set = true;
                }
                "--all-monitors" => {
                    if monitor_set {
                        return Err("choose only one monitor option".into());
                    }
                    opt.monitor = MonitorChoice::All;
                    monitor_set = true;
                }
                "--layer" => {
                    opt.layer = match args.next().as_deref() {
                        Some("top") => LayerChoice::Top,
                        Some("bottom") => LayerChoice::Bottom,
                        _ => return Err("--layer must be top or bottom".into()),
                    };
                }
                "--require-overlay" => opt.require_overlay = true,
                "--town-only" => town_only = true,
                "--trace-region" => opt.trace_region = true,
                "--qa-underlay" => underlay = true,
                "--qa-fullscreen" => underlay_fullscreen = true,
                "--help" | "-h" => return Ok((opt, Parsed::Help)),
                _ => return Err(format!("unknown argument: {arg}")),
            }
        }
        if town_only && opt.require_overlay {
            return Err("--town-only and --require-overlay are mutually exclusive".into());
        }
        if underlay && (town_only || opt.require_overlay) {
            return Err("--qa-underlay cannot be combined with overlay modes".into());
        }
        if underlay_fullscreen && !underlay {
            return Err("--qa-fullscreen requires --qa-underlay".into());
        }
        opt.mode = if underlay {
            Mode::QaUnderlay { fullscreen: underlay_fullscreen }
        } else if town_only {
            Mode::TownOnly
        } else {
            Mode::Overlay
        };
        Ok((opt, Parsed::Run))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Options, String> {
        Options::parse(args.iter().copied()).map(|(o, _)| o)
    }

    #[test]
    fn defaults_are_bounded_top_layer_single_monitor() {
        let o = parse(&[]).unwrap();
        assert_eq!(o.seconds, 300);
        assert_eq!(o.layer, LayerChoice::Top);
        assert_eq!(o.monitor, MonitorChoice::Index(0));
        assert_eq!(o.mode, Mode::Overlay);
        assert!(!o.require_overlay);
    }

    #[test]
    fn rejects_out_of_range_and_malformed_values() {
        for bad in [
            &["--seconds", "0"][..],
            &["--seconds", "3601"],
            &["--seconds"],
            &["--speed", "NaN"],
            &["--speed", "25"],
            &["--speed", "-1"],
            &["--layer", "overlay"],
            &["--monitor", "DP-1;rm"],
            &["--monitor", ""],
            &["--bogus"],
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn mutually_exclusive_flags_fail() {
        assert!(parse(&["--town-only", "--require-overlay"]).is_err());
        assert!(parse(&["--all-monitors", "--monitor", "DP-1"]).is_err());
        assert!(parse(&["--monitor-index", "1", "--all-monitors"]).is_err());
        assert!(parse(&["--qa-underlay", "--town-only"]).is_err());
        assert!(parse(&["--qa-fullscreen"]).is_err());
    }

    #[test]
    fn connector_and_modes_parse() {
        let o = parse(&["--monitor", "HDMI-A-1", "--layer", "bottom", "--trace-region"]).unwrap();
        assert_eq!(o.monitor, MonitorChoice::Connector("HDMI-A-1".into()));
        assert_eq!(o.layer, LayerChoice::Bottom);
        assert!(o.trace_region);
        let u = parse(&["--qa-underlay", "--qa-fullscreen"]).unwrap();
        assert_eq!(u.mode, Mode::QaUnderlay { fullscreen: true });
        assert_eq!(parse(&["--town-only"]).unwrap().mode, Mode::TownOnly);
    }

    #[test]
    fn help_is_reported_without_running() {
        let (_, p) = Options::parse(["--help"]).unwrap();
        assert_eq!(p, Parsed::Help);
    }
}
