//! Windows-specific, purposely isolated experiment.
//!
//! Responsibilities are split deliberately:
//! * Win32 owns placement, DPI, z-order, focus behaviour and the input region
//!   (`SetWindowRgn`): pixels outside the Pal silhouette are not part of the
//!   window, so clicks there reach whatever application is underneath.
//! * wgpu owns drawing only. On D3D12 it presents through a DirectComposition
//!   visual (`Dx12SwapchainKind::DxgiFromVisual`) because an HWND flip-model
//!   swapchain only supports opaque alpha. Opaque swapchains are refused.
use crate::{
    adapter_policy::{self, AdapterKind, Candidate, GpuPreference},
    cli::{self, Options},
    fullscreen::{self, Foreground, ShellState},
    geometry::{self, Rect},
    memory::{self, Profile},
    portable::{self, Store},
    schedule,
    startup::{
        self, FaultPlan, FrameOutcome, OverlayPort, RedrawAction, RetryPolicy, Reveal, SkipTracker,
        Startup,
    },
    state::DemoState,
};
use bytemuck::{Pod, Zeroable};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{
    cell::{Cell, RefCell},
    error::Error,
    fmt::Display,
    fs,
    io::Write as _,
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, GetMonitorInfoW, MonitorFromWindow, SetWindowRgn,
        HMONITOR, MONITORINFO, MONITOR_DEFAULTTONULL, RGN_OR,
    },
    System::{
        ProcessStatus::{
            K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
        },
        Threading::GetCurrentProcess,
    },
    UI::{
        HiDpi::{
            AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext,
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        Shell::{
            SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
        },
        WindowsAndMessaging::{
            GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
            SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SW_HIDE, SW_SHOWNOACTIVATE,
            WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    },
};
use winit::{
    dpi::{PhysicalPosition, PhysicalSize},
    event::{ElementState, Event, MouseButton, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    monitor::MonitorHandle,
    platform::windows::{MonitorHandleExtWindows, WindowBuilderExtWindows},
    window::{Window, WindowBuilder, WindowLevel},
};

const EXIT_OK: i32 = 0;
const EXIT_FATAL: i32 = 1;
const EXIT_USAGE: i32 = 2;
const EXIT_SMOKE_NO_FRAMES: i32 = 3;
/// No frame could be presented during the bounded first-frame handshake; the
/// overlay was never shown and its input region stayed empty.
const EXIT_FIRST_FRAME_FAILED: i32 = 4;

const RUN_LOG: &str = "s4-last-run.log";
const SMOKE_REPORT: &str = "s4-smoke.json";
const MEMORY_REPORT: &str = "s4-memory.json";
const RENDER_SAMPLE: &str = "s4-render-sample.json";

/// Entry point used by `main`. Never panics on expected failures; returns a
/// documented exit code (0 ok, 1 fatal/fail-closed, 2 usage, 3 smoke without
/// any presented frame, 4 first frame never presented).
pub fn main_exit_code() -> i32 {
    let options = match cli::parse(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("S4 usage error: {error}");
            return EXIT_USAGE;
        }
    };
    if options.self_test {
        return match portable::run_self_test() {
            Ok(()) => {
                println!("S4 portable settings round-trip: PASS");
                EXIT_OK
            }
            Err(error) => {
                eprintln!("S4 portable settings round-trip: FAIL: {error}");
                EXIT_FATAL
            }
        };
    }
    let mut log = RunLog::stderr_only();
    match run(&options, &mut log) {
        Ok(code) => code,
        Err(error) => {
            log.line(format!("S4 fail-closed: {error}"));
            EXIT_FATAL
        }
    }
}

/// Diagnostics for a GUI-subsystem executable: stderr (visible in debug
/// builds / when redirected) plus Data/s4-last-run.log when Data/ is writable.
/// Contains no secrets: only backend, adapter, DPI, paths inside the portable
/// folder and pass/fail lines.
struct RunLog {
    file: Option<fs::File>,
}

impl RunLog {
    fn stderr_only() -> Self {
        Self { file: None }
    }

    fn attach(&mut self, store: &Store) {
        if store.writable {
            self.file = fs::File::create(store.data_path().join(RUN_LOG)).ok();
        }
    }

    fn line(&mut self, message: impl Display) {
        eprintln!("{message}");
        if let Some(file) = self.file.as_mut() {
            let _ = writeln!(file, "{message}");
            let _ = file.flush();
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Vertex {
    position: [f32; 2],
    color: [f32; 4],
}

/// Pal silhouette (6 parts) + 2 eyes, 6 vertices per quad.
const MAX_VERTICES: usize = 8 * 6;

struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    /// One persistent vertex buffer, rewritten per frame (no per-frame
    /// buffer creation / staging allocation churn).
    vertex_buffer: wgpu::Buffer,
    backend: String,
    adapter: String,
    device_type: String,
    memory_hints: &'static str,
    adapters_seen: Vec<String>,
}

/// GPU initialisation choices, from the command line.
#[derive(Clone, Copy)]
struct GpuChoice {
    preference: GpuPreference,
    memory_hints_performance: bool,
}

fn instance_for(backends: wgpu::Backends) -> wgpu::Instance {
    // FXC ships with Windows (d3dcompiler_47.dll), so the portable ZIP needs
    // no dxcompiler.dll/dxil.dll. DirectComposition presentation is the only
    // D3D12 path that supports a non-opaque (transparent) swapchain.
    wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends,
        backend_options: wgpu::BackendOptions {
            dx12: wgpu::Dx12BackendOptions {
                shader_compiler: wgpu::Dx12Compiler::Fxc,
                presentation_system: wgpu_types::Dx12SwapchainKind::DxgiFromVisual,
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    })
}

fn adapter_kind(device_type: wgpu::DeviceType) -> AdapterKind {
    match device_type {
        wgpu::DeviceType::IntegratedGpu => AdapterKind::Integrated,
        wgpu::DeviceType::DiscreteGpu => AdapterKind::Discrete,
        wgpu::DeviceType::VirtualGpu => AdapterKind::Virtual,
        wgpu::DeviceType::Cpu => AdapterKind::Cpu,
        wgpu::DeviceType::Other => AdapterKind::Other,
    }
}

fn transparent_alpha(modes: &[wgpu::CompositeAlphaMode]) -> Option<wgpu::CompositeAlphaMode> {
    [
        wgpu::CompositeAlphaMode::PreMultiplied,
        wgpu::CompositeAlphaMode::PostMultiplied,
    ]
    .into_iter()
    .find(|mode| modes.contains(mode))
}

impl Renderer {
    async fn new(
        window: Arc<Window>,
        choice: GpuChoice,
        mark: &mut dyn FnMut(&str),
    ) -> Result<Self, Box<dyn Error>> {
        let mut errors = Vec::new();
        let mut adapters_seen = Vec::new();
        for backend in [
            wgpu::Backends::DX12,
            wgpu::Backends::VULKAN,
            wgpu::Backends::GL,
        ] {
            let instance = instance_for(backend);
            mark("gpu-instance");
            let surface = match instance.create_surface(window.clone()) {
                Ok(surface) => surface,
                Err(error) => {
                    errors.push(format!("surface {backend:?}: {error}"));
                    continue;
                }
            };
            mark("gpu-surface");
            // Explicit, logged adapter policy (see adapter_policy.rs).
            let mut adapters = instance.enumerate_adapters(backend);
            let mut candidates = Vec::with_capacity(adapters.len());
            for (index, adapter) in adapters.iter().enumerate() {
                let info = adapter.get_info();
                let surface_supported = adapter.is_surface_supported(&surface);
                let alpha = if surface_supported {
                    transparent_alpha(&surface.get_capabilities(adapter).alpha_modes)
                } else {
                    None
                };
                candidates.push(Candidate {
                    kind: adapter_kind(info.device_type),
                    surface_supported,
                    transparent_alpha: alpha.is_some(),
                });
                adapters_seen.push(format!(
                    "{backend:?}[{index}] {} ({:?}, driver {} {}) surface={surface_supported} \
                     transparent={}",
                    info.name,
                    info.device_type,
                    info.driver,
                    info.driver_info,
                    alpha.is_some()
                ));
            }
            let Some(index) = adapter_policy::choose(&candidates, choice.preference) else {
                errors.push(format!(
                    "{backend:?}: no adapter with a supported transparent surface \
                     ({} enumerated)",
                    candidates.len()
                ));
                continue;
            };
            let adapter = adapters.swap_remove(index);
            drop(adapters); // release handles to adapters that were not chosen
            mark("gpu-adapter");
            let caps = surface.get_capabilities(&adapter);
            let Some(alpha_mode) = transparent_alpha(&caps.alpha_modes) else {
                errors.push(format!(
                    "opaque-only surface {backend:?} {:?}; refusing unsafe overlay",
                    caps.alpha_modes
                ));
                continue;
            };
            // Non-sRGB 8-bit formats: authored colours are written as-is and
            // DWM composes premultiplied BGRA without an extra conversion.
            let Some(format) = [
                wgpu::TextureFormat::Bgra8Unorm,
                wgpu::TextureFormat::Rgba8Unorm,
            ]
            .into_iter()
            .find(|format| caps.formats.contains(format))
            .or_else(|| caps.formats.first().copied()) else {
                errors.push(format!("no surface format: {backend:?}"));
                continue;
            };
            // MemoryUsage: 8 MiB device / 4 MiB host D3D12 suballocation blocks
            // instead of gpu-allocator's 256 / 64 MiB defaults (Performance).
            // The overlay allocates a few KiB; on integrated GPUs those heaps
            // are system RAM.
            let (memory_hints, memory_hints_name) = if choice.memory_hints_performance {
                (wgpu::MemoryHints::Performance, "Performance")
            } else {
                (wgpu::MemoryHints::MemoryUsage, "MemoryUsage")
            };
            let (device, queue) = match adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("Pixel Pals S4 wgpu device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints,
                    ..Default::default()
                })
                .await
            {
                Ok(pair) => pair,
                Err(error) => {
                    errors.push(format!("request device {backend:?}: {error}"));
                    continue;
                }
            };
            mark("gpu-device");
            let size = window.inner_size();
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: size.width.max(1),
                height: size.height.max(1),
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: 2,
                alpha_mode,
                view_formats: vec![],
            };
            surface.configure(&device, &config);
            mark("gpu-surface-configured");
            let pipeline = create_pipeline(&device, format, alpha_mode);
            let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("S4 pal geometry"),
                size: (MAX_VERTICES * std::mem::size_of::<Vertex>()) as wgpu::BufferAddress,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            mark("gpu-pipeline");
            let info = adapter.get_info();
            return Ok(Self {
                surface,
                device,
                queue,
                config,
                pipeline,
                vertex_buffer,
                backend: format!("{:?}", info.backend),
                adapter: info.name,
                device_type: format!("{:?}", info.device_type),
                memory_hints: memory_hints_name,
                adapters_seen,
            });
        }
        Err(format!(
            "No safe transparent GPU backend: {} | adapters: {}",
            errors.join(" | "),
            adapters_seen.join("; ")
        )
        .into())
    }

    /// wgpu/gpu-allocator suballocation heap usage (D3D12; None elsewhere).
    fn allocator_report(&self) -> Option<memory::GpuAllocator> {
        self.device
            .generate_allocator_report()
            .map(|report| memory::GpuAllocator {
                allocated_bytes: report.total_allocated_bytes,
                reserved_bytes: report.total_reserved_bytes,
                block_sizes: report.blocks.iter().map(|block| block.size).collect(),
            })
    }

    fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
    }

    fn reconfigure(&mut self) {
        self.surface.configure(&self.device, &self.config);
    }

    /// One render+present attempt. Skipped frames (Timeout/Lost/Outdated) are
    /// reported, not hidden: the caller decides on reconfigure/retry/visibility.
    fn render(&mut self, state: &DemoState, scale: f64) -> FrameOutcome {
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost) => return FrameOutcome::Lost,
            Err(wgpu::SurfaceError::Outdated) => return FrameOutcome::Outdated,
            Err(wgpu::SurfaceError::Timeout) => return FrameOutcome::Timeout,
            Err(error) => return FrameOutcome::Fatal(error.to_string()),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let vertices = sprite_vertices(state, scale, self.config.width, self.config.height);
        debug_assert!(vertices.len() <= MAX_VERTICES);
        let bytes: &[u8] = bytemuck::cast_slice(&vertices);
        self.queue.write_buffer(&self.vertex_buffer, 0, bytes);
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("S4 draw encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("S4 alpha pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..bytes.len() as u64));
            pass.draw(0..vertices.len() as u32, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        let suboptimal = frame.suboptimal;
        frame.present();
        if suboptimal {
            self.reconfigure();
        }
        FrameOutcome::Presented
    }
}

