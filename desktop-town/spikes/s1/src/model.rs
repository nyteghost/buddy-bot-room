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

    pub fn advance(&mut self, width: i32, radius: f64) {
        if width <= 0 || !self.speed.is_finite() || self.speed < 0.0 {
            return;
        }
        let left = radius;
        let right = (f64::from(width) - radius).max(left);
        if right <= left {
            self.x = f64::from(width) / 2.0;
            return;
        }
        // Avoid overshoot creating offscreen hitboxes during resize/hotplug.
        self.x = (self.x + self.direction * self.speed).clamp(left, right);
        if self.x >= right { self.direction = -1.0; }
        if self.x <= left { self.direction = 1.0; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raster_hit(rows: &[Rect], x: i32, y: i32) -> bool {
        rows.iter().any(|r| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
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
            assert!(rows.iter().all(|r| r.x >= 0 && r.y >= 0 && r.width > 0 && r.height == 1 && r.x + r.width <= 100 && r.y + r.height <= 50));
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
            if prev != m.direction { direction_changes += 1; }
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
