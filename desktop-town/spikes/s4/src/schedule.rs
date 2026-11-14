//! Event-loop wake-up policy (idle suspension), separated from Win32 so it is
//! unit-testable. The overlay renders only on state changes; the only timers
//! are the fullscreen probe and, while visibly walking, the animation tick.

use std::time::Duration;

pub const ANIMATION_TICK: Duration = Duration::from_millis(33);
pub const FULLSCREEN_POLL_VISIBLE: Duration = Duration::from_millis(500);
pub const FULLSCREEN_POLL_HIDDEN: Duration = Duration::from_millis(1000);

/// Animation advances only when the overlay is visible AND walking; a hidden
/// (fullscreen-suppressed or presentation-failed) overlay is fully paused.
pub fn animation_active(visible: bool, walking: bool) -> bool {
    visible && walking
}

pub fn fullscreen_poll_interval(visible: bool) -> Duration {
    if visible {
        FULLSCREEN_POLL_VISIBLE
    } else {
        FULLSCREEN_POLL_HIDDEN
    }
}

/// Earliest of the pending timers. `animation_tick` must be `None` unless
/// [`animation_active`] is true, so idle and hidden states never wake for it.
pub fn next_wake<T: Ord + Copy>(
    fullscreen_poll: T,
    animation_tick: Option<T>,
    smoke_deadline: Option<T>,
) -> T {
    [animation_tick, smoke_deadline]
        .into_iter()
        .flatten()
        .fold(fullscreen_poll, Ord::min)
}

/// Upper bound on wake-ups per second for a state, used by tests to pin the
/// idle cost (each wake-up is one AboutToWait iteration).
#[cfg(test)]
pub fn max_wakeups_per_second(visible: bool, walking: bool) -> u32 {
    let poll = 1000 / fullscreen_poll_interval(visible).as_millis() as u32;
    if animation_active(visible, walking) {
        poll + 1000 / ANIMATION_TICK.as_millis() as u32
    } else {
        poll
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_visible_wakes_only_for_fullscreen_probe() {
        assert!(!animation_active(true, false));
        assert_eq!(next_wake(500u64, None, None), 500);
        assert_eq!(max_wakeups_per_second(true, false), 2);
    }

    #[test]
    fn hidden_overlay_is_paused_even_while_walking() {
        assert!(!animation_active(false, true));
        assert_eq!(max_wakeups_per_second(false, true), 1);
        assert_eq!(fullscreen_poll_interval(false), FULLSCREEN_POLL_HIDDEN);
    }

    #[test]
    fn walking_uses_the_earliest_timer() {
        assert!(animation_active(true, true));
        assert_eq!(next_wake(500u64, Some(33), None), 33);
        assert_eq!(next_wake(500u64, Some(33), Some(10)), 10);
        assert_eq!(next_wake(20u64, Some(33), Some(40)), 20);
        assert_eq!(max_wakeups_per_second(true, true), 2 + 30);
    }

    #[test]
    fn smoke_deadline_is_honoured_when_idle() {
        assert_eq!(next_wake(500u64, None, Some(120)), 120);
        assert_eq!(next_wake(500u64, None, Some(900)), 500);
    }
}
