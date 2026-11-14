//! Explicit, testable GPU adapter selection.
//!
//! Previous behaviour: `request_adapter(PowerPreference::LowPower)` let wgpu /
//! DXGI pick, which on hybrid systems orders adapters by minimum power, so the
//! integrated GPU was chosen (owner report PP-DT-WIN-HW-001: "Intel(R) Graphics,
//! IntegratedGpu"). The policy is now explicit and logged:
//!
//! * Only adapters whose surface is supported AND offers a non-opaque
//!   (transparent) alpha mode are eligible; everything else is skipped.
//! * Default `LowPower`: Integrated > Discrete > Virtual > Other > Cpu.
//!   Rationale: the overlay draws a few quads, so the integrated GPU leaves the
//!   discrete GPU fully to games and avoids waking it on hybrid laptops.
//! * `HighPerformance` (opt-in, `--gpu-preference=high-performance`):
//!   Discrete > Integrated > Virtual > Other > Cpu.
//! * A software (Cpu) adapter is a last resort and is logged as such.
//! * Ties keep the OS enumeration order.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdapterKind {
    Integrated,
    Discrete,
    Virtual,
    Cpu,
    Other,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GpuPreference {
    #[default]
    LowPower,
    HighPerformance,
}

impl GpuPreference {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "low-power" | "integrated" => Ok(Self::LowPower),
            "high-performance" | "discrete" => Ok(Self::HighPerformance),
            other => Err(format!(
                "invalid GPU preference {other:?} (use low-power or high-performance)"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub kind: AdapterKind,
    pub surface_supported: bool,
    pub transparent_alpha: bool,
}

impl Candidate {
    pub fn eligible(self) -> bool {
        self.surface_supported && self.transparent_alpha
    }
}

pub fn rank(kind: AdapterKind, preference: GpuPreference) -> u8 {
    match (preference, kind) {
        (GpuPreference::LowPower, AdapterKind::Integrated)
        | (GpuPreference::HighPerformance, AdapterKind::Discrete) => 0,
        (GpuPreference::LowPower, AdapterKind::Discrete)
        | (GpuPreference::HighPerformance, AdapterKind::Integrated) => 1,
        (_, AdapterKind::Virtual) => 2,
        (_, AdapterKind::Other) => 3,
        (_, AdapterKind::Cpu) => 4,
    }
}

/// Index of the chosen candidate, or `None` when nothing is eligible.
pub fn choose(candidates: &[Candidate], preference: GpuPreference) -> Option<usize> {
    candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| candidate.eligible())
        .min_by_key(|(index, candidate)| (rank(candidate.kind, preference), *index))
        .map(|(index, _)| index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use AdapterKind::{Cpu, Discrete, Integrated, Other, Virtual};

    fn ok(kind: AdapterKind) -> Candidate {
        Candidate {
            kind,
            surface_supported: true,
            transparent_alpha: true,
        }
    }

    #[test]
    fn low_power_prefers_integrated_on_hybrid_systems() {
        let list = [ok(Discrete), ok(Integrated), ok(Cpu)];
        assert_eq!(choose(&list, GpuPreference::LowPower), Some(1));
    }

    #[test]
    fn high_performance_prefers_discrete() {
        let list = [ok(Integrated), ok(Cpu), ok(Discrete)];
        assert_eq!(choose(&list, GpuPreference::HighPerformance), Some(2));
    }

    #[test]
    fn single_gpu_systems_use_that_gpu_either_way() {
        for preference in [GpuPreference::LowPower, GpuPreference::HighPerformance] {
            assert_eq!(choose(&[ok(Discrete), ok(Cpu)], preference), Some(0));
            assert_eq!(choose(&[ok(Cpu), ok(Integrated)], preference), Some(1));
        }
    }

    #[test]
    fn software_adapter_is_last_resort_only() {
        assert_eq!(choose(&[ok(Cpu)], GpuPreference::LowPower), Some(0));
        assert_eq!(
            choose(&[ok(Cpu), ok(Other)], GpuPreference::LowPower),
            Some(1)
        );
        assert_eq!(
            choose(&[ok(Cpu), ok(Virtual)], GpuPreference::HighPerformance),
            Some(1)
        );
    }

    #[test]
    fn opaque_or_unsupported_surfaces_are_never_chosen() {
        let opaque = Candidate {
            transparent_alpha: false,
            ..ok(Integrated)
        };
        let unsupported = Candidate {
            surface_supported: false,
            ..ok(Discrete)
        };
        assert_eq!(
            choose(&[opaque, unsupported], GpuPreference::LowPower),
            None
        );
        assert_eq!(
            choose(&[opaque, unsupported, ok(Cpu)], GpuPreference::LowPower),
            Some(2)
        );
        assert_eq!(choose(&[], GpuPreference::LowPower), None);
    }

    #[test]
    fn ties_keep_enumeration_order() {
        let list = [ok(Integrated), ok(Integrated)];
        assert_eq!(choose(&list, GpuPreference::LowPower), Some(0));
    }

    #[test]
    fn preference_parsing() {
        assert_eq!(
            GpuPreference::parse("low-power"),
            Ok(GpuPreference::LowPower)
        );
        assert_eq!(
            GpuPreference::parse("discrete"),
            Ok(GpuPreference::HighPerformance)
        );
        assert!(GpuPreference::parse("fast").is_err());
        assert_eq!(GpuPreference::default(), GpuPreference::LowPower);
    }
}
