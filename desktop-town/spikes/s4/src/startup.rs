//! First-frame safety handshake (QA finding PP-DT-QA-001 F5).
//!
//! Invariant: the overlay window is never shown, and its Pal input region is
//! never activated, until a frame has been *successfully presented*. Until
//! then the window is hidden AND has an empty window region, so it can neither
//! be seen nor intercept a click even if something else made it visible.
//!
//! The policy is written against the [`OverlayPort`] trait so every failure
//! path (Timeout, Lost, Outdated, fatal errors, region failure, deadline) is
//! exercised deterministically by unit tests with a fake port and fake clock.

use std::time::Duration;

/// Result of one attempt to render and present a frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FrameOutcome {
    Presented,
    /// Swapchain image not available in time; retry.
    Timeout,
    /// Surface lost; reconfigure, then retry.
    Lost,
    /// Surface no longer matches the window; reconfigure, then retry.
    Outdated,
    /// Unrecoverable (out of memory, device lost, ...); fail closed.
    Fatal(String),
}

/// Side effects the handshake needs. Implemented by the Win32/wgpu layer in
/// production and by a recording fake in tests.
pub trait OverlayPort {
    fn present(&mut self) -> FrameOutcome;
    fn reconfigure(&mut self);
    /// Installs the Pal-shaped window region (input becomes possible).
    fn activate_input(&mut self) -> Result<(), String>;
    /// Installs an empty window region (no pixel can receive input).
    fn deactivate_input(&mut self);
    fn show(&mut self);
    fn hide(&mut self);
    /// Time since the handshake began (monotonic).
    fn elapsed(&self) -> Duration;
    fn sleep(&mut self, duration: Duration);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    /// Overall budget; no new attempt starts after it is exhausted.
    pub deadline: Duration,
}

impl RetryPolicy {
    pub const STARTUP: Self = Self {
        max_attempts: 8,
        initial_backoff: Duration::from_millis(16),
        max_backoff: Duration::from_millis(250),
        deadline: Duration::from_secs(3),
    };

    /// Exponential backoff before attempt `attempt + 1` (attempt is 1-based).
    pub fn backoff_after(&self, attempt: u32) -> Duration {
        let factor = 1u32
            .checked_shl(attempt.saturating_sub(1))
            .unwrap_or(u32::MAX);
        self.initial_backoff
            .saturating_mul(factor)
            .min(self.max_backoff)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Startup {
    /// A frame was presented and the input region installed. `shown` says
    /// whether the window was made visible (false when policy, e.g. a
    /// fullscreen app, asked to start hidden).
    Ready { attempts: u32, shown: bool },
    /// Window left hidden with an empty input region; the caller must exit.
    FailedClosed { attempts: u32, reason: String },
}

fn fail_closed(port: &mut dyn OverlayPort, attempts: u32, reason: String) -> Startup {
    port.deactivate_input();
    port.hide();
    Startup::FailedClosed { attempts, reason }
}

/// Runs the bounded first-frame handshake. The caller must already have
/// created the window hidden with an empty input region.
pub fn first_frame(port: &mut dyn OverlayPort, policy: RetryPolicy, show: bool) -> Startup {
    let mut attempts = 0;
    let mut last = String::from("no attempt made");
    while attempts < policy.max_attempts && port.elapsed() < policy.deadline {
        attempts += 1;
        match port.present() {
            FrameOutcome::Presented => {
                if let Err(error) = port.activate_input() {
                    return fail_closed(port, attempts, format!("input region failed: {error}"));
                }
                if show {
                    port.show();
                }
                return Startup::Ready {
                    attempts,
                    shown: show,
                };
            }
            FrameOutcome::Fatal(error) => {
                return fail_closed(port, attempts, format!("fatal surface error: {error}"));
            }
            FrameOutcome::Lost | FrameOutcome::Outdated => {
                last = format!("attempt {attempts}: surface lost/outdated");
                port.reconfigure();
            }
            FrameOutcome::Timeout => {
                last = format!("attempt {attempts}: surface timeout");
            }
        }
        if attempts < policy.max_attempts {
            let remaining = policy.deadline.saturating_sub(port.elapsed());
            let wait = policy.backoff_after(attempts).min(remaining);
            if !wait.is_zero() {
                port.sleep(wait);
            }
        }
    }
    let reason = format!(
        "no frame presented after {attempts} attempt(s) in {:?} (last: {last})",
        port.elapsed()
    );
    fail_closed(port, attempts, reason)
}

/// Runtime re-show (e.g. after a fullscreen app closes): one non-blocking
/// attempt. The window becomes visible only if a fresh frame was presented;
/// otherwise it stays hidden and the caller retries on its next poll.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reveal {
    Shown,
    StayHidden,
    Fatal(String),
}

pub fn reveal(port: &mut dyn OverlayPort) -> Reveal {
    match port.present() {
        FrameOutcome::Presented => match port.activate_input() {
            Ok(()) => {
                port.show();
                Reveal::Shown
            }
            Err(error) => {
                port.deactivate_input();
                port.hide();
                Reveal::Fatal(format!("input region failed: {error}"))
            }
        },
        FrameOutcome::Lost | FrameOutcome::Outdated => {
            port.reconfigure();
            Reveal::StayHidden
        }
        FrameOutcome::Timeout => Reveal::StayHidden,
        FrameOutcome::Fatal(error) => {
            port.deactivate_input();
            port.hide();
            Reveal::Fatal(error)
        }
    }
}

/// Runtime redraw guard: a visible overlay that repeatedly cannot present is
/// hidden (and must be re-revealed through [`reveal`]) rather than left on
/// screen with stale or unpainted content and an active input region.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RedrawAction {
    Done,
    /// Reconfigure (if needed) and request another redraw.
    Retry {
        reconfigure: bool,
    },
    /// Too many consecutive failures: hide until a frame is presented.
    HideUntilPresented,
    Fatal,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SkipTracker {
    consecutive: u32,
}

impl SkipTracker {
    pub const LIMIT: u32 = 5;

