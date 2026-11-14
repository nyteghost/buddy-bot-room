//! Spike S1 library: pure geometry, motion and CLI parsing. Nothing in this
//! crate root touches GTK, Wayland, the network or the filesystem, so it is
//! fully unit-testable without a display.
pub mod cli;
pub mod model;
