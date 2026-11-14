//! Pure "should the overlay step aside?" policy. The Win32 layer gathers facts
//! (foreground window rectangle, class, caption style, shell notification
//! state) and this module decides, so the policy is unit-testable on any OS.
//!
//! Policy is deliberately conservative: when in doubt, hide. A hidden overlay
//! costs nothing; an overlay on top of a presentation or a game is a failure.

use crate::geometry::Rect;

/// Shell-reported state (SHQueryUserNotificationState). Only the states that
/// apply regardless of which monitor we are on are modelled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellState {
    Normal,
    /// Exclusive-mode Direct3D application is running (QUNS_RUNNING_D3D_FULL_SCREEN).
    D3dFullscreen,
    /// Windows presentation settings are active (QUNS_PRESENTATION_MODE).
    PresentationMode,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Foreground {
    pub rect: Rect,
    /// Full bounds of the monitor the foreground window is on.
    pub monitor: Rect,
    /// True when the foreground window is on the same monitor as the overlay.
    pub same_monitor_as_overlay: bool,
    /// True when the window has a full caption (title bar): a maximised
    /// ordinary window with an auto-hide taskbar covers the monitor too, but is
    /// not a fullscreen presentation.
    pub has_caption: bool,
    pub class_name: String,
}

/// Desktop/shell surfaces that legitimately cover the whole monitor when the
/// user clicks the wallpaper. They must never be treated as fullscreen apps.
const SHELL_CLASSES: [&str; 3] = ["Progman", "WorkerW", "Shell_TrayWnd"];

/// Two-pixel tolerance for compositor and border rounding differences.
const TOLERANCE: i32 = 2;

pub fn covers_monitor(window: Rect, monitor: Rect) -> bool {
    window.x <= monitor.x + TOLERANCE
        && window.y <= monitor.y + TOLERANCE
        && window.right() >= monitor.right() - TOLERANCE
        && window.bottom() >= monitor.bottom() - TOLERANCE
}

pub fn should_hide(shell: ShellState, foreground: Option<&Foreground>) -> bool {
    if shell != ShellState::Normal {
        return true;
    }
    let Some(front) = foreground else {
        return false;
    };
    if !front.same_monitor_as_overlay {
        return false;
    }
    if SHELL_CLASSES
        .iter()
        .any(|class| class.eq_ignore_ascii_case(&front.class_name))
    {
        return false;
    }
    !front.has_caption && covers_monitor(front.rect, front.monitor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Rect = Rect::new(0, 0, 1920, 1080);

    fn front(rect: Rect, caption: bool, class: &str, same: bool) -> Foreground {
        Foreground {
            rect,
            monitor: MONITOR,
            same_monitor_as_overlay: same,
            has_caption: caption,
            class_name: class.to_owned(),
        }
    }

    #[test]
    fn borderless_fullscreen_on_our_monitor_hides() {
        let game = front(MONITOR, false, "UnityWndClass", true);
        assert!(should_hide(ShellState::Normal, Some(&game)));
    }

    #[test]
    fn fullscreen_on_other_monitor_does_not_hide() {
        let game = front(MONITOR, false, "UnityWndClass", false);
        assert!(!should_hide(ShellState::Normal, Some(&game)));
    }

    #[test]
    fn desktop_wallpaper_focus_is_not_fullscreen() {
        for class in ["Progman", "WorkerW", "progman"] {
            let desktop = front(MONITOR, false, class, true);
            assert!(!should_hide(ShellState::Normal, Some(&desktop)), "{class}");
        }
    }

    #[test]
    fn maximised_captioned_window_with_autohide_taskbar_is_not_fullscreen() {
        let editor = front(Rect::new(-8, -8, 1936, 1096), true, "Notepad", true);
        assert!(!should_hide(ShellState::Normal, Some(&editor)));
    }

    #[test]
    fn ordinary_window_does_not_hide() {
        let small = front(
            Rect::new(100, 100, 800, 600),
            false,
            "Chrome_WidgetWin_1",
            true,
        );
        assert!(!should_hide(ShellState::Normal, Some(&small)));
    }

    #[test]
    fn exclusive_d3d_and_presentation_mode_always_hide() {
        assert!(should_hide(ShellState::D3dFullscreen, None));
        assert!(should_hide(ShellState::PresentationMode, None));
    }

    #[test]
    fn tolerance_is_two_pixels() {
        assert!(covers_monitor(Rect::new(2, 2, 1916, 1076), MONITOR));
        assert!(!covers_monitor(Rect::new(3, 0, 1917, 1080), MONITOR));
    }

    #[test]
    fn negative_virtual_coordinates() {
        let monitor = Rect::new(-1920, -300, 1920, 1080);
        let mut game = front(monitor, false, "SDL_app", true);
        game.monitor = monitor;
        assert!(should_hide(ShellState::Normal, Some(&game)));
    }
}