    pub fn record(&mut self, outcome: &FrameOutcome) -> RedrawAction {
        match outcome {
            FrameOutcome::Presented => {
                self.consecutive = 0;
                RedrawAction::Done
            }
            FrameOutcome::Fatal(_) => RedrawAction::Fatal,
            skipped => {
                self.consecutive += 1;
                if self.consecutive >= Self::LIMIT {
                    self.consecutive = 0;
                    RedrawAction::HideUntilPresented
                } else {
                    RedrawAction::Retry {
                        reconfigure: matches!(skipped, FrameOutcome::Lost | FrameOutcome::Outdated),
                    }
                }
            }
        }
    }
}

/// QA-only fault injection (`--qa-fault-first-frame=KIND[:COUNT]`): the first
/// COUNT presentation attempts (or all, with `never`) report KIND without
/// presenting. Used by CI to exercise the real executable's fail-closed path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaultPlan {
    pub outcome: FrameOutcome,
    /// `None` = inject forever.
    pub remaining: Option<u32>,
}

impl FaultPlan {
    pub fn parse(spec: &str) -> Result<Self, String> {
        let (kind, count) = spec.split_once(':').unwrap_or((spec, "never"));
        let outcome = match kind {
            "timeout" => FrameOutcome::Timeout,
            "lost" => FrameOutcome::Lost,
            "outdated" => FrameOutcome::Outdated,
            "fatal" => FrameOutcome::Fatal("injected fatal fault".to_owned()),
            other => return Err(format!("unknown fault kind {other:?}")),
        };
        let remaining = if count == "never" {
            None
        } else {
            let n = count
                .parse::<u32>()
                .map_err(|_| format!("invalid fault count {count:?}"))?;
            if n == 0 || n > 1000 {
                return Err("fault count must be 1..=1000 or 'never'".to_owned());
            }
            Some(n)
        };
        Ok(Self { outcome, remaining })
    }

