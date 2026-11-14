//! Spike S1: standalone native GTK4 layer-shell window; deliberately NO Tauri,
//! browser, HTTP, system hooks, production data access, or privileged APIs.
//!
//! Every line the QA harness relies on is prefixed `S1_` and printed to
//! stdout (normal events) or stderr (fallback/failure events).

use std::cell::{Cell, RefCell};
use std::f64::consts::TAU;
use std::process::ExitCode;
use std::rc::Rc;
use std::time::Duration;

use gtk::cairo;
use gtk::gdk;
use gtk::glib;
use gtk::prelude::*;
use gtk4 as gtk;
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

use pixel_pals_s1::cli::{HELP, LayerChoice, Mode, MonitorChoice, Options, Parsed};
use pixel_pals_s1::model::{Motion, Pal, Rect, Size, bounding_box, region_contains, to_surface_rows};

const RADIUS: f64 = 24.0;
const TICK_MILLIS: u64 = 80;
/// Exit status when `--require-overlay` cannot obtain a verified overlay.
const EXIT_OVERLAY_UNAVAILABLE: u8 = 2;
const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;

fn main() -> ExitCode {
    let (options, parsed) = match Options::parse(std::env::args().skip(1)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("S1_ARGS_ERROR {e}");
            return ExitCode::from(2);
        }
    };
    if parsed == Parsed::Help {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    // NON_UNIQUE permits reliable parallel launches / lifecycle regression runs.
    let app = gtk::Application::builder()
        .application_id("org.pixelpals.spike.s1")
        .flags(gtk::gio::ApplicationFlags::NON_UNIQUE)
        .build();
    let forced_exit = Rc::new(Cell::new(None::<u8>));
    app.connect_activate({
        let forced_exit = forced_exit.clone();
        move |app| activate(app, &options, &forced_exit)
    });
    // Never forward our own argv to GApplication: it would reject our flags.
    let status = app.run_with_args(&[] as &[&str]);
    if let Some(code) = forced_exit.get() {
        return ExitCode::from(code);
    }
    if status == glib::ExitCode::SUCCESS { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

fn activate(app: &gtk::Application, options: &Options, forced_exit: &Rc<Cell<Option<u8>>>) {
    install_lifetime_guards(app, options.seconds);

    if let Mode::QaUnderlay { fullscreen } = options.mode {
        show_qa_underlay(app, fullscreen);
        return;
    }

    let fail_or_fallback = |reason: &str| {
        eprintln!("S1_SAFE_FALLBACK reason={reason}");
        if options.require_overlay {
            eprintln!("S1_REQUIRE_OVERLAY_EXIT code={EXIT_OVERLAY_UNAVAILABLE}");
            forced_exit.set(Some(EXIT_OVERLAY_UNAVAILABLE));
            app.quit();
        } else {
            show_town_only(app, reason);
        }
    };

    let Some(display) = gdk::Display::default() else {
        fail_or_fallback("No graphical display available");
        return;
    };

    // Ask GDK which backend it actually chose; env vars can lie (e.g.
    // GDK_BACKEND=x11 inside a Wayland session).
    let wayland = display.type_().name() == "GdkWaylandDisplay";
    if options.mode == Mode::TownOnly {
        fail_or_fallback("Forced by --town-only");
        return;
    }
    if !wayland {
        fail_or_fallback("Not a native Wayland GDK display");
        return;
    }
    if !gtk4_layer_shell::is_supported() {
        fail_or_fallback("Compositor lacks layer-shell protocol");
        return;
    }
    if !display.supports_input_shapes() {
        fail_or_fallback("Input regions not supported by GDK backend");
        return;
    }

    let provider = gtk::CssProvider::new();
    provider.load_from_string(
        "window.pp-s1-overlay, window.pp-s1-overlay > * { background: transparent; \
         background-image: none; box-shadow: none; border: none; }",
    );
    gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);

    let monitors = display.monitors();
    let all: Vec<gdk::Monitor> = (0..monitors.n_items())
        .filter_map(|i| monitors.item(i).and_then(|o| o.downcast::<gdk::Monitor>().ok()))
        .collect();
    let chosen: Vec<(usize, gdk::Monitor)> = match &options.monitor {
        MonitorChoice::All => all.iter().cloned().enumerate().collect(),
        MonitorChoice::Index(i) => all.get(*i).cloned().map(|m| vec![(*i, m)]).unwrap_or_default(),
        MonitorChoice::Connector(name) => all
            .iter()
            .enumerate()
            .filter(|(_, m)| m.connector().as_deref() == Some(name.as_str()))
            .map(|(i, m)| (i, m.clone()))
            .collect(),
    };
    for (i, m) in all.iter().enumerate() {
        println!(
            "S1_OUTPUT index={i} connector={} geometry={}x{}+{}+{} scale={:.3} scale_factor={}",
            m.connector().as_deref().unwrap_or("unknown"),
            m.geometry().width(),
            m.geometry().height(),
            m.geometry().x(),
            m.geometry().y(),
            m.scale(),
            m.scale_factor()
        );
    }
    if chosen.is_empty() {
        fail_or_fallback(&format!("Requested monitor unavailable count={}", all.len()));
        return;
    }
    for (index, monitor) in &chosen {
        create_overlay(app, monitor, *index, options);
    }

    // Output added/removed: quit and release *all* input regions; relaunch
    // explicitly. Live re-targeting across outputs is a separate gate.
    monitors.connect_items_changed({
        let app = app.clone();
        move |_, _, removed, added| {
            println!("S1_HOTPLUG_EXIT removed={removed} added={added} releasing all surfaces");
            app.quit();
        }
    });
}

/// Bounded lifetime in every mode (overlay, town-only, QA underlay) plus clean
/// exit on SIGINT/SIGTERM so a stuck overlay can always be removed.
fn install_lifetime_guards(app: &gtk::Application, seconds: u32) {
    glib::timeout_add_seconds_local(seconds, {
        let app = app.clone();
        move || {
            println!("S1_TIMEOUT_EXIT seconds={seconds}");
            app.quit();
            glib::ControlFlow::Break
        }
    });
    for (signum, name) in [(SIGINT, "SIGINT"), (SIGTERM, "SIGTERM")] {
        glib_unix::unix_signal_add_local(signum, {
            let app = app.clone();
            move || {
                println!("S1_SIGNAL_EXIT signal={name}");
                app.quit();
                glib::ControlFlow::Break
            }
        });
    }
}

struct Overlay {
    label: String,
    window: gtk::ApplicationWindow,
    drawing: gtk::DrawingArea,
    motion: RefCell<Motion>,
    rows: RefCell<Vec<Rect>>,
    last_bbox: Cell<Option<Rect>>,
    trace: bool,
    clicks: Cell<u64>,
}

impl Overlay {
    fn pal(&self) -> Pal {
        Pal { x: self.motion.borrow().x, y: f64::from(self.drawing.height()) / 2.0, radius: RADIUS }
    }

    /// Recompute the Pal hitbox and hand it to GDK. Never passes a "full"
    /// region: an empty list stays an empty (fully click-through) region.
    fn update_region(&self) {
        let Some(surface) = self.window.surface() else { return };
        let widget_rows = self.pal().input_rows(Size { width: self.drawing.width(), height: self.drawing.height() });
        // Drawing-area origin in surface coordinates (window CSS/CSD offset
        // plus the native surface transform). Unknown → fail closed (empty).
        let origin = self.drawing.compute_point(&self.window, &gtk::graphene::Point::new(0.0, 0.0)).map(|p| {
            let (tx, ty) = self.window.surface_transform();
            (f64::from(p.x()) + tx, f64::from(p.y()) + ty)
        });
        let surface_rows = match origin {
            Some((ox, oy)) => {
                to_surface_rows(&widget_rows, ox, oy, Size { width: surface.width(), height: surface.height() })
            }
            None => Vec::new(),
        };
        let rects: Vec<cairo::RectangleInt> =
            surface_rows.iter().map(|r| cairo::RectangleInt::new(r.x, r.y, r.width, r.height)).collect();
        // Always Some(..): GDK treats None as "whole surface accepts input".
        surface.set_input_region(Some(&cairo::Region::create_rectangles(&rects)));
        let bbox = bounding_box(&surface_rows);
        if self.trace && bbox != self.last_bbox.get() {
            match bbox {
                Some(b) => println!(
                    "S1_REGION monitor={} rows={} bbox={},{},{},{} surface={}x{}",
                    self.label,
                    surface_rows.len(),
                    b.x,
                    b.y,
                    b.width,
                    b.height,
                    surface.width(),
                    surface.height()
                ),
                None => println!("S1_REGION monitor={} rows=0 bbox=empty", self.label),
            }
        }
        self.last_bbox.set(bbox);
        *self.rows.borrow_mut() = widget_rows;
    }
}

fn create_overlay(app: &gtk::Application, monitor: &gdk::Monitor, index: usize, opts: &Options) {
    let geometry = monitor.geometry();
    let label = monitor.connector().map_or_else(|| format!("index{index}"), |c| c.to_string());
    let window = gtk::ApplicationWindow::builder()
        .application(app)
        .title("Pixel Pals S1 transparent overlay")
        .decorated(false)
        .default_width(geometry.width())
        .default_height(geometry.height())
        .build();
    window.add_css_class("pp-s1-overlay");
    // CRITICAL: layer-shell must be configured before the first realize/map.
    window.init_layer_shell();
    window.set_namespace(Some("pixel-pals-spike-s1"));
    window.set_layer(match opts.layer {
        LayerChoice::Top => Layer::Top,
        LayerChoice::Bottom => Layer::Bottom,
    });
    window.set_keyboard_mode(KeyboardMode::None);
    // 0 = do not reserve space and stay clear of panels' exclusive zones.
    window.set_exclusive_zone(0);
    for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
        window.set_anchor(edge, true);
    }
    window.set_monitor(Some(monitor));

    let drawing = gtk::DrawingArea::new();
    drawing.set_hexpand(true);
    drawing.set_vexpand(true);
    window.set_child(Some(&drawing));

    let overlay = Rc::new(Overlay {
        label: label.clone(),
        window: window.clone(),
        drawing: drawing.clone(),
        motion: RefCell::new(Motion::new(geometry.width(), opts.speed)),
        rows: RefCell::new(Vec::new()),
        last_bbox: Cell::new(None),
        trace: opts.trace_region,
        clicks: Cell::new(0),
    });

    drawing.set_draw_func({
        let overlay = Rc::downgrade(&overlay);
        move |_, cr, width, height| {
            // Transparent pixels everywhere except the visible art.
            cr.set_operator(cairo::Operator::Clear);
            let _ = cr.paint();
            cr.set_operator(cairo::Operator::Over);
            let Some(overlay) = overlay.upgrade() else { return };
            let pal = overlay.pal();
            // Very faint home marker: decoration ONLY, never a hit target.
            cr.set_source_rgba(0.1, 0.9, 0.8, 0.22);
            cr.rectangle(f64::from(width) / 2.0 - 20.0, f64::from(height) / 2.0 + 40.0, 40.0, 16.0);
            let _ = cr.fill();
            cr.set_source_rgba(0.22, 0.79, 0.98, 0.96);
            cr.arc(pal.x, pal.y, pal.radius, 0.0, TAU);
            let _ = cr.fill();
            cr.set_source_rgba(0.04, 0.1, 0.22, 1.0);
            cr.arc(pal.x - 7.0, pal.y - 4.0, 3.0, 0.0, TAU);
            let _ = cr.fill();
            cr.arc(pal.x + 7.0, pal.y - 4.0, 3.0, 0.0, TAU);
            let _ = cr.fill();
        }
    });

    let click = gtk::GestureClick::new();
    click.connect_pressed({
        let overlay = Rc::downgrade(&overlay);
        move |_, _, x, y| {
            let Some(o) = overlay.upgrade() else { return };
            // Same pixel membership rule the compositor uses for the region.
            if region_contains(&o.rows.borrow(), x, y) {
                let next = o.clicks.get() + 1;
                o.clicks.set(next);
                println!("S1_PAL_CLICK monitor={} count={next} x={x:.1} y={y:.1}", o.label);
            } else {
                // Delivered outside the region we set: click-through FAILED.
                eprintln!("S1_SPURIOUS_CLICK monitor={} x={x:.1} y={y:.1}", o.label);
            }
        }
    });
    drawing.add_controller(click);

    // Before allocation the region is EMPTY (zero-size rows), never "None".
    window.connect_realize({
        let overlay = Rc::downgrade(&overlay);
        move |_| {
            if let Some(o) = overlay.upgrade() {
                o.update_region();
            }
        }
    });
    let allocated_once = Cell::new(false);
    drawing.connect_resize({
        let overlay = Rc::downgrade(&overlay);
        move |_, width, height| {
            let Some(o) = overlay.upgrade() else { return };
            o.update_region();
            let scale = o.window.surface().map_or(0.0, |s| s.scale());
            let tag = if allocated_once.replace(true) { "S1_RESIZED" } else { "S1_ALLOCATED" };
            println!("{tag} monitor={} width={width} height={height} surface_scale={scale:.3}", o.label);
        }
    });
    window.connect_map({
        let overlay = Rc::downgrade(&overlay);
        let layer = opts.layer;
        let monitor = monitor.clone();
        move |w| {
            let Some(o) = overlay.upgrade() else { return };
            println!(
                "S1_READY monitor={} index={index} logical={}x{} monitor_scale={:.3} layer={layer:?}",
                o.label,
                monitor.geometry().width(),
                monitor.geometry().height(),
                monitor.scale()
            );
            if let Some(surface) = w.surface() {
                // Fractional/integer scale changes keep logical coordinates
                // but force a fresh region commit for the new buffer scale.
                let weak = Rc::downgrade(&o);
                surface.connect_notify_local(Some("scale"), move |s, _| {
                    if let Some(o) = weak.upgrade() {
                        println!("S1_SCALE_CHANGED monitor={} surface_scale={:.3}", o.label, s.scale());
                        o.update_region();
                    }
                });
            }
        }
    });
    // Same output changes mode/scale without hotplug: log it; GTK re-allocates
    // and `resize` re-applies the region. Output invalidated: fail closed.
    monitor.connect_notify_local(Some("geometry"), {
        let label = label.clone();
        move |m, _| {
            let g = m.geometry();
            println!("S1_MONITOR_GEOMETRY monitor={label} logical={}x{}", g.width(), g.height());
        }
    });
    monitor.connect_notify_local(Some("scale"), {
        let label = label.clone();
        move |m, _| println!("S1_MONITOR_SCALE monitor={label} scale={:.3}", m.scale())
    });
    monitor.connect_invalidate({
        let app = app.clone();
        move |_| {
            println!("S1_HOTPLUG_EXIT monitor={label} invalidated; releasing all surfaces");
            app.quit();
        }
    });

    // The motion tick owns the only strong reference to the overlay state; it
    // lives until the process quits (every exit path quits the application).
    glib::timeout_add_local(Duration::from_millis(TICK_MILLIS), move || {
        let width = overlay.drawing.width();
        overlay.motion.borrow_mut().advance(width, RADIUS);
        overlay.update_region();
        overlay.drawing.queue_draw();
        glib::ControlFlow::Continue
    });
    window.present();
}

