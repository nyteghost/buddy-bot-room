//! Spike S1: standalone native GTK4 layer-shell window; deliberately NO Tauri,
//! browser, HTTP, system hooks, production data access, or privileged APIs.
mod model;

use std::cell::{Cell, RefCell};
use std::env;
use std::f64::consts::TAU;
use std::rc::Rc;
use std::time::Duration;

use gtk::cairo;
use gtk::gdk;
use gtk::prelude::*;
use gtk4 as gtk;
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

use model::{Motion, Pal, Size};

const RADIUS: f64 = 24.0;
const TICK_MILLIS: u64 = 80;

#[derive(Clone, Debug)]
struct Options {
    seconds: u32,
    speed: f64,
    all_monitors: bool,
    monitor_index: usize,
    layer: LayerChoice,
    require_overlay: bool,
    town_only: bool,
}

#[derive(Clone, Copy, Debug)]
enum LayerChoice { Top, Bottom }

impl Options {
    fn parse() -> Result<Self, String> {
        let mut opt = Self {
            seconds: 300,
            speed: 4.0,
            all_monitors: false,
            monitor_index: 0,
            layer: LayerChoice::Top,
            require_overlay: false,
            town_only: false,
        };
        let mut args = env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--seconds" => {
                    let v = args.next().ok_or("--seconds requires 1..=3600")?;
                    opt.seconds = v.parse::<u32>().map_err(|_| "invalid --seconds")?;
                    if !(1..=3600).contains(&opt.seconds) { return Err("--seconds must be 1..=3600".into()); }
                }
                "--speed" => {
                    let v = args.next().ok_or("--speed requires 0..=24")?;
                    opt.speed = v.parse::<f64>().map_err(|_| "invalid --speed")?;
                    if !opt.speed.is_finite() || !(0.0..=24.0).contains(&opt.speed) {
                        return Err("--speed must be a finite number 0..=24".into());
                    }
                }
                "--monitor-index" => {
                    opt.monitor_index = args.next().ok_or("--monitor-index requires integer")?
                        .parse::<usize>().map_err(|_| "invalid --monitor-index")?;
                }
                "--all-monitors" => opt.all_monitors = true,
                "--layer" => {
                    opt.layer = match args.next().as_deref() {
                        Some("top") => LayerChoice::Top,
                        Some("bottom") => LayerChoice::Bottom,
                        _ => return Err("--layer must be top or bottom".into()),
                    };
                }
                "--require-overlay" => opt.require_overlay = true,
                "--town-only" => opt.town_only = true,
                "--help" | "-h" => {
                    println!("Pixel Pals S1 Wayland overlay spike\n\
                        --seconds N           Self-close after N seconds (default 300, max 3600)\n\
                        --speed N             Pal pixels per 80ms tick, 0..24 (default 4)\n\
                        --monitor-index N     GDK monitor index (default 0)\n\
                        --all-monitors        One independently clipped layer surface per output\n\
                        --layer top|bottom    Default top; bottom may be hidden behind windows\n\
                        --town-only           Safe normal-window mode, no layer shell\n\
                        --require-overlay    Error instead of fallback for QA instrumentation\n\
                        No keyboard grab, no exclusive zone, no desktop enumeration.");
                    std::process::exit(0);
                }
                _ => return Err(format!("unknown argument: {arg}")),
            }
        }
        if opt.town_only && opt.require_overlay {
            return Err("--town-only and --require-overlay are mutually exclusive".into());
        }
        Ok(opt)
    }
}

fn main() {
    let options = match Options::parse() {
        Ok(o) => o,
        Err(e) => { eprintln!("S1_ARGS_ERROR {e}"); std::process::exit(2); }
    };
    // NON_UNIQUE permits reliable parallel launches / lifecycle regression runs.
    let app = gtk::Application::new(Some("org.pixelpals.spike.s1"), gtk::gio::ApplicationFlags::NON_UNIQUE);
    app.connect_activate(move |app| activate(app, &options));
    let result = app.run_with_args(&[] as &[&str]);
    std::process::exit(result.into());
}

fn activate(app: &gtk::Application, options: &Options) {
    let Some(display) = gdk::Display::default() else {
        eprintln!("S1_NO_DISPLAY");
        if options.require_overlay { std::process::exit(2); }
        show_town_only(app, "No graphical display available");
        return;
    };

    let wayland = env::var("XDG_SESSION_TYPE").ok().as_deref() == Some("wayland")
        && env::var_os("WAYLAND_DISPLAY").is_some();
    if options.town_only || !wayland || !gtk4_layer_shell::is_supported() || !display.supports_input_shapes() {
        let reason = if options.town_only { "Forced by --town-only" }
            else if !wayland { "Not a Wayland session" }
            else if !gtk4_layer_shell::is_supported() { "Compositor lacks layer-shell protocol" }
            else { "Input regions not supported by GDK backend" };
        eprintln!("S1_SAFE_FALLBACK reason={reason}");
        if options.require_overlay { std::process::exit(2); }
        show_town_only(app, reason);
        return;
    }

    let provider = gtk::CssProvider::new();
    provider.load_from_data("window.pp-s1-overlay, window.pp-s1-overlay > * { background: transparent; background-image: none; box-shadow: none; border: none; }");
    gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);

    let monitors = display.monitors();
    let count = monitors.n_items() as usize;
    if count == 0 || (!options.all_monitors && options.monitor_index >= count) {
        eprintln!("S1_SAFE_FALLBACK reason=Requested monitor unavailable count={count}");
        if options.require_overlay { std::process::exit(2); }
        show_town_only(app, "No matching monitor");
        return;
    }
    let chosen: Vec<usize> = if options.all_monitors { (0..count).collect() } else { vec![options.monitor_index] };
    for index in chosen {
        let Some(monitor) = monitors.item(index as u32).and_then(|item| item.downcast::<gdk::Monitor>().ok()) else {
            eprintln!("S1_OUTPUT_ERROR index={index}");
            app.quit();
            return;
        };
        create_overlay(app, &monitor, index, options);
    }

    // Unexpected hotplug/removal: quit and release *all* input regions; relaunch
    // explicitly. Reallocation across monitors is a separate integration gate.
    let app_for_hotplug = app.clone();
    monitors.connect_items_changed(move |_, _, _, _| {
        eprintln!("S1_HOTPLUG_EXIT monitor model changed; releasing surfaces");
        app_for_hotplug.quit();
    });

    let app_for_deadline = app.clone();
    let seconds = options.seconds;
    gtk::glib::timeout_add_seconds_local(seconds, move || {
        eprintln!("S1_TIMEOUT_EXIT seconds={seconds}");
        app_for_deadline.quit();
        gtk::glib::ControlFlow::Break
    });
}

