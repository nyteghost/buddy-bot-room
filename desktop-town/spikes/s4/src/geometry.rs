//! The same shape geometry is used for GPU quads and native Win32 input regions.
//! Nothing outside these shapes should capture pointer input.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self { x, y, width, height }
    }

    pub fn contains(self, x: i32, y: i32) -> bool {
        self.width > 0
            && self.height > 0
            && x >= self.x
            && y >= self.y
            && x < self.x.saturating_add(self.width)
            && y < self.y.saturating_add(self.height)
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

pub fn pal_shapes(x: i32, y: i32) -> [Rect; 6] {
    PAL_PARTS.map(|part| part.translate(x, y))
}

pub fn hits_pal(x: i32, y: i32, pal_x: i32, pal_y: i32) -> bool {
    pal_shapes(pal_x, pal_y)
        .iter()
        .any(|part| part.contains(x, y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_overlay_samples_pass_through() {
        for i in 0..100 {
            // Synthetic geometry only, NOT Windows click-through evidence.
            assert!(!hits_pal(500 + i, 5, 90, 100));
        }
    }

    #[test]
    fn pal_shape_samples_are_interactive() {
        for i in 0..30 {
            let p = PAL_PARTS[i % PAL_PARTS.len()];
            assert!(hits_pal(90 + p.x + p.width / 2, 100 + p.y + p.height / 2, 90, 100));
        }
    }

    #[test]
    fn half_open_geometry_has_no_extra_capture() {
        assert!(!Rect::new(1, 2, 4, 5).contains(5, 3));
        assert!(!Rect::new(1, 2, 4, 5).contains(3, 7));
        assert!(Rect::new(1, 2, 4, 5).contains(4, 6));
        assert!(!Rect::new(0, 0, 0, 5).contains(0, 1));
    }
}
