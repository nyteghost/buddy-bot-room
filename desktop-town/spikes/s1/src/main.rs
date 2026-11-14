//! Spike S1: standalone native GTK4 layer-shell window; deliberately NO Tauri,
//! browser, HTTP, system hooks, production data access, or privileged APIs.
//!
//! Every line the QA harness relies on is prefixed `S1_` and printed to
//! stdout (normal events) or stderr (fallback/failure events).
//!
//! Rendering: the full-output layer surface holds only an empty resize sensor
//! (no paint) plus two small widgets — the Pal art and a faint home marker —
//! inside a `gtk::Fixed`. Moving the Pal repaints a ~53 px square, not the
//! whole output, and an idle Pal (`--speed 0`) runs no timers and paints
//! nothing after the first frame.

use std::cell::{Cell, RefCell};
use std::f64::consts::TAU;
use std::process::ExitCode;
use std::rc::Rc;
use std::time::{Duration, Instant};

use gtk::cairo;
use gtk::gdk;
use gtk::glib;
use gtk::prelude::*;
use gtk4 as gtk;
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

use pixel_pals_s1::cli::{HELP, LayerChoice, Mode, Options, Parsed};
use pixel_pals_s1::model::{
    Capabilities, MonitorInfo, Motion, Pal, Rect, Size, art_rect, bounding_box, fallback_reason, home_rect,
    region_contains, select_monitors, to_surface_rows,
};
use pixel_pals_s1::stats::{FrameStats, cpu_percent, parse_cpu_ticks, parse_pss_rss_kib};

const RADIUS: f64 = 24.0;
/// Exit status when `--require-overlay` cannot obtain a verified overlay.
const EXIT_OVERLAY_UNAVAILABLE: u8 = 2;
const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;

/// Process-wide state shared by every overlay and every exit path.
#[derive(Default)]
struct Shared {
    overlays: RefCell<Vec<Rc<Overlay>>>,
    shutting_down: Cell<bool>,
    forced_exit: Cell<Option<u8>>,
}

