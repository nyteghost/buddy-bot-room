//! Pure geometry/state. Coordinates and Cairo input regions are in GDK logical
//! surface pixels, not global desktop coordinates or physical framebuffer pixels.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pal {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}

impl Pal {
    #[must_use]
    pub fn contains(self, x: f64, y: f64) -> bool {
        (x - self.x).powi(2) + (y - self.y).powi(2) <= self.radius.powi(2)
    }

    /// A horizontal scanline polygon approximation of a circular input shape.
    /// Each rectangle is one row tall; all rows are clipped to the surface.
    /// Empty list means *no* pointer interception, never an implicit full region.
    #[must_use]
    pub fn input_rows(self, bounds: Size) -> Vec<Rect> {
        if bounds.width <= 0
            || bounds.height <= 0
            || !self.x.is_finite()
            || !self.y.is_finite()
            || !self.radius.is_finite()
            || self.radius <= 0.0
            || self.radius > 256.0
        {
            return Vec::new();
        }
        let mut rows = Vec::new();
        let start = ((self.y - self.radius - 1.0).floor() as i32).max(0);
        let end = ((self.y + self.radius + 1.0).ceil() as i32).min(bounds.height);
        for y in start..end {
            let offset_y = (y as f64 + 0.5) - self.y;
            let remaining = self.radius * self.radius - offset_y * offset_y;
            if remaining < 0.0 {
                continue;
            }
            let dx = remaining.sqrt();
            // Raster membership is determined by the pixel center (x + .5, y + .5).
            let left = ((self.x - dx - 0.5).ceil() as i32).clamp(0, bounds.width);
            let right = ((self.x + dx - 0.5).floor() as i32 + 1).clamp(0, bounds.width);
            if right > left {
                rows.push(Rect { x: left, y, width: right - left, height: 1 });
            }
        }
        rows
    }
}

/// True when the integer pixel containing `(x, y)` is part of `rows`. This is
/// the same membership rule the compositor applies to the input region, so a
/// pointer event the overlay receives *outside* it means the region was not
/// honoured (a real click-through failure, not a rounding artefact).
#[must_use]
pub fn region_contains(rows: &[Rect], x: f64, y: f64) -> bool {
    if !x.is_finite() || !y.is_finite() {
        return false;
    }
    let (px, py) = (x.floor(), y.floor());
    rows.iter().any(|r| {
        px >= f64::from(r.x) && px < f64::from(r.x + r.width) && py >= f64::from(r.y) && py < f64::from(r.y + r.height)
    })
}

