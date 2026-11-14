#![forbid(unsafe_op_in_unsafe_fn)]
// Release builds are GUI-subsystem executables: double-clicking PixelPals.exe
// must not open a console window. Diagnostics go to Data/s4-last-run.log.
// Debug builds keep the console for developer stderr output.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod adapter_policy;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod cli;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod fullscreen;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod geometry;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod memory;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod portable;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod schedule;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod startup;
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
mod state;

#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    std::process::exit(windows::main_exit_code());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("S4 native overlay requires Windows 11; pure unit tests also run on Linux.");
}
