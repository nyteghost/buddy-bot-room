//! Opt-in runtime measurements (`--stats SECS`). Pure helpers only: frame
//! interval percentiles and parsers for `/proc/self/stat` and
//! `/proc/self/smaps_rollup`. The binary reads those files; nothing here does I/O.
//!
//! These numbers describe *this process*. They are measurement tools for the
//! owner's hardware run, not benchmark results.

/// Linux exposes CPU times in USER_HZ, which is 100 on every mainstream
/// architecture's userspace ABI (x86_64, aarch64).
pub const USER_HZ: u64 = 100;
/// Bound on retained intervals per reporting window.
pub const MAX_SAMPLES: usize = 8192;

#[derive(Debug, Default, Clone)]
pub struct FrameStats {
    last_frame_us: Option<i64>,
    intervals_us: Vec<u64>,
    frames: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameSummary {
    pub frames: u64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
}

impl FrameStats {
    /// Record one painted frame at the GDK frame-clock time (microseconds).
    /// Non-monotonic or duplicate times count as a frame but not an interval.
    pub fn record(&mut self, frame_time_us: i64) {
        self.frames += 1;
        if let Some(last) = self.last_frame_us
            && frame_time_us > last
            && self.intervals_us.len() < MAX_SAMPLES
        {
            self.intervals_us.push(u64::try_from(frame_time_us - last).unwrap_or(0));
        }
        self.last_frame_us = Some(frame_time_us);
    }

    /// Summarise and start a new window. Interval chains continue across
    /// windows only while frames keep coming (idle gaps are not intervals).
    pub fn take(&mut self) -> FrameSummary {
        let mut sorted = std::mem::take(&mut self.intervals_us);
        sorted.sort_unstable();
        let frames = std::mem::take(&mut self.frames);
        if frames == 0 {
            self.last_frame_us = None;
        }
        let ms = |us: u64| us as f64 / 1000.0;
        FrameSummary {
            frames,
            p50_ms: ms(percentile(&sorted, 50.0)),
            p95_ms: ms(percentile(&sorted, 95.0)),
            max_ms: ms(sorted.last().copied().unwrap_or(0)),
        }
    }
}

/// Nearest-rank percentile of an ascending slice; 0 for an empty slice.
#[must_use]
pub fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() || !p.is_finite() {
        return 0;
    }
    let rank = ((p.clamp(0.0, 100.0) / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

/// utime + stime (fields 14 and 15) in USER_HZ ticks from `/proc/<pid>/stat`.
/// Parses after the last `)` so a process name containing spaces or `)`
/// cannot shift fields.
#[must_use]
pub fn parse_cpu_ticks(stat: &str) -> Option<u64> {
    let rest = &stat[stat.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // rest[0] is field 3 (state) → utime (14) is index 11, stime (15) index 12
    let utime = fields.get(11)?.parse::<u64>().ok()?;
    let stime = fields.get(12)?.parse::<u64>().ok()?;
    utime.checked_add(stime)
}

/// `Pss:` and `Rss:` totals in KiB from `/proc/self/smaps_rollup`.
#[must_use]
pub fn parse_pss_rss_kib(smaps_rollup: &str) -> (Option<u64>, Option<u64>) {
    let field = |name: &str| {
        smaps_rollup.lines().find_map(|l| {
            let rest = l.strip_prefix(name)?.trim_start();
            rest.strip_suffix("kB").unwrap_or(rest).trim().parse::<u64>().ok()
        })
    };
    (field("Pss:"), field("Rss:"))
}

/// CPU use in percent of one logical core over a wall-clock window.
#[must_use]
pub fn cpu_percent(ticks_delta: u64, wall_seconds: f64) -> f64 {
    if wall_seconds <= 0.0 || !wall_seconds.is_finite() {
        return 0.0;
    }
    ticks_delta as f64 / USER_HZ as f64 / wall_seconds * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_nearest_rank() {
        let v: Vec<u64> = (1..=100).collect();
        assert_eq!(percentile(&v, 50.0), 50);
        assert_eq!(percentile(&v, 95.0), 95);
        assert_eq!(percentile(&v, 100.0), 100);
        assert_eq!(percentile(&v, 0.0), 1);
        assert_eq!(percentile(&[], 95.0), 0);
        assert_eq!(percentile(&[7], 95.0), 7);
        assert_eq!(percentile(&v, f64::NAN), 0);
    }

    #[test]
    fn frame_stats_intervals_windows_and_idle() {
        let mut s = FrameStats::default();
        for i in 0..31 {
            s.record(1_000_000 + i * 33_333);
        }
        let w = s.take();
        assert_eq!(w.frames, 31);
        assert!((w.p50_ms - 33.333).abs() < 0.01 && (w.p95_ms - 33.333).abs() < 0.01);
        // idle window: no frames, no intervals
        let idle = s.take();
        assert_eq!((idle.frames, idle.p95_ms), (0, 0.0));
        // after idle, the first frame must not create a giant interval
        s.record(9_000_000);
        s.record(9_016_667);
        let after = s.take();
        assert_eq!(after.frames, 2);
        assert!((after.max_ms - 16.667).abs() < 0.01);
        // non-monotonic time counts a frame, not an interval
        s.record(5);
        s.record(5);
        s.record(4);
        assert_eq!(s.take().max_ms, 0.0);
    }

    #[test]
    fn frame_stats_sample_cap() {
        let mut s = FrameStats::default();
        for i in 0..(MAX_SAMPLES as i64 + 100) {
            s.record(i * 1000);
        }
        let w = s.take();
        assert_eq!(w.frames, MAX_SAMPLES as u64 + 100);
        assert!((w.p95_ms - 1.0).abs() < 1e-9);
    }

    #[test]
    fn proc_stat_parsing_handles_hostile_names() {
        let normal = "4242 (pixel-pals-s1-k) S 1 4242 4242 0 -1 4194304 1500 0 0 0 37 12 0 0 20 0 3 0 9999 1 2";
        assert_eq!(parse_cpu_ticks(normal), Some(49));
        let tricky = "77 (a) b) c) R 1 77 77 0 -1 0 0 0 0 0 5 6 0 0 20 0 1 0 1 2 3";
        assert_eq!(parse_cpu_ticks(tricky), Some(11));
        assert_eq!(parse_cpu_ticks("garbage"), None);
        assert_eq!(parse_cpu_ticks("1 (x) S 1 2"), None);
    }

    #[test]
    fn smaps_rollup_parsing() {
        let text = "55d0-7ffe ---p 00000000 00:00 0  [rollup]\nRss:              51234 kB\nPss:              40210 kB\nPss_Anon:  1 kB\n";
        assert_eq!(parse_pss_rss_kib(text), (Some(40210), Some(51234)));
        assert_eq!(parse_pss_rss_kib(""), (None, None));
    }

    #[test]
    fn cpu_percent_of_one_core() {
        assert!((cpu_percent(100, 10.0) - 10.0).abs() < 1e-9);
        assert_eq!(cpu_percent(5, 0.0), 0.0);
        assert_eq!(cpu_percent(5, f64::NAN), 0.0);
    }
}
