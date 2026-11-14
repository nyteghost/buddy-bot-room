//! The same shape geometry is used for GPU quads and native Win32 input regions.
//! Nothing outside these shapes should capture pointer input.
//!
//! Pal coordinates are stored in *logical* (96-DPI) pixels. Every consumer that
//! talks to Windows or the GPU converts with [`scale_rect`] using the window's
//! current scale factor, so the drawn silhouette and the hit region always come
//! from one function and cannot drift apart at 125/150/200% scaling.

/// Logical overlay size; the physical window is this times the scale factor.
pub const OVERLAY_LOGICAL_WIDTH: u32 = 640;
pub const OVERLAY_LOGICAL_HEIGHT: u32 = 360;
/// Logical distance kept between the overlay and the monitor work-area edge.
pub const OVERLAY_LOGICAL_MARGIN: i32 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn right(self) -> i32 {
        self.x.saturating_add(self.width)
    }

    pub fn bottom(self) -> i32 {
        self.y.saturating_add(self.height)
    }

    pub fn contains(self, x: i32, y: i32) -> bool {
        self.width > 0
            && self.height > 0
            && x >= self.x
            && y >= self.y
            && x < self.right()
            && y < self.bottom()
    }

    pub fn translate(self, dx: i32, dy: i32) -> Self {
        Self::new(self.x + dx, self.y + dy, self.width, self.height)
    }
}

pub const PAL_PARTS: [Rect; 6] = [
    Rect::new(18, 8, 12, 25),
    Rect::new(50, 8, 12, 25),
    Rect::new(12, 27, 56, 42),
    Rect::new(18, 66, 44, 29),
    Rect::new(19, 95, 14, 9),
    Rect::new(47, 95, 14, 9),
];

pub const PAL_EYES: [Rect; 2] = [Rect::new(26, 48, 7, 7), Rect::new(47, 48, 7, 7)];

/// Valid scale factors are positive and finite; anything else is treated as 1.0
/// rather than producing zero-sized or overflowing native regions.
pub fn sanitize_scale(scale: f64) -> f64 {
    if scale.is_finite() && (0.25..=8.0).contains(&scale) {
        scale
    } else {
        1.0
    }
}

/// Converts a logical rectangle to physical pixels. Edges are rounded
/// independently so adjacent parts stay adjacent after scaling.
pub fn scale_rect(rect: Rect, scale: f64) -> Rect {
    let scale = sanitize_scale(scale);
    let edge = |value: i32| (f64::from(value) * scale).round() as i32;
    let left = edge(rect.x);
    let top = edge(rect.y);
    Rect::new(
        left,
        top,
        edge(rect.right()) - left,
        edge(rect.bottom()) - top,
    )
}

pub fn scale_length(value: u32, scale: f64) -> u32 {
    ((f64::from(value) * sanitize_scale(scale)).round() as u32).max(1)
}

/// Physical-pixel Pal silhouette for a logical Pal position.
pub fn pal_shapes(x: i32, y: i32, scale: f64) -> [Rect; 6] {
    PAL_PARTS.map(|part| scale_rect(part.translate(x, y), scale))
}

pub fn pal_eyes(x: i32, y: i32, scale: f64) -> [Rect; 2] {
    PAL_EYES.map(|eye| scale_rect(eye.translate(x, y), scale))
}

/// `x`/`y` are physical client coordinates (as reported by the OS).
pub fn hits_pal(x: i32, y: i32, pal_x: i32, pal_y: i32, scale: f64) -> bool {
    pal_shapes(pal_x, pal_y, scale)
        .iter()
        .any(|part| part.contains(x, y))
}

/// Places a `width` x `height` physical window inside a monitor work area
/// (physical virtual-desktop coordinates, which may be negative on secondary
/// monitors). The margin is applied from the work-area origin and then the
/// result is clamped so the overlay never straddles a monitor edge.
pub fn place_in_work_area(work: Rect, width: i32, height: i32, margin: i32) -> (i32, i32) {
    let clamp_axis = |origin: i32, extent: i32, size: i32| {
        let max = origin.saturating_add(extent).saturating_sub(size);
        origin.saturating_add(margin).min(max).max(origin)
    };
    (
        clamp_axis(work.x, work.width, width),
        clamp_axis(work.y, work.height, height),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCALES: [f64; 5] = [1.0, 1.25, 1.5, 1.75, 2.0];

    #[test]
    fn empty_overlay_samples_pass_through() {
        for scale in SCALES {
            for i in 0..100 {
                // Synthetic geometry only, NOT Windows click-through evidence.
                assert!(!hits_pal(
                    scale_length(500 + i, scale) as i32,
                    5,
                    90,
                    100,
                    scale
                ));
            }
        }
    }

    #[test]
    fn pal_shape_samples_are_interactive_at_every_scale() {
        for scale in SCALES {
            for i in 0..30 {
                let p = PAL_PARTS[i % PAL_PARTS.len()].translate(90, 100);
                let centre_x = (f64::from(p.x) + f64::from(p.width) / 2.0) * scale;
                let centre_y = (f64::from(p.y) + f64::from(p.height) / 2.0) * scale;
                assert!(
                    hits_pal(centre_x as i32, centre_y as i32, 90, 100, scale),
                    "scale {scale} part {i}"
                );
            }
        }
    }

    #[test]
    fn half_open_geometry_has_no_extra_capture() {
        assert!(!Rect::new(1, 2, 4, 5).contains(5, 3));
        assert!(!Rect::new(1, 2, 4, 5).contains(3, 7));
        assert!(Rect::new(1, 2, 4, 5).contains(4, 6));
        assert!(!Rect::new(0, 0, 0, 5).contains(0, 1));
    }

    #[test]
    fn scaling_keeps_adjacent_parts_adjacent() {
        let a = Rect::new(10, 10, 7, 7);
        let b = Rect::new(17, 10, 7, 7);
        for scale in SCALES {
            assert_eq!(scale_rect(a, scale).right(), scale_rect(b, scale).x);
        }
        assert_eq!(scale_rect(a, 2.0), Rect::new(20, 20, 14, 14));
    }

    #[test]
    fn invalid_scale_falls_back_to_identity() {
        let r = Rect::new(3, 4, 5, 6);
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, 100.0] {
            assert_eq!(scale_rect(r, bad), r);
        }
    }

    #[test]
    fn placement_respects_negative_monitor_coordinates() {
        // Secondary monitor to the left of the primary, 150% scaling.
        let work = Rect::new(-2880, -200, 2880, 1680);
        let (x, y) = place_in_work_area(work, 960, 540, 90);
        assert_eq!((x, y), (-2790, -110));
    }

    #[test]
    fn placement_clamps_overlay_inside_small_work_area() {
        let work = Rect::new(0, 0, 800, 400);
        let (x, y) = place_in_work_area(work, 640, 360, 60);
        assert_eq!((x, y), (60, 40));
        // Larger than the work area: pinned to the origin, never off-screen left/top.
        assert_eq!(place_in_work_area(work, 1000, 500, 60), (0, 0));
    }
}