fn create_overlay(app: &gtk::Application, monitor: &gdk::Monitor, index: usize, opts: &Options) {
    let geometry = monitor.geometry();
    let window = gtk::ApplicationWindow::builder()
        .application(app)
        .title("Pixel Pals S1 transparent overlay")
        .decorated(false)
        .default_width(geometry.width())
        .default_height(geometry.height())
        .build();
    window.set_css_classes(&["pp-s1-overlay"]);
    // CRITICAL: these must be configured before the first realize/map.
    window.init_layer_shell();
    window.set_namespace(Some("pixel-pals-spike-s1"));
    window.set_layer(match opts.layer { LayerChoice::Top => Layer::Top, LayerChoice::Bottom => Layer::Bottom });
    window.set_keyboard_mode(KeyboardMode::None);
    window.set_exclusive_zone(0);
    for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
        window.set_anchor(edge, true);
    }
    window.set_monitor(Some(monitor));

    let drawing = gtk::DrawingArea::new();
    drawing.set_hexpand(true);
    drawing.set_vexpand(true);
    window.set_child(Some(&drawing));
    let motion = Rc::new(RefCell::new(Motion::new(geometry.width(), opts.speed)));
    let clicks = Rc::new(Cell::new(0_u64));

    drawing.set_draw_func({
        let motion = motion.clone();
        move |_, cr, width, height| {
            // The surface must have transparent pixels everywhere except visible art.
            cr.set_operator(cairo::Operator::Clear);
            let _ = cr.paint();
            cr.set_operator(cairo::Operator::Over);
            let m = *motion.borrow();
            let pal = Pal { x: m.x, y: f64::from(height) / 2.0, radius: RADIUS };
            // The very faint home marker is decoration ONLY, never a hit target.
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
        let clicks = clicks.clone();
        let motion = motion.clone();
        let drawing = drawing.clone();
        move |_, _, x, y| {
            let pal = Pal { x: motion.borrow().x, y: f64::from(drawing.height()) / 2.0, radius: RADIUS };
            if pal.contains(x, y) {
                let next = clicks.get() + 1;
                clicks.set(next);
                println!("S1_PAL_CLICK monitor={index} count={next} x={x:.1} y={y:.1}");
            } else {
                // Unexpected interception is a manual QA failure and must be visible.
                eprintln!("S1_SPURIOUS_CLICK monitor={index} x={x:.1} y={y:.1}");
            }
        }
    });
    drawing.add_controller(click);

    // Initial region is deliberately EMPTY until the surface is allocated.
    // Never permit a default full-window pointer region for a visible overlay.
    window.connect_realize({
        let drawing = drawing.clone();
        let motion = motion.clone();
        move |window| update_regions(window, &drawing, *motion.borrow())
    });
    drawing.connect_resize({
        let window = window.clone();
        let drawing = drawing.clone();
        let motion = motion.clone();
        move |_, _, _| update_regions(&window, &drawing, *motion.borrow())
    });
    let scale_factor = monitor.scale_factor();
    let selected_layer = opts.layer;
    window.connect_map(move |_| {
        println!("S1_READY monitor={index} logical={}x{} scale_factor={} layer={selected_layer:?}",
            geometry.width(), geometry.height(), scale_factor);
    });

    gtk::glib::timeout_add_local(Duration::from_millis(TICK_MILLIS), {
        let drawing = drawing.clone();
        let window = window.clone();
        let motion = motion.clone();
        move || {
            let width = drawing.width();
            let mut m = motion.borrow_mut();
            m.advance(width, RADIUS);
            update_regions(&window, &drawing, *m);
            drawing.queue_draw();
            gtk::glib::ControlFlow::Continue
        }
    });
    window.present();
}

fn update_regions(window: &gtk::ApplicationWindow, drawing: &gtk::DrawingArea, m: Motion) {
    let Some(surface) = window.surface() else { return; };
    let pal = Pal { x: m.x, y: f64::from(drawing.height()) / 2.0, radius: RADIUS };
    let rows = pal.input_rows(Size { width: drawing.width(), height: drawing.height() });
    let rectangles: Vec<cairo::RectangleInt> = rows.into_iter()
        .map(|r| cairo::RectangleInt::new(r.x, r.y, r.width, r.height)).collect();
    let input_region = cairo::Region::create_rectangles(&rectangles);
    let empty_opaque_region = cairo::Region::create();
    surface.set_opaque_region(Some(&empty_opaque_region));
    surface.set_input_region(Some(&input_region));
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
    let app_for_button = app.clone();
    button.connect_clicked(move |_| app_for_button.quit());
    vbox.append(&button);
    window.set_child(Some(&vbox));
    window.present();
}