/// Bounding box of a region; `None` for an empty (fully click-through) region.
#[must_use]
pub fn bounding_box(rows: &[Rect]) -> Option<Rect> {
    let first = rows.first()?;
    let (mut x0, mut y0) = (first.x, first.y);
    let (mut x1, mut y1) = (first.x + first.width, first.y + first.height);
    for r in rows {
        x0 = x0.min(r.x);
        y0 = y0.min(r.y);
        x1 = x1.max(r.x + r.width);
        y1 = y1.max(r.y + r.height);
    }
    Some(Rect { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
}

/// Converts widget-local rows into GDK *surface* coordinates (the space
/// `gdk_surface_set_input_region` uses) and clips them to the surface. A
/// non-finite offset or empty surface fails closed to an empty region.
#[must_use]
pub fn to_surface_rows(rows: &[Rect], offset_x: f64, offset_y: f64, surface: Size) -> Vec<Rect> {
    if !offset_x.is_finite()
        || !offset_y.is_finite()
        || offset_x.abs() > 16_384.0
        || offset_y.abs() > 16_384.0
        || surface.width <= 0
        || surface.height <= 0
    {
        return Vec::new();
    }
    // Offsets are whole logical pixels for an undecorated layer surface; round
    // rather than truncate so a 0.9999 transform does not shift the hitbox.
    let dx = offset_x.round() as i32;
    let dy = offset_y.round() as i32;
    rows.iter()
        .filter_map(|r| {
            let x0 = (r.x + dx).clamp(0, surface.width);
            let x1 = (r.x + r.width + dx).clamp(0, surface.width);
            let y0 = (r.y + dy).clamp(0, surface.height);
            let y1 = (r.y + r.height + dy).clamp(0, surface.height);
            (x1 > x0 && y1 > y0).then_some(Rect { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
        })
        .collect()
}

#[derive(Debug, Clone, Copy)]
pub struct Motion {
    pub x: f64,
    pub direction: f64,
    pub speed: f64,
}

impl Motion {
    #[must_use]
    pub fn new(width: i32, speed: f64) -> Self {
        Self { x: f64::from(width.max(0)) / 2.0, direction: 1.0, speed }
    }

    /// One legacy 80 ms step (`speed` pixels). Kept for CLI/test compatibility.
    pub fn advance(&mut self, width: i32, radius: f64) {
        let _ = self.advance_by(width, radius, LEGACY_TICK_SECONDS);
    }

    /// Time-based motion: `speed` is pixels per 80 ms (the original CLI unit),
    /// so the walk looks the same at any frame rate. `dt` is clamped to
    /// [0, `MAX_STEP_SECONDS`] so a stall (suspend, compositor throttling while
    /// hidden under a fullscreen game) can never teleport the hitbox.
    /// Returns true when the position changed.
    pub fn advance_by(&mut self, width: i32, radius: f64, dt: f64) -> bool {
        if width <= 0 || !self.speed.is_finite() || self.speed < 0.0 || !dt.is_finite() {
            return false;
        }
        let before = self.x;
        let left = radius;
        let right = (f64::from(width) - radius).max(left);
        if right <= left {
            self.x = f64::from(width) / 2.0;
            return (self.x - before).abs() > f64::EPSILON;
        }
        let step = self.speed * dt.clamp(0.0, MAX_STEP_SECONDS) / LEGACY_TICK_SECONDS;
        // Avoid overshoot creating offscreen hitboxes during resize/hotplug.
        self.x = (self.x + self.direction * step).clamp(left, right);
        if self.x >= right {
            self.direction = -1.0;
        }
        if self.x <= left {
            self.direction = 1.0;
        }
        (self.x - before).abs() > f64::EPSILON
    }

    /// Re-clamp after the surface shrinks (scale/mode change) even when the
    /// Pal is idle, so art and hitbox never end up outside the surface.
    pub fn clamp_to(&mut self, width: i32, radius: f64) -> bool {
        self.advance_by(width, radius, 0.0)
    }
}

/// Original S1 tick; `--speed` is expressed in pixels per this interval.
pub const LEGACY_TICK_SECONDS: f64 = 0.08;
/// Largest motion step after a stall.
pub const MAX_STEP_SECONDS: f64 = 0.25;
/// Transparent margin around the Pal art widget (logical px).
pub const ART_PAD: i32 = 2;

/// Integer placement of the small Pal art widget. The disc is drawn at the
/// sub-pixel centre `(pal.x - x, pal.y - y)` inside it, so art and the input
/// region share one centre; the widget always contains every region row.
#[must_use]
pub fn art_rect(pal: Pal) -> Rect {
    let x = (pal.x - pal.radius).floor() as i32 - ART_PAD;
    let y = (pal.y - pal.radius).floor() as i32 - ART_PAD;
    let side = (2.0 * pal.radius).ceil() as i32 + 2 * ART_PAD + 1;
    Rect { x, y, width: side, height: side }
}

/// Faint "home" marker below the surface centre: decoration only, never input.
#[must_use]
pub fn home_rect(surface: Size) -> Rect {
    Rect { x: surface.width / 2 - 20, y: surface.height / 2 + 40, width: 40, height: 16 }
}

/// Logical geometry of one output as reported by GDK.
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorInfo {
    pub connector: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

impl MonitorInfo {
    /// Usable for an overlay: positive size within sane bounds and a finite
    /// scale. KWin itself closes layer surfaces with invalid geometry; S1
    /// refuses them up front instead (fail closed → town-only/exit 2).
    #[must_use]
    pub fn is_usable(&self) -> bool {
        (1..=16_384).contains(&self.width)
            && (1..=16_384).contains(&self.height)
            && self.scale.is_finite()
            && (0.25..=8.0).contains(&self.scale)
    }
}

/// Which GDK monitor indices to cover. Unknown connector, out-of-range index
/// or an unusable output selects nothing (caller falls back safely).
#[must_use]
pub fn select_monitors(choice: &crate::cli::MonitorChoice, monitors: &[MonitorInfo]) -> Vec<usize> {
    use crate::cli::MonitorChoice;
    let picked: Vec<usize> = match choice {
        MonitorChoice::All => (0..monitors.len()).collect(),
        MonitorChoice::Index(i) => (*i < monitors.len()).then_some(*i).into_iter().collect(),
        MonitorChoice::Connector(name) => {
            monitors.iter().position(|m| m.connector.as_deref() == Some(name.as_str())).into_iter().collect()
        }
    };
    if picked.iter().all(|&i| monitors[i].is_usable()) { picked } else { Vec::new() }
}

/// Inputs to the overlay-vs-fallback decision, as observed at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capabilities {
    pub forced_town_only: bool,
    pub wayland_display: bool,
    pub layer_shell: bool,
    pub input_shapes: bool,
}

/// `None` = overlay allowed; otherwise the reason to use the safe fallback.
/// Order matters: an explicit town-only request wins over everything.
#[must_use]
pub fn fallback_reason(c: Capabilities) -> Option<&'static str> {
    if c.forced_town_only {
        Some("Forced by --town-only")
    } else if !c.wayland_display {
        Some("Not a native Wayland GDK display")
    } else if !c.layer_shell {
        Some("Compositor lacks layer-shell protocol")
    } else if !c.input_shapes {
        Some("Input regions not supported by GDK backend")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raster_hit(rows: &[Rect], x: i32, y: i32) -> bool {
        rows.iter().any(|r| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
    }

    #[test]
    fn time_based_motion_matches_legacy_speed_and_caps_stalls() {
        let mut a = Motion::new(1000, 4.0);
        let mut b = Motion::new(1000, 4.0);
        a.advance(1000, 24.0); // one legacy 80 ms tick
        for _ in 0..8 {
            b.advance_by(1000, 24.0, 0.01); // eight 10 ms frames
        }
        assert!((a.x - b.x).abs() < 1e-9, "{} vs {}", a.x, b.x);
        let mut stalled = Motion::new(1000, 4.0);
        assert!(stalled.advance_by(1000, 24.0, 30.0)); // 30 s stall
        assert!((stalled.x - (500.0 + 4.0 * MAX_STEP_SECONDS / LEGACY_TICK_SECONDS)).abs() < 1e-9);
        let mut idle = Motion::new(1000, 0.0);
        assert!(!idle.advance_by(1000, 24.0, 0.033));
        assert!(!idle.advance_by(1000, 24.0, f64::NAN));
    }

    #[test]
    fn clamp_on_shrink_keeps_idle_pal_inside_surface() {
        let mut m = Motion::new(3440, 0.0); // x = 1720 on a 3440-wide output
        assert!(!m.clamp_to(1966, 24.0), "3440 @175% = 1966 logical still contains x"); // no move needed
        assert!(m.clamp_to(1280, 24.0)); // mode change to 1280 wide
        assert!(m.x <= 1280.0 - 24.0 && m.x >= 24.0);
        assert!(!m.clamp_to(1280, 24.0));
        m.clamp_to(30, 24.0); // narrower than the Pal: centred, never NaN
        assert!((m.x - 15.0).abs() < 1e-9);
    }

    #[test]
    fn art_widget_contains_every_region_row_for_subpixel_centres() {
        for i in 0..200 {
            let f = f64::from(i) / 200.0;
            let pal = Pal { x: 300.0 + f * 3.7, y: 200.0 + f * 1.3, radius: 24.0 };
            let rows = pal.input_rows(Size { width: 1000, height: 1000 });
            let bb = bounding_box(&rows).unwrap();
            let art = art_rect(pal);
            assert!(bb.x >= art.x && bb.y >= art.y, "{bb:?} {art:?}");
            assert!(bb.x + bb.width <= art.x + art.width && bb.y + bb.height <= art.y + art.height);
            // drawn centre inside the widget is within the padded square
            let (cx, cy) = (pal.x - f64::from(art.x), pal.y - f64::from(art.y));
            assert!(cx - pal.radius >= 0.0 && cy - pal.radius >= 0.0);
            assert!(cx + pal.radius <= f64::from(art.width) && cy + pal.radius <= f64::from(art.height));
        }
    }

    #[test]
    fn home_marker_never_overlaps_pal_hitbox_at_rest() {
        for (w, h) in [(1280, 720), (1463, 823), (853, 480), (3440, 1440)] {
            let pal = Pal { x: f64::from(w) / 2.0, y: f64::from(h) / 2.0, radius: 24.0 };
            let rows = pal.input_rows(Size { width: w, height: h });
            let home = home_rect(Size { width: w, height: h });
            assert!(rows.iter().all(|r| r.y + r.height <= home.y), "{w}x{h}");
        }
    }

    fn mon(connector: &str, w: i32, h: i32, scale: f64) -> MonitorInfo {
        MonitorInfo { connector: Some(connector.into()), x: 0, y: 0, width: w, height: h, scale }
    }

    #[test]
    fn monitor_selection_is_strict_and_fails_closed() {
        use crate::cli::MonitorChoice;
        let ms = vec![mon("DP-1", 2560, 1440, 1.0), mon("HDMI-A-1", 1707, 960, 1.5)];
        assert_eq!(select_monitors(&MonitorChoice::Index(1), &ms), vec![1]);
        assert!(select_monitors(&MonitorChoice::Index(2), &ms).is_empty());
        assert_eq!(select_monitors(&MonitorChoice::Connector("HDMI-A-1".into()), &ms), vec![1]);
        assert!(select_monitors(&MonitorChoice::Connector("DP-2".into()), &ms).is_empty());
        assert_eq!(select_monitors(&MonitorChoice::All, &ms), vec![0, 1]);
        assert!(select_monitors(&MonitorChoice::All, &[]).is_empty());
        let bad = vec![mon("DP-1", 2560, 1440, 1.0), mon("DP-2", 0, 1440, 1.0)];
        assert!(select_monitors(&MonitorChoice::All, &bad).is_empty(), "one bad output blocks --all-monitors");
        assert_eq!(select_monitors(&MonitorChoice::Index(0), &bad), vec![0]);
        assert!(!mon("X", 100, 100, f64::NAN).is_usable());
        assert!(!mon("X", 100, 100, 0.0).is_usable());
        assert!(!mon("X", 20_000, 100, 1.0).is_usable());
    }

    #[test]
    fn fallback_decision_order_and_overlay_only_when_all_present() {
        let all =
            Capabilities { forced_town_only: false, wayland_display: true, layer_shell: true, input_shapes: true };
        assert_eq!(fallback_reason(all), None);
        assert_eq!(fallback_reason(Capabilities { forced_town_only: true, ..all }), Some("Forced by --town-only"));
        assert_eq!(
            fallback_reason(Capabilities { wayland_display: false, layer_shell: false, ..all }),
            Some("Not a native Wayland GDK display")
        );
        assert_eq!(
            fallback_reason(Capabilities { layer_shell: false, ..all }),
            Some("Compositor lacks layer-shell protocol")
        );
        assert_eq!(
            fallback_reason(Capabilities { input_shapes: false, ..all }),
            Some("Input regions not supported by GDK backend")
        );
        // exhaustive: overlay is allowed in exactly one of 16 combinations
        let mut allowed = 0;
        for bits in 0..16_u8 {
            let c = Capabilities {
                forced_town_only: bits & 1 != 0,
                wayland_display: bits & 2 != 0,
                layer_shell: bits & 4 != 0,
                input_shapes: bits & 8 != 0,
            };
            allowed += usize::from(fallback_reason(c).is_none());
        }
        assert_eq!(allowed, 1);
    }

    #[test]
    fn region_contains_matches_raster_and_rejects_non_finite() {
        let pal = Pal { x: 40.0, y: 40.0, radius: 24.0 };
        let rows = pal.input_rows(Size { width: 100, height: 100 });
        for y in 0..100 {
            for x in 0..100 {
                let fx = f64::from(x) + 0.37;
                let fy = f64::from(y) + 0.81;
                assert_eq!(region_contains(&rows, fx, fy), raster_hit(&rows, x, y));
            }
        }
        assert!(!region_contains(&rows, f64::NAN, 40.0));
        assert!(!region_contains(&[], 40.0, 40.0));
    }

    #[test]
    fn bounding_box_covers_circle_and_empty_is_none() {
        let rows = Pal { x: 50.0, y: 50.0, radius: 10.0 }.input_rows(Size { width: 200, height: 200 });
        let bb = bounding_box(&rows).unwrap();
        assert_eq!((bb.x, bb.y, bb.width, bb.height), (40, 40, 20, 20));
        assert!(bounding_box(&[]).is_none());
    }

    #[test]
    fn surface_translation_offsets_and_clips() {
        let rows = vec![Rect { x: 0, y: 0, width: 10, height: 1 }, Rect { x: 95, y: 5, width: 10, height: 1 }];
        let out = to_surface_rows(&rows, 3.0, 2.0, Size { width: 100, height: 100 });
        assert_eq!(out[0], Rect { x: 3, y: 2, width: 10, height: 1 });
        assert_eq!(out[1], Rect { x: 98, y: 7, width: 2, height: 1 });
        assert!(to_surface_rows(&rows, f64::NAN, 0.0, Size { width: 100, height: 100 }).is_empty());
        assert!(to_surface_rows(&rows, 0.0, 0.0, Size { width: 0, height: 100 }).is_empty());
        assert!(to_surface_rows(&rows, -500.0, 0.0, Size { width: 100, height: 100 }).is_empty());
    }

    #[test]
    fn fractional_scale_logical_sizes_stay_bounded() {
        // 2560x1440 at 125%/150%/175% → logical surfaces; region must stay a
        // small disc inside each and never cover the output.
        for (w, h) in [(2048, 1152), (1707, 960), (1463, 823), (1536, 864)] {
            let pal = Pal { x: f64::from(w) / 2.0, y: f64::from(h) / 2.0, radius: 24.0 };
            let rows = pal.input_rows(Size { width: w, height: h });
            let area: i32 = rows.iter().map(|r| r.width * r.height).sum();
            assert!((1700..1900).contains(&area), "area={area} for {w}x{h}");
            let bb = bounding_box(&rows).unwrap();
            // A half-pixel centre on odd logical sizes can span 2r+1 rows/columns.
            assert!(bb.width <= 49 && bb.height <= 49, "{bb:?}");
        }
    }

    #[test]
    fn empty_region_when_surface_has_not_allocated() {
        let pal = Pal { x: 50.0, y: 50.0, radius: 20.0 };
        assert!(pal.input_rows(Size { width: 0, height: 100 }).is_empty());
        assert!(pal.input_rows(Size { width: 100, height: 0 }).is_empty());
    }

    #[test]
    fn malformed_geometry_fails_closed() {
        let size = Size { width: 100, height: 100 };
        for radius in [0.0, -1.0, f64::NAN, f64::INFINITY, 1_000.0] {
            assert!(Pal { x: 50.0, y: 50.0, radius }.input_rows(size).is_empty());
        }
        assert!(Pal { x: f64::INFINITY, y: 50.0, radius: 20.0 }.input_rows(size).is_empty());
    }

    #[test]
    fn click_region_matches_circle_in_pixel_centers() {
        let pal = Pal { x: 73.3, y: 63.8, radius: 23.0 };
        let rows = pal.input_rows(Size { width: 160, height: 130 });
        for y in 0..130 {
            for x in 0..160 {
                assert_eq!(raster_hit(&rows, x, y), pal.contains(f64::from(x) + 0.5, f64::from(y) + 0.5), "({x},{y})");
            }
        }
    }

    #[test]
    fn region_never_extends_outside_monitor() {
        for pal in [Pal { x: 0.0, y: 0.0, radius: 24.0 }, Pal { x: 99.0, y: 49.0, radius: 24.0 }] {
            let rows = pal.input_rows(Size { width: 100, height: 50 });
            assert!(rows.iter().all(|r| r.x >= 0
                && r.y >= 0
                && r.width > 0
                && r.height == 1
                && r.x + r.width <= 100
                && r.y + r.height <= 50));
        }
    }

    #[test]
    fn full_screen_never_becomes_the_input_region() {
        let region = Pal { x: 100.0, y: 100.0, radius: 24.0 }.input_rows(Size { width: 1920, height: 1080 });
        let area: i32 = region.iter().map(|r| r.width * r.height).sum();
        assert!(area > 1000 && area < 2500, "area={area}");
        assert!(!raster_hit(&region, 0, 0));
        assert!(!raster_hit(&region, 1919, 1079));
        assert!(raster_hit(&region, 100, 100));
    }

    #[test]
    fn motion_bounces_instead_of_walking_offscreen() {
        let mut m = Motion::new(200, 9.0);
        let mut direction_changes = 0;
        for _ in 0..500 {
            let prev = m.direction;
            m.advance(200, 24.0);
            assert!((24.0..=176.0).contains(&m.x));
            if prev != m.direction {
                direction_changes += 1;
            }
        }
        assert!(direction_changes >= 2);
    }

    #[test]
    fn stopped_pal_and_tiny_monitor_are_safe() {
        let mut still = Motion::new(100, 0.0);
        still.advance(100, 24.0);
        assert_eq!(still.x, 50.0);
        let mut tiny = Motion::new(20, 10.0);
        tiny.advance(20, 24.0);
        assert_eq!(tiny.x, 10.0);
    }
}