fn show_town_only(app: &gtk::Application, reason: &str) {
    // Non-layer-shell window: NO fullscreen transparency or global interception.
    let window = gtk::ApplicationWindow::builder()
        .application(app)
        .title("Pixel Pals — Town-only safety fallback")
        .default_width(420)
        .default_height(150)
        .build();
    let vbox = gtk::Box::new(gtk::Orientation::Vertical, 12);
    vbox.set_margin_top(20);
    vbox.set_margin_bottom(20);
    vbox.set_margin_start(20);
    vbox.set_margin_end(20);
    vbox.append(&gtk::Label::new(Some("🏠 Pixel Pals S1 — town-only mode")));
    vbox.append(&gtk::Label::new(Some(reason)));
    vbox.append(&gtk::Label::new(Some("Roaming disabled. Other desktop windows are untouched.")));
    let button = gtk::Button::with_label("Close");
    button.connect_clicked({
        let app = app.clone();
        move |_| app.quit()
    });
    vbox.append(&button);
    window.set_child(Some(&vbox));
    window.connect_map(|_| println!("S1_TOWN_ONLY_READY"));
    window.present();
}

/// QA aid: an ordinary application window standing in for "the desktop".
/// Every primary click that reaches it is printed, so pass-through can be
/// counted without trusting the overlay's own logs.
fn show_qa_underlay(app: &gtk::Application, fullscreen: bool) {
    let window = gtk::ApplicationWindow::builder()
        .application(app)
        .title("S1 QA underlay (NOT the overlay)")
        .default_width(800)
        .default_height(600)
        .build();
    let drawing = gtk::DrawingArea::new();
    drawing.set_hexpand(true);
    drawing.set_vexpand(true);
    // Fixed 32 px magenta/dark-green checkerboard: easy to diff in screenshots.
    drawing.set_draw_func(|_, cr, width, height| {
        for row in 0..=(height / 32) {
            for col in 0..=(width / 32) {
                if (row + col) % 2 == 0 {
                    cr.set_source_rgb(0.85, 0.1, 0.75);
                } else {
                    cr.set_source_rgb(0.05, 0.3, 0.12);
                }
                cr.rectangle(f64::from(col * 32), f64::from(row * 32), 32.0, 32.0);
                let _ = cr.fill();
            }
        }
    });
    let count = Rc::new(Cell::new(0_u64));
    let click = gtk::GestureClick::new();
    click.connect_pressed(move |_, _, x, y| {
        let next = count.get() + 1;
        count.set(next);
        println!("S1_UNDERLAY_CLICK count={next} x={x:.1} y={y:.1}");
    });
    drawing.add_controller(click);
    drawing.connect_resize(|_, w, h| println!("S1_UNDERLAY_SIZE width={w} height={h}"));
    window.set_child(Some(&drawing));
    if fullscreen {
        window.fullscreen();
    }
    window.connect_map(|_| println!("S1_UNDERLAY_READY"));
    window.present();
}
