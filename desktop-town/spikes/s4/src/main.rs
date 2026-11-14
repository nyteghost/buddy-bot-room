#![forbid(unsafe_op_in_unsafe_fn)]

#[cfg(any(windows, test))]
mod geometry;
#[cfg(any(windows, test))]
mod portable;
#[cfg(any(windows, test))]
mod state;

#[cfg(windows)]
mod windows;

#[cfg(windows)]
fn main() {
    if let Err(error) = windows::run() {
        eprintln!("S4 fail-closed: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("S4 native overlay requires Windows 11; pure unit tests also run on Linux.");
}
