//! Portable demo state contains NO secrets, account data, or network endpoints.
use serde::{Deserialize, Serialize};

pub const STATE_VERSION: u32 = 1;

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
        Self { version: STATE_VERSION, pal_x: 100, pal_y: 170, pal_clicks: 0, animate: false }
    }
}

impl DemoState {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != STATE_VERSION { return Err("unsupported settings version"); }
        if !(0..=500).contains(&self.pal_x) || !(0..=250).contains(&self.pal_y) {
            return Err("invalid pal position");
        }
        Ok(())
    }

    pub fn step(&mut self, elapsed_ms: u64) -> bool {
        if !self.animate { return false; }
        // Deterministic bounded walk, approximately 60px/s.
        let pixels = ((elapsed_ms.min(100) * 60) / 1000).max(1) as i32;
        self.pal_x = (self.pal_x + pixels).min(410);
        if self.pal_x == 410 { self.animate = false; }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_and_bounds_reject_corruption() {
        let mut state = DemoState::default();
        state.version = 999;
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
        let mut state = DemoState { animate: true, pal_x: 409, ..DemoState::default() };
        assert!(state.step(100));
        assert_eq!(state.pal_x, 410);
        assert!(!state.animate);
        assert!(!state.step(100));
    }
}