fn create_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    alpha_mode: wgpu::CompositeAlphaMode,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("S4 silhouette shader"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
    });
    let blend = if alpha_mode == wgpu::CompositeAlphaMode::PreMultiplied {
        wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING
    } else {
        wgpu::BlendState::ALPHA_BLENDING
    };
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("S4 silhouette pipeline"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4],
            }],
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(blend),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    })
}

fn sprite_vertices(state: &DemoState, scale: f64, width: u32, height: u32) -> Vec<Vertex> {
    let mut output = Vec::with_capacity(8 * 6);
    let colors = [
        [0.64, 0.34, 0.86, 1.0],
        [0.64, 0.34, 0.86, 1.0],
        [0.76, 0.51, 0.96, 1.0],
        [0.42, 0.56, 0.92, 1.0],
        [0.24, 0.27, 0.50, 1.0],
        [0.24, 0.27, 0.50, 1.0],
    ];
    let parts = geometry::pal_shapes(state.pal_x, state.pal_y, scale);
    for (part, color) in parts.into_iter().zip(colors) {
        add_quad(&mut output, part, color, width, height);
    }
    for eye in geometry::pal_eyes(state.pal_x, state.pal_y, scale) {
        add_quad(&mut output, eye, [0.04, 0.04, 0.09, 1.0], width, height);
    }
    output
}

