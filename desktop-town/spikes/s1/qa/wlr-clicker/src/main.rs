//! QA-only virtual pointer for *wlroots* compositors (sway, headless CI).
//! KWin does not expose zwlr_virtual_pointer_v1 to ordinary clients, so on
//! the owner's KDE desktop clicks are performed by a human instead.
//!
//! Reads commands from stdin, one per line, coordinates in compositor layout
//! (logical) pixels:
//!   extent W H     total layout size used for absolute motion (required first)
//!   move X Y
//!   click X Y      move, press and release BTN_LEFT
//!   sleep MS
//! Prints `CLICKER_OK <line>` after each command so the driver can pace itself.
use std::io::{BufRead, Write};
use std::thread::sleep;
use std::time::{Duration, Instant};

use wayland_client::globals::{GlobalListContents, registry_queue_init};
use wayland_client::protocol::{wl_pointer::ButtonState, wl_registry, wl_seat};
use wayland_client::{Connection, Dispatch, QueueHandle};
use wayland_protocols_wlr::virtual_pointer::v1::client::{
    zwlr_virtual_pointer_manager_v1::ZwlrVirtualPointerManagerV1, zwlr_virtual_pointer_v1::ZwlrVirtualPointerV1,
};

const BTN_LEFT: u32 = 0x110;

struct State;

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
impl Dispatch<wl_seat::WlSeat, ()> for State {
    fn event(_: &mut Self, _: &wl_seat::WlSeat, _: wl_seat::Event, _: &(), _: &Connection, _: &QueueHandle<Self>) {}
}
impl Dispatch<ZwlrVirtualPointerManagerV1, ()> for State {
    fn event(
        _: &mut Self,
        _: &ZwlrVirtualPointerManagerV1,
        _: <ZwlrVirtualPointerManagerV1 as wayland_client::Proxy>::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}
impl Dispatch<ZwlrVirtualPointerV1, ()> for State {
    fn event(
        _: &mut Self,
        _: &ZwlrVirtualPointerV1,
        _: <ZwlrVirtualPointerV1 as wayland_client::Proxy>::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

fn parse_u32(s: Option<&str>) -> Result<u32, String> {
    s.ok_or("missing number")?.parse::<f64>().map_err(|e| e.to_string()).and_then(|v| {
        if v.is_finite() && (0.0..=65_535.0).contains(&v) { Ok(v.round() as u32) } else { Err("out of range".into()) }
    })
}

fn main() -> Result<(), String> {
    let conn = Connection::connect_to_env().map_err(|e| format!("connect: {e}"))?;
    let (globals, mut queue) = registry_queue_init::<State>(&conn).map_err(|e| format!("registry: {e}"))?;
    let qh = queue.handle();
    let seat: wl_seat::WlSeat = globals.bind(&qh, 1..=7, ()).map_err(|e| format!("wl_seat: {e}"))?;
    let manager: ZwlrVirtualPointerManagerV1 =
        globals.bind(&qh, 1..=2, ()).map_err(|e| format!("zwlr_virtual_pointer_manager_v1: {e}"))?;
    let pointer = manager.create_virtual_pointer(Some(&seat), &qh, ());
    queue.roundtrip(&mut State).map_err(|e| e.to_string())?;
    // Give clients time to see the new wl_pointer seat capability.
    sleep(Duration::from_millis(400));
    let started = Instant::now();
    let now = || u32::try_from(started.elapsed().as_millis() % u128::from(u32::MAX)).unwrap_or(0);
    let mut extent: Option<(u32, u32)> = None;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        let mut parts = line.split_whitespace();
        let result: Result<(), String> = match parts.next() {
            None => Ok(()),
            Some("extent") => {
                let w = parse_u32(parts.next())?;
                let h = parse_u32(parts.next())?;
                extent = (w > 0 && h > 0).then_some((w, h));
                extent.map(|_| ()).ok_or_else(|| "extent must be positive".into())
            }
            Some("sleep") => {
                sleep(Duration::from_millis(u64::from(parse_u32(parts.next())?)));
                Ok(())
            }
            Some(cmd @ ("move" | "click")) => {
                let (w, h) = extent.ok_or("extent first")?;
                let x = parse_u32(parts.next())?.min(w - 1);
                let y = parse_u32(parts.next())?.min(h - 1);
                pointer.motion_absolute(now(), x, y, w, h);
                pointer.frame();
                conn.flush().map_err(|e| e.to_string())?;
                if cmd == "click" {
                    sleep(Duration::from_millis(40));
                    pointer.button(now(), BTN_LEFT, ButtonState::Pressed);
                    pointer.frame();
                    conn.flush().map_err(|e| e.to_string())?;
                    sleep(Duration::from_millis(30));
                    pointer.button(now(), BTN_LEFT, ButtonState::Released);
                    pointer.frame();
                }
                conn.flush().map_err(|e| e.to_string())?;
                queue.roundtrip(&mut State).map_err(|e| e.to_string())?;
                Ok(())
            }
            Some(other) => Err(format!("unknown command {other}")),
        };
        match result {
            Ok(()) => writeln!(stdout, "CLICKER_OK {line}"),
            Err(e) => writeln!(stdout, "CLICKER_ERR {line} {e}"),
        }
        .map_err(|e| e.to_string())?;
        stdout.flush().map_err(|e| e.to_string())?;
    }
    pointer.destroy();
    conn.flush().map_err(|e| e.to_string())?;
    Ok(())
}