    /// Returns the injected outcome for this attempt, if any.
    pub fn next(&mut self) -> Option<FrameOutcome> {
        match self.remaining.as_mut() {
            None => Some(self.outcome.clone()),
            Some(0) => None,
            Some(n) => {
                *n -= 1;
                Some(self.outcome.clone())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum Call {
        Present,
        Reconfigure,
        Activate,
        Deactivate,
        Show,
        Hide,
        Sleep(u64),
    }

    /// Records calls and models what the OS would see: visibility and whether
    /// a non-empty input region is installed.
    struct FakePort {
        script: VecDeque<FrameOutcome>,
        calls: Vec<Call>,
        clock: Duration,
        present_cost: Duration,
        presented: bool,
        visible: bool,
        input_active: bool,
        activate_fails: bool,
        /// Safety violations observed at any point in time.
        violations: Vec<String>,
    }

    impl FakePort {
        fn new(script: &[FrameOutcome]) -> Self {
            Self {
                script: script.iter().cloned().collect(),
                calls: Vec::new(),
                clock: Duration::ZERO,
                present_cost: Duration::from_millis(1),
                presented: false,
                visible: false,
                input_active: false,
                activate_fails: false,
                violations: Vec::new(),
            }
        }

        fn check(&mut self) {
            if (self.visible || self.input_active) && !self.presented {
                self.violations.push(format!(
                    "visible={} input={} before any presented frame",
                    self.visible, self.input_active
                ));
            }
        }

        fn presents(&self) -> usize {
            self.calls.iter().filter(|c| **c == Call::Present).count()
        }
    }

    impl OverlayPort for FakePort {
        fn present(&mut self) -> FrameOutcome {
            self.calls.push(Call::Present);
            self.clock += self.present_cost;
            let outcome = self.script.pop_front().unwrap_or(FrameOutcome::Timeout);
            if outcome == FrameOutcome::Presented {
                self.presented = true;
            }
            outcome
        }
        fn reconfigure(&mut self) {
            self.calls.push(Call::Reconfigure);
        }
        fn activate_input(&mut self) -> Result<(), String> {
            self.calls.push(Call::Activate);
            if self.activate_fails {
                return Err("SetWindowRgn failed".to_owned());
            }
            self.input_active = true;
            self.check();
            Ok(())
        }
        fn deactivate_input(&mut self) {
            self.calls.push(Call::Deactivate);
            self.input_active = false;
        }
        fn show(&mut self) {
            self.calls.push(Call::Show);
            self.visible = true;
            self.check();
        }
        fn hide(&mut self) {
            self.calls.push(Call::Hide);
            self.visible = false;
        }
        fn elapsed(&self) -> Duration {
            self.clock
        }
        fn sleep(&mut self, duration: Duration) {
            self.calls.push(Call::Sleep(duration.as_millis() as u64));
            self.clock += duration;
        }
    }

    use FrameOutcome::{Lost, Outdated, Presented, Timeout};

    #[test]
    fn immediate_success_presents_then_activates_then_shows() {
        let mut port = FakePort::new(&[Presented]);
        let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
        assert_eq!(
            result,
            Startup::Ready {
                attempts: 1,
                shown: true
            }
        );
        assert_eq!(port.calls, vec![Call::Present, Call::Activate, Call::Show]);
        assert!(port.violations.is_empty());
    }

    #[test]
    fn timeout_then_success_never_shows_early() {
        let mut port = FakePort::new(&[Timeout, Timeout, Presented]);
        let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
        assert_eq!(
            result,
            Startup::Ready {
                attempts: 3,
                shown: true
            }
        );
        assert!(port.violations.is_empty(), "{:?}", port.violations);
        let first_show = port.calls.iter().position(|c| *c == Call::Show).unwrap();
        let first_activate = port
            .calls
            .iter()
            .position(|c| *c == Call::Activate)
            .unwrap();
        let last_present = port
            .calls
            .iter()
            .rposition(|c| *c == Call::Present)
            .unwrap();
        assert!(last_present < first_activate && first_activate < first_show);
        assert!(!port.calls.contains(&Call::Reconfigure));
    }

    #[test]
    fn lost_and_outdated_reconfigure_before_retry() {
        for skip in [Lost, Outdated] {
            let mut port = FakePort::new(&[skip.clone(), skip.clone(), Presented]);
            let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
            assert_eq!(
                result,
                Startup::Ready {
                    attempts: 3,
                    shown: true
                }
            );
            assert!(port.violations.is_empty());
            let reconfigures = port
                .calls
                .iter()
                .filter(|c| **c == Call::Reconfigure)
                .count();
            assert_eq!(reconfigures, 2, "{skip:?}");
            // Every retry after a reconfigure is preceded by that reconfigure.
            let positions: Vec<_> = port
                .calls
                .iter()
                .enumerate()
                .filter(|(_, c)| **c == Call::Present)
                .map(|(i, _)| i)
                .collect();
            for pair in positions.windows(2) {
                assert!(port.calls[pair[0]..pair[1]].contains(&Call::Reconfigure));
            }
        }
    }

    #[test]
    fn persistent_timeout_fails_closed_after_bounded_attempts() {
        let mut port = FakePort::new(&[]); // defaults to Timeout forever
        let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
        match result {
            Startup::FailedClosed { attempts, reason } => {
                assert_eq!(attempts, RetryPolicy::STARTUP.max_attempts);
                assert!(reason.contains("no frame presented"), "{reason}");
            }
            other => panic!("expected fail closed, got {other:?}"),
        }
        assert_eq!(port.presents(), RetryPolicy::STARTUP.max_attempts as usize);
        assert!(!port.calls.contains(&Call::Show));
        assert!(!port.calls.contains(&Call::Activate));
        assert!(!port.visible && !port.input_active);
        assert_eq!(port.calls.last(), Some(&Call::Hide));
        assert!(port.violations.is_empty());
    }

    #[test]
    fn persistent_lost_and_outdated_fail_closed() {
        for skip in [Lost, Outdated] {
            let script: Vec<_> = std::iter::repeat_n(skip.clone(), 64).collect();
            let mut port = FakePort::new(&script);
            let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
            assert!(matches!(result, Startup::FailedClosed { .. }), "{skip:?}");
            assert!(!port.calls.contains(&Call::Show));
            assert!(!port.calls.contains(&Call::Activate));
            assert!(port.calls.contains(&Call::Deactivate));
        }
    }

    #[test]
    fn deadline_bounds_total_wait_even_with_slow_presents() {
        let mut port = FakePort::new(&[]);
        port.present_cost = Duration::from_millis(900);
        let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
        let Startup::FailedClosed { attempts, .. } = result else {
            panic!("expected fail closed");
        };
        assert!(attempts < RetryPolicy::STARTUP.max_attempts);
        // Overshoot is bounded by a single in-flight attempt.
        assert!(port.clock <= RetryPolicy::STARTUP.deadline + port.present_cost);
        assert!(!port.visible && !port.input_active);
    }

    #[test]
    fn backoff_is_exponential_and_capped() {
        let p = RetryPolicy::STARTUP;
        let waits: Vec<u128> = (1..=8).map(|a| p.backoff_after(a).as_millis()).collect();
        assert_eq!(waits, vec![16, 32, 64, 128, 250, 250, 250, 250]);
        assert_eq!(p.backoff_after(200), p.max_backoff);
        let mut port = FakePort::new(&[Timeout, Timeout, Timeout, Presented]);
        first_frame(&mut port, p, true);
        let sleeps: Vec<_> = port
            .calls
            .iter()
            .filter_map(|c| match c {
                Call::Sleep(ms) => Some(*ms),
                _ => None,
            })
            .collect();
        assert_eq!(sleeps, vec![16, 32, 64]);
    }

    #[test]
    fn fatal_error_fails_closed_without_retry() {
        let mut port = FakePort::new(&[FrameOutcome::Fatal("OutOfMemory".into()), Presented]);
        let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
        assert!(matches!(result, Startup::FailedClosed { attempts: 1, .. }));
        assert_eq!(port.presents(), 1);
        assert!(!port.calls.contains(&Call::Show));
    }

    #[test]
    fn region_failure_after_present_fails_closed_and_never_shows() {
        let mut port = FakePort::new(&[Presented]);
        port.activate_fails = true;
        let result = first_frame(&mut port, RetryPolicy::STARTUP, true);
        assert!(matches!(result, Startup::FailedClosed { .. }));
        assert!(!port.calls.contains(&Call::Show));
        assert!(!port.input_active && !port.visible);
    }

    #[test]
    fn hidden_start_presents_and_activates_but_does_not_show() {
        let mut port = FakePort::new(&[Timeout, Presented]);
        let result = first_frame(&mut port, RetryPolicy::STARTUP, false);
        assert_eq!(
            result,
            Startup::Ready {
                attempts: 2,
                shown: false
            }
        );
        assert!(!port.calls.contains(&Call::Show));
        assert!(port.violations.is_empty());
    }

    #[test]
    fn reveal_shows_only_after_a_fresh_present() {
        for (outcome, expect_reconfigure) in [(Timeout, false), (Lost, true), (Outdated, true)] {
            let mut port = FakePort::new(&[outcome.clone()]);
            assert_eq!(reveal(&mut port), Reveal::StayHidden, "{outcome:?}");
            assert!(!port.calls.contains(&Call::Show));
            assert_eq!(port.calls.contains(&Call::Reconfigure), expect_reconfigure);
        }
        let mut port = FakePort::new(&[Presented]);
        assert_eq!(reveal(&mut port), Reveal::Shown);
        assert_eq!(port.calls, vec![Call::Present, Call::Activate, Call::Show]);
        let mut port = FakePort::new(&[FrameOutcome::Fatal("lost device".into())]);
        assert!(matches!(reveal(&mut port), Reveal::Fatal(_)));
        assert_eq!(port.calls.last(), Some(&Call::Hide));
    }

    #[test]
    fn runtime_skips_hide_overlay_after_limit_and_reset_on_success() {
        let mut tracker = SkipTracker::default();
        for _ in 1..SkipTracker::LIMIT {
            assert_eq!(
                tracker.record(&Timeout),
                RedrawAction::Retry { reconfigure: false }
            );
        }
        assert_eq!(tracker.record(&Lost), RedrawAction::HideUntilPresented);
        assert_eq!(
            tracker.record(&Outdated),
            RedrawAction::Retry { reconfigure: true }
        );
        assert_eq!(tracker.record(&Presented), RedrawAction::Done);
        for _ in 1..SkipTracker::LIMIT {
            assert!(matches!(
                tracker.record(&Timeout),
                RedrawAction::Retry { .. }
            ));
        }
        assert_eq!(
            tracker.record(&FrameOutcome::Fatal("x".into())),
            RedrawAction::Fatal
        );
    }

    #[test]
    fn fault_plan_parsing_and_counting() {
        let mut plan = FaultPlan::parse("lost:2").unwrap();
        assert_eq!(plan.next(), Some(Lost));
        assert_eq!(plan.next(), Some(Lost));
        assert_eq!(plan.next(), None);
        let mut never = FaultPlan::parse("timeout").unwrap();
        for _ in 0..100 {
            assert_eq!(never.next(), Some(Timeout));
        }
        assert_eq!(FaultPlan::parse("outdated:never").unwrap().remaining, None);
        assert!(FaultPlan::parse("fatal:1").is_ok());
        for bad in ["", "boom", "lost:0", "lost:-1", "lost:x", "lost:1001"] {
            assert!(FaultPlan::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn injected_faults_drive_the_real_policy() {
        // Mirrors the executable: injection wraps the real present path.
        for spec in ["timeout:3", "lost:3", "outdated:3"] {
            let mut plan = FaultPlan::parse(spec).unwrap();
            let mut port = FakePort::new(&std::iter::repeat_n(Presented, 8).collect::<Vec<_>>());
            let mut wrapped = Injected {
                plan: &mut plan,
                inner: &mut port,
            };
            let result = first_frame(&mut wrapped, RetryPolicy::STARTUP, true);
            assert_eq!(
                result,
                Startup::Ready {
                    attempts: 4,
                    shown: true
                },
                "{spec}"
            );
            assert!(port.violations.is_empty());
        }
        let mut plan = FaultPlan::parse("timeout:never").unwrap();
        let mut port = FakePort::new(&std::iter::repeat_n(Presented, 8).collect::<Vec<_>>());
        let mut wrapped = Injected {
            plan: &mut plan,
            inner: &mut port,
        };
        assert!(matches!(
            first_frame(&mut wrapped, RetryPolicy::STARTUP, true),
            Startup::FailedClosed { .. }
        ));
        assert!(!port.presented && !port.visible && !port.input_active);
    }

    struct Injected<'a> {
        plan: &'a mut FaultPlan,
        inner: &'a mut FakePort,
    }

    impl OverlayPort for Injected<'_> {
        fn present(&mut self) -> FrameOutcome {
            match self.plan.next() {
                Some(outcome) => {
                    self.inner.clock += self.inner.present_cost;
                    outcome
                }
                None => self.inner.present(),
            }
        }
        fn reconfigure(&mut self) {
            self.inner.reconfigure();
        }
        fn activate_input(&mut self) -> Result<(), String> {
            self.inner.activate_input()
        }
        fn deactivate_input(&mut self) {
            self.inner.deactivate_input();
        }
        fn show(&mut self) {
            self.inner.show();
        }
        fn hide(&mut self) {
            self.inner.hide();
        }
        fn elapsed(&self) -> Duration {
            self.inner.elapsed()
        }
        fn sleep(&mut self, duration: Duration) {
            self.inner.sleep(duration);
        }
    }
}