fn add_quad(output: &mut Vec<Vertex>, rect: Rect, color: [f32; 4], width: u32, height: u32) {
    let xy = |x: i32, y: i32| Vertex {
        position: [
            2.0 * x as f32 / width as f32 - 1.0,
            1.0 - 2.0 * y as f32 / height as f32,
        ],
        color,
    };
    let (l, t, r, b) = (rect.x, rect.y, rect.right(), rect.bottom());
    output.extend_from_slice(&[xy(l, t), xy(r, t), xy(l, b), xy(r, t), xy(r, b), xy(l, b)]);
}

fn hwnd(window: &Window) -> Result<HWND, Box<dyn Error>> {
    match window.window_handle()?.as_raw() {
        RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get()),
        _ => Err("not a Win32 HWND".into()),
    }
}

/// Replaces the window region with the union of the Pal silhouette rectangles
/// (physical client coordinates; the window is undecorated so client == window).
fn apply_pal_region(handle: HWND, state: &DemoState, scale: f64) -> Result<(), Box<dyn Error>> {
    // SAFETY: GDI region handles are created and used on the UI thread.
    // Ownership of `root` transfers to Windows ONLY when SetWindowRgn succeeds;
    // every failure path deletes the regions it created.
    unsafe {
        let root = CreateRectRgn(0, 0, 0, 0);
        if root == 0 {
            return Err("CreateRectRgn(root) failed".into());
        }
        for rect in geometry::pal_shapes(state.pal_x, state.pal_y, scale) {
            let part = CreateRectRgn(rect.x, rect.y, rect.right(), rect.bottom());
            if part == 0 {
                DeleteObject(root);
                return Err("CreateRectRgn(part) failed".into());
            }
            let result = CombineRgn(root, root, part, RGN_OR);
            DeleteObject(part);
            if result == 0 {
                DeleteObject(root);
                return Err("CombineRgn failed".into());
            }
        }
        if SetWindowRgn(handle, root, 1) == 0 {
            DeleteObject(root);
            return Err("SetWindowRgn failed; overlay must be hidden".into());
        }
    }
    Ok(())
}

/// Installs an EMPTY window region: no pixel of the window can be hit-tested,
/// so even a visible window could not intercept a click. Used from creation
/// until the first successful present, and whenever presentation fails.
fn apply_empty_region(handle: HWND) -> Result<(), String> {
    // SAFETY: same ownership rules as apply_pal_region.
    unsafe {
        let empty = CreateRectRgn(0, 0, 0, 0);
        if empty == 0 {
            return Err("CreateRectRgn(empty) failed".to_owned());
        }
        if SetWindowRgn(handle, empty, 1) == 0 {
            DeleteObject(empty);
            return Err("SetWindowRgn(empty) failed".to_owned());
        }
    }
    Ok(())
}

