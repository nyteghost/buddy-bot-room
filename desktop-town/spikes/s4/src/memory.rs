//! Staged process-memory attribution (owner report: ~421 MiB in Task Manager).
//!
//! The Win32 layer samples `K32GetProcessMemoryInfo` at each start-up stage
//! (event loop, window, wgpu instance/surface/adapter/device, pipeline, first
//! frame), at exit and after the GPU device has been released. This module
//! stores the samples, computes per-stage deltas and serialises the report to
//! `Data/s4-memory.json`, so a run on real hardware shows *which stage* commits
//! the memory instead of a single opaque Task Manager figure.
//!
//! Terminology (Task Manager "Memory" column = private working set):
//! * `private_bytes`       commit charge private to the process (PrivateUsage)
//! * `working_set`         physical pages mapped, incl. shared DLL pages
//! * `private_working_set` physical pages private to the process (Task Manager)
//!
//! GPU-local video memory is NOT in these counters; use the GPU Process Memory
//! performance counters (scripts/profile-memory.ps1).

use serde::Serialize;

pub const MIB: f64 = 1024.0 * 1024.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Counters {
    pub private_bytes: u64,
    pub working_set: u64,
    /// `None` when the OS does not provide PROCESS_MEMORY_COUNTERS_EX2.
    pub private_working_set: Option<u64>,
    pub peak_working_set: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Sample {
    pub stage: String,
    pub elapsed_ms: u64,
    pub counters: Counters,
    /// Private-bytes change since the previous sample, in MiB.
    pub private_delta_mib: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct GpuAllocator {
    pub allocated_bytes: u64,
    pub reserved_bytes: u64,
    pub block_sizes: Vec<u64>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Profile {
    pub note: &'static str,
    pub samples: Vec<Sample>,
    /// wgpu/gpu-allocator suballocation heaps (D3D12 only), by stage label.
    pub gpu_allocator: Vec<(String, GpuAllocator)>,
    pub context: serde_json::Map<String, serde_json::Value>,
}

/// Bound on stored samples so a long session cannot grow the profile itself.
pub const MAX_SAMPLES: usize = 64;

fn mib(bytes: i128) -> f64 {
    let value = bytes as f64 / MIB;
    (value * 100.0).round() / 100.0
}

impl Profile {
    pub fn new() -> Self {
        Self {
            note: "Process counters from K32GetProcessMemoryInfo; private_working_set matches the \
                   Task Manager Memory column. GPU-local memory is not included.",
            ..Self::default()
        }
    }

    pub fn record(&mut self, stage: &str, elapsed_ms: u64, counters: Counters) {
        if self.samples.len() >= MAX_SAMPLES {
            return;
        }
        let previous = self
            .samples
            .last()
            .map_or(0, |sample| sample.counters.private_bytes);
        let delta = if self.samples.is_empty() {
            0.0
        } else {
            mib(i128::from(counters.private_bytes) - i128::from(previous))
        };
        self.samples.push(Sample {
            stage: stage.to_owned(),
            elapsed_ms,
            counters,
            private_delta_mib: delta,
        });
    }

    pub fn record_allocator(&mut self, stage: &str, report: GpuAllocator) {
        if self.gpu_allocator.len() < MAX_SAMPLES {
            self.gpu_allocator.push((stage.to_owned(), report));
        }
    }

    pub fn set(&mut self, key: &str, value: impl Into<serde_json::Value>) {
        self.context.insert(key.to_owned(), value.into());
    }

    pub fn sample(&self, stage: &str) -> Option<&Sample> {
        self.samples.iter().find(|sample| sample.stage == stage)
    }

    /// Private-bytes change between two recorded stages, in MiB.
    pub fn delta_mib(&self, from: &str, to: &str) -> Option<f64> {
        let a = self.sample(from)?.counters.private_bytes;
        let b = self.sample(to)?.counters.private_bytes;
        Some(mib(i128::from(b) - i128::from(a)))
    }

    /// One-line summary for Data/s4-last-run.log.
    pub fn summary_line(&self) -> String {
        let parts: Vec<String> = self
            .samples
            .iter()
            .map(|sample| {
                format!(
                    "{}={:.1}MiB({:+.1})",
                    sample.stage,
                    sample.counters.private_bytes as f64 / MIB,
                    sample.private_delta_mib
                )
            })
            .collect();
        format!("MEM private_bytes by stage: {}", parts.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counters(private_mib: u64) -> Counters {
        Counters {
            private_bytes: private_mib * 1024 * 1024,
            working_set: private_mib * 2 * 1024 * 1024,
            private_working_set: Some(private_mib * 1024 * 1024),
            peak_working_set: private_mib * 2 * 1024 * 1024,
        }
    }

    #[test]
    fn deltas_attribute_memory_to_stages() {
        let mut profile = Profile::new();
        profile.record("process-start", 0, counters(4));
        profile.record("gpu-device", 50, counters(36));
        profile.record("first-frame", 80, counters(300));
        profile.record("after-gpu-release", 900, counters(40));
        assert_eq!(profile.samples[0].private_delta_mib, 0.0);
        assert_eq!(profile.samples[1].private_delta_mib, 32.0);
        assert_eq!(profile.samples[2].private_delta_mib, 264.0);
        assert_eq!(profile.samples[3].private_delta_mib, -260.0);
        assert_eq!(
            profile.delta_mib("process-start", "first-frame"),
            Some(296.0)
        );
        assert_eq!(profile.delta_mib("missing", "first-frame"), None);
    }

    #[test]
    fn profile_is_bounded() {
        let mut profile = Profile::new();
        for i in 0..(MAX_SAMPLES as u64 + 20) {
            profile.record("tick", i, counters(1));
            profile.record_allocator("tick", GpuAllocator::default());
        }
        assert_eq!(profile.samples.len(), MAX_SAMPLES);
        assert_eq!(profile.gpu_allocator.len(), MAX_SAMPLES);
    }

    #[test]
    fn report_serialises_without_secrets() {
        let mut profile = Profile::new();
        profile.record("process-start", 0, counters(4));
        profile.record_allocator(
            "first-frame",
            GpuAllocator {
                allocated_bytes: 4096,
                reserved_bytes: 8 << 20,
                block_sizes: vec![8 << 20],
            },
        );
        profile.set("memory_hints", "MemoryUsage");
        let json = serde_json::to_string(&profile).unwrap();
        assert!(json.contains("\"private_bytes\":4194304"));
        assert!(json.contains("\"reserved_bytes\":8388608"));
        assert!(json.contains("MemoryUsage"));
        for forbidden in ["token", "password", "api_key"] {
            assert!(!json.contains(forbidden));
        }
    }

    #[test]
    fn summary_line_lists_every_stage() {
        let mut profile = Profile::new();
        profile.record("process-start", 0, counters(4));
        profile.record("first-frame", 1, counters(10));
        let line = profile.summary_line();
        assert!(line.contains("process-start=4.0MiB(+0.0)"), "{line}");
        assert!(line.contains("first-frame=10.0MiB(+6.0)"), "{line}");
    }
}