impl Shared {
    /// The single exit path (timeout, signal, hotplug, compositor close):
    /// stop timers, empty every input region, hide every surface, then quit.
    /// Even if quitting stalls, nothing can intercept input any more.
    fn shutdown(&self, app: &gtk::Application, reason: &str) {
        if self.shutting_down.replace(true) {
            return;
        }
        let overlays = self.overlays.borrow();
        for o in overlays.iter() {
            o.release();
        }
        println!("S1_RELEASED count={} reason={reason}", overlays.len());
        app.quit();
    }
}

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
    let shared = Rc::new(Shared::default());
    app.connect_activate({
        let shared = shared.clone();
        move |app| activate(app, &options, &shared)
    });
    // Never forward our own argv to GApplication: it would reject our flags.
    let status = app.run_with_args(&[] as &[&str]);
    if let Some(code) = shared.forced_exit.get() {
        return ExitCode::from(code);
    }
    if status == glib::ExitCode::SUCCESS { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

fn monitor_info(m: &gdk::Monitor) -> MonitorInfo {
    let g = m.geometry();
    MonitorInfo {
        connector: m.connector().map(|c| c.to_string()),
        x: g.x(),
        y: g.y(),
        width: g.width(),
        height: g.height(),
        scale: m.scale(),
    }
}

fn activate(app: &gtk::Application, options: &Options, shared: &Rc<Shared>) {
    install_lifetime_guards(app, options.seconds, shared);

    if let Mode::QaUnderlay { fullscreen } = options.mode {
        show_qa_underlay(app, fullscreen);
        return;
    }

    let fail_or_fallback = |reason: &str| {
        eprintln!("S1_SAFE_FALLBACK reason={reason}");
        if options.require_overlay {
            eprintln!("S1_REQUIRE_OVERLAY_EXIT code={EXIT_OVERLAY_UNAVAILABLE}");
            shared.forced_exit.set(Some(EXIT_OVERLAY_UNAVAILABLE));
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
    let caps = Capabilities {
        forced_town_only: options.mode == Mode::TownOnly,
        wayland_display: wayland,
        layer_shell: wayland && gtk4_layer_shell::is_supported(),
        input_shapes: display.supports_input_shapes(),
    };
    if let Some(reason) = fallback_reason(caps) {
        fail_or_fallback(reason);
        return;
    }

    let provider = gtk::CssProvider::new();
    provider.load_from_string(
        "window.pp-s1-overlay, window.pp-s1-overlay * { background: transparent; \
         background-image: none; box-shadow: none; border: none; }",
    );
    gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);

    let monitors = display.monitors();
    let all: Vec<gdk::Monitor> = (0..monitors.n_items())
        .filter_map(|i| monitors.item(i).and_then(|o| o.downcast::<gdk::Monitor>().ok()))
        .collect();
    let infos: Vec<MonitorInfo> = all.iter().map(monitor_info).collect();
    for (i, m) in infos.iter().enumerate() {
        println!(
            "S1_OUTPUT index={i} connector={} geometry={}x{}+{}+{} scale={:.3} scale_factor={} usable={}",
            m.connector.as_deref().unwrap_or("unknown"),
            m.width,
            m.height,
            m.x,
            m.y,
            m.scale,
            all[i].scale_factor(),
            m.is_usable()
        );
    }
    let chosen = select_monitors(&options.monitor, &infos);
    if chosen.is_empty() {
        fail_or_fallback(&format!("Requested monitor unavailable or unusable count={}", all.len()));
        return;
    }
    for index in chosen {
        let overlay = create_overlay(app, &all[index], index, options, shared);
        shared.overlays.borrow_mut().push(overlay);
    }
    if options.stats_seconds > 0 {
        install_stats(shared, options.stats_seconds);
    }

    // Output added/removed: release *all* input regions and quit; relaunch
    // explicitly. Live re-targeting across outputs is a separate gate.
    monitors.connect_items_changed({
        let app = app.clone();
        let shared = shared.clone();
        move |_, _, removed, added| {
            println!("S1_HOTPLUG_EXIT removed={removed} added={added} releasing all surfaces");
            shared.shutdown(&app, "hotplug");
        }
    });
}

/// Bounded lifetime in every mode (overlay, town-only, QA underlay) plus clean
/// exit on SIGINT/SIGTERM so a stuck overlay can always be removed.
fn install_lifetime_guards(app: &gtk::Application, seconds: u32, shared: &Rc<Shared>) {
    glib::timeout_add_seconds_local(seconds, {
        let app = app.clone();
        let shared = shared.clone();
        move || {
            println!("S1_TIMEOUT_EXIT seconds={seconds}");
            shared.shutdown(&app, "timeout");
            glib::ControlFlow::Break
        }
    });
    for (signum, name) in [(SIGINT, "SIGINT"), (SIGTERM, "SIGTERM")] {
        glib_unix::unix_signal_add_local(signum, {
            let app = app.clone();
            let shared = shared.clone();
            move || {
                println!("S1_SIGNAL_EXIT signal={name}");
                shared.shutdown(&app, name);
                glib::ControlFlow::Break
            }
        });
    }
}

/// Periodic `S1_STATS` lines: per-overlay paint count and frame-interval
/// percentiles, input-region commits, and process CPU% (of one core) / PSS.
fn install_stats(shared: &Rc<Shared>, seconds: u32) {
    let read_ticks = || std::fs::read_to_string("/proc/self/stat").ok().as_deref().and_then(parse_cpu_ticks);
    let mut last_ticks = read_ticks();
    let mut last_wall = Instant::now();
    let shared = Rc::downgrade(shared);
    glib::timeout_add_seconds_local(seconds, move || {
        let Some(shared) = shared.upgrade() else { return glib::ControlFlow::Break };
        let now = Instant::now();
        let wall = now.duration_since(last_wall).as_secs_f64();
        let ticks = read_ticks();
        let cpu = match (last_ticks, ticks) {
            (Some(a), Some(b)) => cpu_percent(b.saturating_sub(a), wall),
            _ => -1.0,
        };
        let (pss, rss) =
            std::fs::read_to_string("/proc/self/smaps_rollup").map(|t| parse_pss_rss_kib(&t)).unwrap_or((None, None));
        for o in shared.overlays.borrow().iter() {
            let f = o.frames.borrow_mut().take();
            println!(
                "S1_STATS monitor={} window_s={wall:.1} frames={} fps={:.1} p50_ms={:.1} p95_ms={:.1} max_ms={:.1} \
                 region_updates={} cpu_pct={cpu:.2} pss_kib={} rss_kib={} renderer={}",
                o.label,
                f.frames,
                f.frames as f64 / wall.max(1e-9),
                f.p50_ms,
                f.p95_ms,
                f.max_ms,
                o.region_updates.replace(0),
                pss.map_or(-1, |v| v as i64),
                rss.map_or(-1, |v| v as i64),
                o.renderer_name()
            );
        }
        last_ticks = ticks;
        last_wall = now;
        glib::ControlFlow::Continue
    });
}

struct Overlay {
    label: String,
    window: gtk::ApplicationWindow,
    /// Full-size child of the window; the click gesture lives here.
    stage: gtk::Overlay,
    /// Empty full-size widget used only for its allocation (never paints).
    sizer: gtk::DrawingArea,
    fixed: gtk::Fixed,
    art: gtk::DrawingArea,
    home: gtk::DrawingArea,
    motion: RefCell<Motion>,
    art_at: Cell<Rect>,
    /// Pal rows in stage (widget) coordinates, for click classification.
    rows: RefCell<Vec<Rect>>,
    /// Last region committed to GDK, in surface coordinates.
    committed: RefCell<Option<Vec<Rect>>>,
    last_bbox: Cell<Option<Rect>>,
    trace: bool,
    clicks: Cell<u64>,
    frames: RefCell<FrameStats>,
    region_updates: Cell<u64>,
    timer: RefCell<Option<glib::SourceId>>,
}

impl Overlay {
    fn size(&self) -> Size {
        Size { width: self.sizer.width(), height: self.sizer.height() }
    }

    fn pal(&self) -> Pal {
        Pal { x: self.motion.borrow().x, y: f64::from(self.size().height) / 2.0, radius: RADIUS }
    }

    fn renderer_name(&self) -> String {
        self.window.renderer().map_or_else(|| "none".to_owned(), |r| r.type_().name().to_owned())
    }

    /// Move the small art widget so its drawn disc sits exactly on the hitbox.
    fn place_art(&self) {
        let rect = art_rect(self.pal());
        if rect != self.art_at.get() {
            self.fixed.move_(&self.art, f64::from(rect.x), f64::from(rect.y));
            self.art_at.set(rect);
        }
        self.art.queue_draw();
    }

    fn place_home(&self) {
        let h = home_rect(self.size());
        self.fixed.move_(&self.home, f64::from(h.x), f64::from(h.y));
    }

    /// Recompute the Pal hitbox and hand it to GDK when it changed (or when
    /// `force`d after realize/resize/scale). Never passes a "full" region: an
    /// empty list stays an empty (fully click-through) region.
    fn update_region(&self, force: bool) {
        let Some(surface) = self.window.surface() else { return };
        let widget_rows = self.pal().input_rows(self.size());
        // Stage origin in surface coordinates (window CSS/CSD offset plus the
        // native surface transform). Unknown → fail closed (empty).
        let origin = self.stage.compute_point(&self.window, &gtk::graphene::Point::new(0.0, 0.0)).map(|p| {
            let (tx, ty) = self.window.surface_transform();
            (f64::from(p.x()) + tx, f64::from(p.y()) + ty)
        });
        let surface_rows = match origin {
            Some((ox, oy)) => {
                to_surface_rows(&widget_rows, ox, oy, Size { width: surface.width(), height: surface.height() })
            }
            None => Vec::new(),
        };
        *self.rows.borrow_mut() = widget_rows;
        if !force && self.committed.borrow().as_ref() == Some(&surface_rows) {
            return;
        }
        let rects: Vec<cairo::RectangleInt> =
            surface_rows.iter().map(|r| cairo::RectangleInt::new(r.x, r.y, r.width, r.height)).collect();
        // Always Some(..): GDK treats None as "whole surface accepts input".
        surface.set_input_region(Some(&cairo::Region::create_rectangles(&rects)));
        self.region_updates.set(self.region_updates.get() + 1);
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
        *self.committed.borrow_mut() = Some(surface_rows);
    }

    /// Fail closed: no timer, empty input region, surface hidden.
    fn release(&self) {
        if let Some(id) = self.timer.borrow_mut().take() {
            id.remove();
        }
        if let Some(surface) = self.window.surface() {
            surface.set_input_region(Some(&cairo::Region::create()));
        }
        self.rows.borrow_mut().clear();
        self.window.set_visible(false);
    }
}

fn small_area(width: i32, height: i32) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::new();
    area.set_content_width(width);
    area.set_content_height(height);
    area.set_size_request(width, height);
    // Clicks are classified on the stage; children never become targets.
    area.set_can_target(false);
    area
}

fn create_overlay(
    app: &gtk::Application,
    monitor: &gdk::Monitor,
    index: usize,
    opts: &Options,
    shared: &Rc<Shared>,
) -> Rc<Overlay> {
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
    // None: KWin only activates top/overlay layer surfaces that want input.
    window.set_keyboard_mode(KeyboardMode::None);
    // 0 = do not reserve space and stay clear of panels' exclusive zones.
    window.set_exclusive_zone(0);
    for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
        window.set_anchor(edge, true);
    }
    window.set_monitor(Some(monitor));

    let sizer = gtk::DrawingArea::new(); // no draw func → never paints
    sizer.set_hexpand(true);
    sizer.set_vexpand(true);
    let fixed = gtk::Fixed::new();
    let art_side = art_rect(Pal { x: 0.0, y: 0.0, radius: RADIUS }).width;
    let art = small_area(art_side, art_side);
    let home = small_area(40, 16);
    fixed.put(&home, 0.0, 0.0);
    fixed.put(&art, 0.0, 0.0);
    let stage = gtk::Overlay::new();
    stage.set_child(Some(&sizer));
    stage.add_overlay(&fixed);
    window.set_child(Some(&stage));

    let overlay = Rc::new(Overlay {
        label: label.clone(),
        window: window.clone(),
        stage: stage.clone(),
        sizer: sizer.clone(),
        fixed,
        art: art.clone(),
        home: home.clone(),
        motion: RefCell::new(Motion::new(geometry.width(), opts.speed)),
        art_at: Cell::new(Rect { x: i32::MIN, y: i32::MIN, width: 0, height: 0 }),
        rows: RefCell::new(Vec::new()),
        committed: RefCell::new(None),
        last_bbox: Cell::new(None),
        trace: opts.trace_region,
        clicks: Cell::new(0),
        frames: RefCell::new(FrameStats::default()),
        region_updates: Cell::new(0),
        timer: RefCell::new(None),
    });

    home.set_draw_func(|_, cr, w, h| {
        // Very faint home marker: decoration ONLY, never a hit target.
        cr.set_source_rgba(0.1, 0.9, 0.8, 0.22);
        cr.rectangle(0.0, 0.0, f64::from(w), f64::from(h));
        let _ = cr.fill();
    });
    art.set_draw_func({
        let overlay = Rc::downgrade(&overlay);
        move |area, cr, _, _| {
            let Some(o) = overlay.upgrade() else { return };
            if let Some(clock) = area.frame_clock() {
                o.frames.borrow_mut().record(clock.frame_time());
            }
            let pal = o.pal();
            let at = o.art_at.get();
            // Sub-pixel centre inside the widget = exactly the hitbox centre.
            let (cx, cy) = (pal.x - f64::from(at.x), pal.y - f64::from(at.y));
            cr.set_source_rgba(0.22, 0.79, 0.98, 0.96);
            cr.arc(cx, cy, pal.radius, 0.0, TAU);
            let _ = cr.fill();
            cr.set_source_rgba(0.04, 0.1, 0.22, 1.0);
            cr.arc(cx - 7.0, cy - 4.0, 3.0, 0.0, TAU);
            let _ = cr.fill();
            cr.arc(cx + 7.0, cy - 4.0, 3.0, 0.0, TAU);
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
    stage.add_controller(click);

    // Before allocation the region is EMPTY (zero-size rows), never "None".
    window.connect_realize({
        let overlay = Rc::downgrade(&overlay);
        move |_| {
            if let Some(o) = overlay.upgrade() {
                o.update_region(true);
            }
        }
    });
    let allocated_once = Cell::new(false);
    sizer.connect_resize({
        let overlay = Rc::downgrade(&overlay);
        move |_, width, height| {
            let Some(o) = overlay.upgrade() else { return };
            o.motion.borrow_mut().clamp_to(width, RADIUS);
            o.place_home();
            o.place_art();
            o.update_region(true);
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
                "S1_READY monitor={} index={index} logical={}x{} monitor_scale={:.3} layer={layer:?} renderer={}",
                o.label,
                monitor.geometry().width(),
                monitor.geometry().height(),
                monitor.scale(),
                o.renderer_name()
            );
            if let Some(surface) = w.surface() {
                // Fractional/integer scale changes keep logical coordinates
                // but force a fresh region commit for the new buffer scale.
                let weak = Rc::downgrade(&o);
                surface.connect_notify_local(Some("scale"), move |s, _| {
                    if let Some(o) = weak.upgrade() {
                        println!("S1_SCALE_CHANGED monitor={} surface_scale={:.3}", o.label, s.scale());
                        o.update_region(true);
                    }
                });
            }
        }
    });
    // The compositor may close a layer surface (e.g. KWin on invalid geometry
    // or a vanished output): treat it like hotplug and fail closed.
    window.connect_close_request({
        let app = app.clone();
        let shared = Rc::downgrade(shared);
        let label = label.clone();
        move |_| {
            println!("S1_SURFACE_CLOSED monitor={label}");
            if let Some(shared) = shared.upgrade() {
                shared.shutdown(&app, "surface-closed");
            }
            glib::Propagation::Proceed
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
        let shared = Rc::downgrade(shared);
        move |_| {
            println!("S1_HOTPLUG_EXIT monitor={label} invalidated; releasing all surfaces");
            if let Some(shared) = shared.upgrade() {
                shared.shutdown(&app, "monitor-invalidated");
            }
        }
    });

    // Motion only while moving: an idle Pal has no timer and no repaint.
    if opts.speed > 0.0 {
        let period = Duration::from_micros(1_000_000 / u64::from(opts.fps));
        let mut last = Instant::now();
        let weak = Rc::downgrade(&overlay);
        let id = glib::timeout_add_local(period, move || {
            let Some(o) = weak.upgrade() else { return glib::ControlFlow::Break };
            let now = Instant::now();
            let dt = now.duration_since(last).as_secs_f64();
            last = now;
            let width = o.size().width;
            if o.motion.borrow_mut().advance_by(width, RADIUS, dt) {
                o.place_art();
                o.update_region(false);
            }
            glib::ControlFlow::Continue
        });
        *overlay.timer.borrow_mut() = Some(id);
    }
    window.present();
    overlay
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
