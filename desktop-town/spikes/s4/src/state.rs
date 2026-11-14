//! Portable demo state contains NO secrets, account data, or network endpoints.
use serde::{Deserialize, Serialize};

pub const STATE_VERSION: u32 = 1;
const WALK_START_X: i32 = 100;
const WALK_END_X: i32 = 410;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DemoState {
    pub version: u32,
    pub pal_x: i32,
    pub pal_y: i32,
    pub pal_clicks: u64,
    pub animate: bool,
}

impl Default for DemoState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            pal_x: 100,
            pal_y: 170,
            pal_clicks: 0,
            animate: false,
        }
    }
}

impl DemoState {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != STATE_VERSION {
            return Err("unsupported settings version");
        }
        if !(0..=500).contains(&self.pal_x) || !(0..=250).contains(&self.pal_y) {
            return Err("invalid pal position");
        }
        Ok(())
    }

    /// Counts a Pal click without changing motion (used by the smoke harness).
    pub fn record_click(&mut self) {
        self.pal_clicks = self.pal_clicks.saturating_add(1);
    }

    /// Real left-click on the Pal: count it and toggle walking.
    pub fn click(&mut self) {
        self.record_click();
        self.animate = !self.animate;
        if self.animate && self.pal_x == WALK_END_X {
            self.pal_x = WALK_START_X;
        }
    }

    pub fn step(&mut self, elapsed_ms: u64) -> bool {
        if !self.animate {
            return false;
        }
        // Deterministic bounded walk, approximately 60px/s.
        let pixels = ((elapsed_ms.min(100) * 60) / 1000).max(1) as i32;
        self.pal_x = (self.pal_x + pixels).min(WALK_END_X);
        if self.pal_x == WALK_END_X {
            self.animate = false;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_and_bounds_reject_corruption() {
        let mut state = DemoState {
            version: 999,
            ..DemoState::default()
        };
        assert!(state.validate().is_err());
        state.version = STATE_VERSION;
        state.pal_x = -99;
        assert!(state.validate().is_err());
    }

    #[test]
    fn secrets_cannot_be_deserialized_or_serialized() {
        let serialized = serde_json::to_string(&DemoState::default()).unwrap();
        assert!(!serialized.contains("token"));
        assert!(!serialized.contains("password"));
        let injected = serialized.replace("\"version\":1", "\"version\":1,\"api_key\":\"secret\"");
        assert!(serde_json::from_str::<DemoState>(&injected).is_err());
    }

    #[test]
    fn walking_stops_at_boundary() {
        let mut state = DemoState {
            animate: true,
            pal_x: 409,
            ..DemoState::default()
        };
        assert!(state.step(100));
        assert_eq!(state.pal_x, 410);
        assert!(!state.animate);
        assert!(!state.step(100));
    }

    #[test]
    fn click_toggles_walk_and_restarts_from_boundary() {
        let mut state = DemoState {
            pal_x: 410,
            ..DemoState::default()
        };
        state.click();
        assert!(state.animate);
        assert_eq!(state.pal_x, 100);
        assert_eq!(state.pal_clicks, 1);
        state.click();
        assert!(!state.animate);
        assert_eq!(state.pal_clicks, 2);
    }

    #[test]
    fn record_click_saturates_and_keeps_motion() {
        let mut state = DemoState {
            pal_clicks: u64::MAX,
            ..DemoState::default()
        };
        state.record_click();
        assert_eq!(state.pal_clicks, u64::MAX);
        assert!(!state.animate);
    }
}