/// Production [`OverlayPort`]: real wgpu presentation and Win32 visibility /
/// input-region changes, plus optional QA fault injection.
struct LivePort<'a> {
    renderer: &'a mut Renderer,
    handle: HWND,
    state: &'a DemoState,
    scale: f64,
    stats: &'a mut FrameStats,
    fault: Option<&'a mut FaultPlan>,
    started: Instant,
}

impl OverlayPort for LivePort<'_> {
    fn present(&mut self) -> FrameOutcome {
        if let Some(injected) = self.fault.as_mut().and_then(|plan| plan.next()) {
            return injected;
        }
        let start = Instant::now();
        let outcome = self.renderer.render(self.state, self.scale);
        if outcome == FrameOutcome::Presented {
            self.stats.push(start.elapsed());
        }
        outcome
    }
    fn reconfigure(&mut self) {
        self.renderer.reconfigure();
    }
    fn activate_input(&mut self) -> Result<(), String> {
        apply_pal_region(self.handle, self.state, self.scale).map_err(|error| error.to_string())
    }
    fn deactivate_input(&mut self) {
        // The window is hidden on every path that calls this, so a failure
        // here cannot expose an input region.
        let _ = apply_empty_region(self.handle);
    }
    fn show(&mut self) {
        show(self.handle, true);
    }
    fn hide(&mut self) {
        show(self.handle, false);
    }
    fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }
    fn sleep(&mut self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

fn show(handle: HWND, visible: bool) {
    // SAFETY: only our own live HWND; SW_SHOWNOACTIVATE never steals focus.
    unsafe {
        ShowWindow(handle, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }
}

fn hide_on_failure(handle: HWND, log: &mut RunLog, message: &str) {
    log.line(format!("FATAL OVERLAY SAFETY: {message}"));
    show(handle, false);
    let _ = apply_empty_region(handle);
}

/// PROCESS_MEMORY_COUNTERS_EX2 (Windows 10 1809+), declared locally so the
/// private working set (Task Manager "Memory" column) is available.
#[repr(C)]
#[derive(Default)]
#[allow(dead_code)] // FFI layout: every field must exist even if unread
struct ProcessMemoryCountersEx2 {
    cb: u32,
    page_fault_count: u32,
    peak_working_set_size: usize,
    working_set_size: usize,
    quota_peak_paged_pool_usage: usize,
    quota_paged_pool_usage: usize,
    quota_peak_non_paged_pool_usage: usize,
    quota_non_paged_pool_usage: usize,
    pagefile_usage: usize,
    peak_pagefile_usage: usize,
    private_usage: usize,
    private_working_set_size: usize,
    shared_commit_usage: u64,
}

/// Current process memory counters; zeros if the OS refuses both layouts.
fn process_counters() -> memory::Counters {
    // SAFETY: pseudo-handle for this process; out-structs are plain data with
    // `cb` set to their size, as K32GetProcessMemoryInfo requires.
    unsafe {
        let process = GetCurrentProcess();
        let mut ex2 = ProcessMemoryCountersEx2 {
            cb: std::mem::size_of::<ProcessMemoryCountersEx2>() as u32,
            ..Default::default()
        };
        let cb = ex2.cb;
        let pointer = std::ptr::addr_of_mut!(ex2).cast::<PROCESS_MEMORY_COUNTERS>();
        if K32GetProcessMemoryInfo(process, pointer, cb) != 0 {
            return memory::Counters {
                private_bytes: ex2.private_usage as u64,
                working_set: ex2.working_set_size as u64,
                private_working_set: Some(ex2.private_working_set_size as u64),
                peak_working_set: ex2.peak_working_set_size as u64,
            };
        }
        let mut ex: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        ex.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let cb = ex.cb;
        let pointer = std::ptr::addr_of_mut!(ex).cast::<PROCESS_MEMORY_COUNTERS>();
        if K32GetProcessMemoryInfo(process, pointer, cb) != 0 {
            return memory::Counters {
                private_bytes: ex.PrivateUsage as u64,
                working_set: ex.WorkingSetSize as u64,
                private_working_set: None,
                peak_working_set: ex.PeakWorkingSetSize as u64,
            };
        }
        memory::Counters::default()
    }
}

/// Shared, bounded memory profile with a stage clock.
struct MemoryTrace {
    profile: Profile,
    started: Instant,
}

impl MemoryTrace {
    fn new() -> Self {
        let mut trace = Self {
            profile: Profile::new(),
            started: Instant::now(),
        };
        trace.mark("process-start");
        trace
    }

    fn mark(&mut self, stage: &str) {
        let elapsed = self.started.elapsed().as_millis() as u64;
        self.profile.record(stage, elapsed, process_counters());
    }

    fn allocator(&mut self, stage: &str, renderer: &Renderer) {
        if let Some(report) = renderer.allocator_report() {
            self.profile.record_allocator(stage, report);
        }
    }
}

/// Set when the event-loop closure (which owns the wgpu device) is dropped,
/// so the final memory sample can state whether GPU objects were released.
struct ReleaseFlag(Rc<Cell<bool>>);

impl Drop for ReleaseFlag {
    fn drop(&mut self) {
        self.0.set(true);
    }
}

fn append_log(path: &std::path::Path, line: &str) {
    if let Ok(mut file) = fs::OpenOptions::new().append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn rect_from(rect: RECT) -> Rect {
    Rect::new(
        rect.left,
        rect.top,
        rect.right.saturating_sub(rect.left),
        rect.bottom.saturating_sub(rect.top),
    )
}

/// (full monitor bounds, work area excluding taskbar) in physical pixels.
fn monitor_rects(monitor: HMONITOR) -> Option<(Rect, Rect)> {
    if monitor == 0 {
        return None;
    }
    // SAFETY: MONITORINFO is plain data; cbSize is set as the API requires.
    unsafe {
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return None;
        }
        Some((rect_from(info.rcMonitor), rect_from(info.rcWork)))
    }
}

fn shell_state() -> ShellState {
    let mut state = 0;
    // SAFETY: writes one enum value into our local.
    let result = unsafe { SHQueryUserNotificationState(&mut state) };
    if result < 0 {
        return ShellState::Normal;
    }
    match state {
        QUNS_RUNNING_D3D_FULL_SCREEN => ShellState::D3dFullscreen,
        QUNS_PRESENTATION_MODE => ShellState::PresentationMode,
        _ => ShellState::Normal,
    }
}

fn foreground_facts(ours: HWND) -> Option<Foreground> {
    // SAFETY: read-only queries on the current foreground HWND with local
    // out-buffers; a window closing concurrently just makes a call fail.
    unsafe {
        let front = GetForegroundWindow();
        if front == 0 || front == ours {
            return None;
        }
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(front, &mut rect) == 0 {
            return None;
        }
        let front_monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONULL);
        let (monitor, _) = monitor_rects(front_monitor)?;
        let our_monitor = MonitorFromWindow(ours, MONITOR_DEFAULTTONULL);
        let style = GetWindowLongPtrW(front, GWL_STYLE) as u32;
        let mut class = [0u16; 128];
        let length = GetClassNameW(front, class.as_mut_ptr(), class.len() as i32);
        let length = usize::try_from(length).unwrap_or(0).min(class.len());
        Some(Foreground {
            rect: rect_from(rect),
            monitor,
            same_monitor_as_overlay: front_monitor == our_monitor,
            has_caption: style & WS_CAPTION == WS_CAPTION,
            class_name: String::from_utf16_lossy(&class[..length]),
        })
    }
}

fn opt_in_per_monitor_dpi(log: &mut RunLog) {
    // SAFETY: process-wide DPI opt-in before any HWND exists. When the embedded
    // manifest already declared PerMonitorV2 this call is rejected (expected).
    unsafe {
        let set = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != 0;
        let effective = AreDpiAwarenessContextsEqual(
            GetThreadDpiAwarenessContext(),
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        ) != 0;
        log.line(format!(
            "DPI awareness: per-monitor-v2 effective={effective} (runtime opt-in accepted={set}, \
             manifest may already have set it)"
        ));
    }
}

fn choose_monitor(
    event_loop: &EventLoop<()>,
    index: Option<usize>,
) -> Result<MonitorHandle, Box<dyn Error>> {
    let monitors: Vec<_> = event_loop.available_monitors().collect();
    match index {
        Some(index) => monitors.get(index).cloned().ok_or_else(|| {
            format!(
                "monitor index {index} unavailable ({} found)",
                monitors.len()
            )
            .into()
        }),
        None => event_loop
            .primary_monitor()
            .or_else(|| monitors.first().cloned())
            .ok_or_else(|| "no monitor available".into()),
    }
}

#[derive(Default)]
struct FrameStats {
    frame_cpu_ms: Vec<f64>,
    presented: u64,
}

impl FrameStats {
    fn push(&mut self, elapsed: Duration) {
        self.presented += 1;
        if self.frame_cpu_ms.len() < 18_000 {
            self.frame_cpu_ms.push(elapsed.as_secs_f64() * 1000.0);
        }
    }

    fn summary(&self, renderer: &Renderer) -> serde_json::Value {
        let mut timings = self.frame_cpu_ms.clone();
        timings.sort_by(f64::total_cmp);
        let percentile = |p: f64| {
            if timings.is_empty() {
                return None;
            }
            let rank = ((timings.len() as f64 * p).ceil() as usize).clamp(1, timings.len());
            Some(timings[rank - 1])
        };
        serde_json::json!({
            "note": "CPU-side render+submit+present call durations ONLY; NOT GPU time, FPS or frame pacing",
            "backend": renderer.backend,
            "adapter": renderer.adapter,
            "device_type": renderer.device_type,
            "alpha_mode": format!("{:?}", renderer.config.alpha_mode),
            "format": format!("{:?}", renderer.config.format),
            "frames_presented": self.presented,
            "frame_cpu_p95_ms": percentile(0.95),
            "frame_cpu_max_ms": timings.last(),
        })
    }

    fn save(&self, store: &Store, renderer: &Renderer, log: &mut RunLog) {
        if self.presented == 0 || !store.writable {
            return;
        }
        write_json(store, RENDER_SAMPLE, &self.summary(renderer), log);
    }
}

fn write_json(store: &Store, name: &str, value: &serde_json::Value, log: &mut RunLog) {
    match serde_json::to_vec_pretty(value) {
        Ok(bytes) => {
            if let Err(error) = fs::write(store.data_path().join(name), bytes) {
                log.line(format!("Unable to save {name}: {error}"));
            }
        }
        Err(error) => log.line(format!("Unable to encode {name}: {error}")),
    }
}

fn save_state(store: &mut Store, state: &DemoState, log: &mut RunLog) {
    if let Err(error) = store.save(state) {
        log.line(format!("READ-ONLY settings (not persisted): {error}"));
    }
}

fn run(options: &Options, log: &mut RunLog) -> Result<i32, Box<dyn Error>> {
    let trace = Rc::new(RefCell::new(MemoryTrace::new()));
    // Load and validate portable state BEFORE any window exists: corrupt
    // settings fail closed (exit 1) and are never overwritten.
    let mut store = Store::beside_executable()?;
    let mut state = store.load().map_err(|error| {
        format!(
            "{} is unreadable or invalid ({error}); it was left untouched",
            store.settings_path().display()
        )
    })?;
    if let Err(error) = store.probe_writable() {
        log.line(format!(
            "READ-ONLY portable folder (no fallback location, no persistence): {error}"
        ));
    }
    log.attach(&store);
    log.line(format!(
        "PixelPals S4 {} starting; portable Data={} writable={}",
        env!("CARGO_PKG_VERSION"),
        store.data_path().display(),
        store.writable
    ));

    opt_in_per_monitor_dpi(log);
    let event_loop = EventLoop::new()?;
    trace.borrow_mut().mark("event-loop");
    let monitor = choose_monitor(&event_loop, options.monitor_index)?;
    let monitor_scale = geometry::sanitize_scale(monitor.scale_factor());
    let (monitor_bounds, work_area) = monitor_rects(monitor.hmonitor()).unwrap_or_else(|| {
        let position = monitor.position();
        let size = monitor.size();
        let bounds = Rect::new(
            position.x,
            position.y,
            size.width as i32,
            size.height as i32,
        );
        (bounds, bounds)
    });
    let width = geometry::scale_length(geometry::OVERLAY_LOGICAL_WIDTH, monitor_scale);
    let height = geometry::scale_length(geometry::OVERLAY_LOGICAL_HEIGHT, monitor_scale);
    let margin = (f64::from(geometry::OVERLAY_LOGICAL_MARGIN) * monitor_scale).round() as i32;
    let (x, y) = geometry::place_in_work_area(work_area, width as i32, height as i32, margin);
    log.line(format!(
        "monitor={:?} bounds={monitor_bounds:?} work={work_area:?} scale={monitor_scale} \
         overlay={width}x{height}@{x},{y}",
        monitor.name()
    ));

    // Created hidden: nothing is shown until the input region is applied and a
    // transparent frame has been presented.
    let window = Arc::new(
        WindowBuilder::new()
            .with_title("Pixel Pals S4 prototype")
            .with_visible(false)
            .with_decorations(false)
            .with_resizable(false)
            .with_transparent(true)
            .with_no_redirection_bitmap(true)
            .with_undecorated_shadow(false)
            .with_drag_and_drop(false)
            .with_window_level(WindowLevel::AlwaysOnTop)
            .with_inner_size(PhysicalSize::new(width, height))
            .with_position(PhysicalPosition::new(x, y))
            .build(&event_loop)?,
    );
    let handle = hwnd(&window)?;
    trace.borrow_mut().mark("window");
    // SAFETY: adjusts only our window; no global hooks/registry/machine services.
    unsafe {
        let existing = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(
            handle,
            GWL_EXSTYLE,
            existing | WS_EX_TOOLWINDOW as isize | WS_EX_NOACTIVATE as isize,
        );
    }
    let mut scale = geometry::sanitize_scale(window.scale_factor());
    if (scale - monitor_scale).abs() > f64::EPSILON {
        log.line(format!(
            "window scale {scale} differs from monitor scale {monitor_scale}; resizing"
        ));
        let _ = window.request_inner_size(PhysicalSize::new(
            geometry::scale_length(geometry::OVERLAY_LOGICAL_WIDTH, scale),
            geometry::scale_length(geometry::OVERLAY_LOGICAL_HEIGHT, scale),
        ));
    }
    // Input region is EMPTY from creation until a frame has been presented.
    apply_empty_region(handle)?;

    let choice = GpuChoice {
        preference: options.gpu_preference,
        memory_hints_performance: options.memory_hints_performance,
    };
    let mut mark = |stage: &str| trace.borrow_mut().mark(stage);
    let renderer = pollster::block_on(Renderer::new(window.clone(), choice, &mut mark));
    let mut renderer = match renderer {
        Ok(renderer) => renderer,
        Err(error) => {
            hide_on_failure(handle, log, &error.to_string());
            return Err(error);
        }
    };
    log.line(format!(
        "S4 active backend={} adapter={} type={} alpha={:?} format={:?}",
        renderer.backend,
        renderer.adapter,
        renderer.device_type,
        renderer.config.alpha_mode,
        renderer.config.format
    ));
    for adapter in &renderer.adapters_seen {
        log.line(format!("adapter candidate: {adapter}"));
    }
    log.line(format!(
        "adapter policy={:?} (explicit; see adapter_policy.rs) memory_hints={}",
        options.gpu_preference, renderer.memory_hints
    ));
    {
        let mut t = trace.borrow_mut();
        t.profile.set("backend", renderer.backend.clone());
        t.profile.set("adapter", renderer.adapter.clone());
        t.profile.set("device_type", renderer.device_type.clone());
        t.profile.set("memory_hints", renderer.memory_hints);
        t.profile
            .set("gpu_preference", format!("{:?}", options.gpu_preference));
        t.profile
            .set("adapters_seen", renderer.adapters_seen.clone());
        t.profile.set(
            "surface",
            format!("{}x{}", renderer.config.width, renderer.config.height),
        );
    }

    // F5: bounded first-frame handshake. Hidden + empty region until a frame
    // is presented; then the Pal region is installed and (unless a fullscreen
    // app is active) the window is shown without activation.
    let mut frame_stats = FrameStats::default();
    let want_visible = !fullscreen::should_hide(shell_state(), foreground_facts(handle).as_ref());
    let mut fault = options.fault_first_frame.clone();
    if let Some(plan) = &fault {
        log.line(format!(
            "QA fault injection active for first frame: {plan:?}"
        ));
    }
    let startup_result = startup::first_frame(
        &mut LivePort {
            renderer: &mut renderer,
            handle,
            state: &state,
            scale,
            stats: &mut frame_stats,
            fault: fault.as_mut(),
            started: Instant::now(),
        },
        RetryPolicy::STARTUP,
        want_visible,
    );
    let (startup_attempts, mut visible) = match startup_result {
        Startup::Ready { attempts, shown } => {
            log.line(format!(
                "first frame presented after {attempts} attempt(s); input region active; \
                 shown={shown}"
            ));
            let mut t = trace.borrow_mut();
            t.mark("first-frame");
            t.allocator("first-frame", &renderer);
            log.line(t.profile.summary_line());
            if let Some(gpu_init) = t.profile.delta_mib("window", "first-frame") {
                log.line(format!(
                    "MEM wgpu/driver initialisation (window -> first frame): {gpu_init:+.1} MiB private bytes"
                ));
                t.profile.set("gpu_init_private_mib", gpu_init);
            }
            (attempts, shown)
        }
        Startup::FailedClosed { attempts, reason } => {
            log.line(format!(
                "FIRST FRAME FAIL-CLOSED after {attempts} attempt(s): {reason}. \
                 Overlay was never shown and its input region stayed empty."
            ));
            if options.smoke_ms.is_some() && store.writable {
                let report = serde_json::json!({
                    "result": "FAIL_CLOSED_FIRST_FRAME",
                    "startup_attempts": attempts,
                    "reason": reason,
                    "frames_presented": frame_stats.presented,
                    "ever_shown": false,
                    "backend": renderer.backend,
                    "alpha_mode": format!("{:?}", renderer.config.alpha_mode),
                });
                write_json(&store, SMOKE_REPORT, &report, log);
            }
            return Ok(EXIT_FIRST_FRAME_FAILED);
        }
    };
    let mut input_active = true;
    let mut skips = SkipTracker::default();
    let qa_walk = options.qa_walk;
    if qa_walk {
        state.animate = true;
        log.line("QA walk loop enabled for this smoke run");
    }
    let memory_report = store
        .writable
        .then(|| store.data_path().join(MEMORY_REPORT));
    let run_log_path = store.writable.then(|| store.data_path().join(RUN_LOG));
    let released = Rc::new(Cell::new(false));
    let release_flag = ReleaseFlag(released.clone());
    let trace_in_loop = trace.clone();
    if !visible {
        log.line("fullscreen/presentation detected at launch: starting hidden");
    }

    let launched = Instant::now();
    let mut smoke_deadline = options
        .smoke_ms
        .map(|ms| launched + Duration::from_millis(ms));
    let smoke_click = options.smoke_click;
    let exit_code = Rc::new(Cell::new(EXIT_OK));
    let exit_code_in_loop = exit_code.clone();
    let mut pointer = PhysicalPosition::new(-1i32, -1i32);
    let mut next_fullscreen_check = Instant::now() + schedule::fullscreen_poll_interval(visible);
    let mut next_tick = Instant::now();
    let mut last_step = Instant::now();
    let mut log = std::mem::replace(log, RunLog::stderr_only());
    // winit may still dispatch events (including AboutToWait) after exit() is
    // requested; nothing may run twice once shutdown has started.
    let mut exiting = false;

    event_loop.run(move |event, target| {
        // Owned by this closure: dropped (with the wgpu device) when the
        // event loop ends, which the final memory sample reports.
        let _owned = &release_flag;
        if exiting {
            return;
        }
        let record_exit = |renderer: &Renderer| {
            let mut t = trace_in_loop.borrow_mut();
            t.mark("exit");
            t.allocator("exit", renderer);
        };
        // Fail closed: hide, empty the input region, record exit code, stop.
        let fatal = |log: &mut RunLog, message: &str| {
            hide_on_failure(handle, log, message);
            exit_code_in_loop.set(EXIT_FATAL);
            target.exit();
        };
        match event {
            Event::WindowEvent { window_id, event } if window_id == window.id() => match event {
                WindowEvent::CloseRequested => {
                    record_exit(&renderer);
                    save_state(&mut store, &state, &mut log);
                    frame_stats.save(&store, &renderer, &mut log);
                    exiting = true;
                    target.exit();
                }
                WindowEvent::CursorMoved { position, .. } => {
                    pointer = PhysicalPosition::new(position.x as i32, position.y as i32);
                }
                WindowEvent::MouseInput {
                    state: ElementState::Pressed,
                    button,
                    ..
                } => {
                    if !input_active
                        || !geometry::hits_pal(pointer.x, pointer.y, state.pal_x, state.pal_y, scale)
                    {
                        return;
                    }
                    if button == MouseButton::Right {
                        log.line("PAL_EXIT right-click");
                        record_exit(&renderer);
                        save_state(&mut store, &state, &mut log);
                        frame_stats.save(&store, &renderer, &mut log);
                        exiting = true;
                        target.exit();
                    } else if button == MouseButton::Left {
                        state.click();
                        last_step = Instant::now();
                        save_state(&mut store, &state, &mut log);
                        if let Err(error) = apply_pal_region(handle, &state, scale) {
                            exiting = true;
                            fatal(&mut log, &error.to_string());
                            return;
                        }
                        window.request_redraw();
                        log.line(format!("PAL_CLICK {}", state.pal_clicks));
                    }
                }
                WindowEvent::Resized(size) => {
                    renderer.resize(size);
                    if input_active {
                        if let Err(error) = apply_pal_region(handle, &state, scale) {
                            exiting = true;
                            fatal(&mut log, &error.to_string());
                            return;
                        }
                    }
                    window.request_redraw();
                }
                WindowEvent::ScaleFactorChanged {
                    scale_factor,
                    mut inner_size_writer,
                } => {
                    scale = geometry::sanitize_scale(scale_factor);
                    let size = PhysicalSize::new(
                        geometry::scale_length(geometry::OVERLAY_LOGICAL_WIDTH, scale),
                        geometry::scale_length(geometry::OVERLAY_LOGICAL_HEIGHT, scale),
                    );
                    let _ = inner_size_writer.request_inner_size(size);
                    log.line(format!("DPI change: scale={scale} size={size:?}"));
                    if input_active {
                        if let Err(error) = apply_pal_region(handle, &state, scale) {
                            exiting = true;
                            fatal(&mut log, &error.to_string());
                            return;
                        }
                    }
                    window.request_redraw();
                }
                WindowEvent::RedrawRequested if visible => {
                    let start = Instant::now();
                    let outcome = renderer.render(&state, scale);
                    if outcome == FrameOutcome::Presented {
                        frame_stats.push(start.elapsed());
                    }
                    match skips.record(&outcome) {
                        RedrawAction::Done => {}
                        RedrawAction::Retry { reconfigure } => {
                            if reconfigure {
                                renderer.reconfigure();
                            }
                            window.request_redraw();
                        }
                        RedrawAction::HideUntilPresented => {
                            // Never leave a window on screen that cannot be
                            // painted: hide it and empty its input region until
                            // a fresh frame is presented (see reveal()).
                            log.line(format!(
                                "presentation failing ({outcome:?}); overlay hidden until a frame presents"
                            ));
                            show(handle, false);
                            let _ = apply_empty_region(handle);
                            input_active = false;
                            visible = false;
                        }
                        RedrawAction::Fatal => {
                            exiting = true;
                            fatal(&mut log, &format!("render failed: {outcome:?}"));
                        }
                    }
                }
                _ => {}
            },
            Event::AboutToWait => {
                let now = Instant::now();
                if smoke_deadline.is_some_and(|deadline| now >= deadline) {
                    smoke_deadline = None;
                    record_exit(&renderer);
                    if smoke_click {
                        state.record_click();
                    }
                    save_state(&mut store, &state, &mut log);
                    frame_stats.save(&store, &renderer, &mut log);
                    let mut report = frame_stats.summary(&renderer);
                    report["result"] = if frame_stats.presented > 0 {
                        "PASS".into()
                    } else {
                        "FAIL_NO_FRAMES".into()
                    };
                    report["startup_attempts"] = startup_attempts.into();
                    report["visible_at_exit"] = visible.into();
                    report["input_active_at_exit"] = input_active.into();
                    report["scale"] = scale.into();
                    report["pal_clicks"] = state.pal_clicks.into();
                    report["data_writable"] = store.writable.into();
                    report["runtime_ms"] = (launched.elapsed().as_millis() as u64).into();
                    log.line(format!("SMOKE {report}"));
                    if store.writable {
                        write_json(&store, SMOKE_REPORT, &report, &mut log);
                    }
                    if frame_stats.presented == 0 {
                        exit_code_in_loop.set(EXIT_SMOKE_NO_FRAMES);
                    }
                    exiting = true;
                    target.exit();
                    return;
                }
                if now >= next_fullscreen_check {
                    let reason =
                        fullscreen::hide_reason(shell_state(), foreground_facts(handle).as_ref());
                    let want_visible = reason.is_none();
                    if want_visible && !visible {
                        // Re-show only after a fresh frame has been presented.
                        let result = startup::reveal(&mut LivePort {
                            renderer: &mut renderer,
                            handle,
                            state: &state,
                            scale,
                            stats: &mut frame_stats,
                            fault: None,
                            started: now,
                        });
                        match result {
                            Reveal::Shown => {
                                visible = true;
                                input_active = true;
                                last_step = now;
                                log.line("overlay shown (fresh frame presented)");
                            }
                            Reveal::StayHidden => {}
                            Reveal::Fatal(error) => {
                                exiting = true;
                                fatal(&mut log, &format!("reveal failed: {error}"));
                                return;
                            }
                        }
                    } else if !want_visible && visible {
                        show(handle, false);
                        visible = false;
                        // Explicit policy (not z-order): the overlay is a
                        // topmost window and would otherwise stay above a
                        // non-topmost fullscreen browser or game window.
                        log.line(format!("fullscreen policy: overlay hidden, reason={reason:?}"));
                    }
                    next_fullscreen_check = now + schedule::fullscreen_poll_interval(visible);
                }
                if schedule::animation_active(visible, state.animate) {
                    if now >= next_tick {
                        let elapsed = now.duration_since(last_step);
                        last_step = now;
                        next_tick = now + schedule::ANIMATION_TICK;
                        if state.step(elapsed.as_millis() as u64) {
                            if let Err(error) = apply_pal_region(handle, &state, scale) {
                                exiting = true;
                                fatal(&mut log, &error.to_string());
                                return;
                            }
                            window.request_redraw();
                        }
                        if !state.animate {
                            if qa_walk {
                                // QA soak: restart the deterministic walk.
                                state.click();
                            } else {
                                save_state(&mut store, &state, &mut log);
                            }
                        }
                    }
                } else {
                    // Idle suspension: no timers besides the fullscreen probe.
                    last_step = now;
                }
                let tick = schedule::animation_active(visible, state.animate).then_some(next_tick);
                let wake = schedule::next_wake(next_fullscreen_check, tick, smoke_deadline);
                target.set_control_flow(ControlFlow::WaitUntil(wake));
            }
            _ => {}
        }
    })?;
    // The closure (and with it the wgpu device, surface and window) has been
    // dropped by now; the final sample shows what the process retains.
    let mut t = trace.borrow_mut();
    t.mark("after-event-loop");
    t.profile
        .set("gpu_released_before_final_sample", released.get());
    let summary = t.profile.summary_line();
    if let Some(path) = &run_log_path {
        append_log(path, &summary);
    }
    if let Some(path) = &memory_report {
        match serde_json::to_vec_pretty(&t.profile) {
            Ok(bytes) => {
                if let Err(error) = fs::write(path, bytes) {
                    eprintln!("Unable to save {MEMORY_REPORT}: {error}");
                }
            }
            Err(error) => eprintln!("Unable to encode {MEMORY_REPORT}: {error}"),
        }
    }
    Ok(exit_code.get())
}
