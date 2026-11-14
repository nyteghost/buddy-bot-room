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
    cli::{self, Options},
    fullscreen::{self, Foreground, ShellState},
    geometry::{self, Rect},
    portable::{self, Store},
    state::DemoState,
};
use bytemuck::{Pod, Zeroable};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{
    cell::Cell,
    error::Error,
    fmt::Display,
    fs,
    io::Write as _,
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, GetMonitorInfoW, MonitorFromWindow, SetWindowRgn,
        HMONITOR, MONITORINFO, MONITOR_DEFAULTTONULL, RGN_OR,
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

const ANIMATION_TICK: Duration = Duration::from_millis(33);
const FULLSCREEN_POLL_VISIBLE: Duration = Duration::from_millis(500);
const FULLSCREEN_POLL_HIDDEN: Duration = Duration::from_millis(1000);

const RUN_LOG: &str = "s4-last-run.log";
const SMOKE_REPORT: &str = "s4-smoke.json";
const RENDER_SAMPLE: &str = "s4-render-sample.json";

/// Entry point used by `main`. Never panics on expected failures; returns a
/// documented exit code (0 ok, 1 fatal/fail-closed, 2 usage, 3 smoke without
/// any presented frame).
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

struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    backend: String,
    adapter: String,
    device_type: String,
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
                presentation_system: wgpu::Dx12SwapchainKind::DxgiFromVisual,
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    })
}

impl Renderer {
    async fn new(window: Arc<Window>) -> Result<Self, Box<dyn Error>> {
        let mut errors = Vec::new();
        for backend in [
            wgpu::Backends::DX12,
            wgpu::Backends::VULKAN,
            wgpu::Backends::GL,
        ] {
            let instance = instance_for(backend);
            let surface = match instance.create_surface(window.clone()) {
                Ok(surface) => surface,
                Err(error) => {
                    errors.push(format!("surface {backend:?}: {error}"));
                    continue;
                }
            };
            let adapter = match instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::LowPower,
                    compatible_surface: Some(&surface),
                    force_fallback_adapter: false,
                })
                .await
            {
                Ok(adapter) => adapter,
                Err(error) => {
                    errors.push(format!("adapter {backend:?}: {error}"));
                    continue;
                }
            };
            let caps = surface.get_capabilities(&adapter);
            let Some(alpha_mode) = [
                wgpu::CompositeAlphaMode::PreMultiplied,
                wgpu::CompositeAlphaMode::PostMultiplied,
            ]
            .into_iter()
            .find(|mode| caps.alpha_modes.contains(mode)) else {
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
            let (device, queue) = match adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("Pixel Pals S4 wgpu device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
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
            let pipeline = create_pipeline(&device, format, alpha_mode);
            let info = adapter.get_info();
            return Ok(Self {
                surface,
                device,
                queue,
                config,
                pipeline,
                backend: format!("{:?}", info.backend),
                adapter: info.name,
                device_type: format!("{:?}", info.device_type),
            });
        }
        Err(format!("No safe transparent GPU backend: {}", errors.join(" | ")).into())
    }

    fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
    }

    /// Returns `Ok(true)` when a frame was presented, `Ok(false)` when the
    /// frame was skipped (timeout / reconfigure) and should be retried.
    fn render(&mut self, state: &DemoState, scale: f64) -> Result<bool, wgpu::SurfaceError> {
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(false),
            Err(error) => return Err(error),
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let vertices = sprite_vertices(state, scale, self.config.width, self.config.height);
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("S4 pal geometry"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
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
            pass.set_vertex_buffer(0, buffer.slice(..));
            pass.draw(0..vertices.len() as u32, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        let suboptimal = frame.suboptimal;
        frame.present();
        if suboptimal {
            self.surface.configure(&self.device, &self.config);
        }
        Ok(true)
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

fn show(handle: HWND, visible: bool) {
    // SAFETY: only our own live HWND; SW_SHOWNOACTIVATE never steals focus.
    unsafe {
        ShowWindow(handle, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }
}

fn hide_on_failure(handle: HWND, log: &mut RunLog, message: &str) {
    log.line(format!("FATAL OVERLAY SAFETY: {message}"));
    show(handle, false);
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
    apply_pal_region(handle, &state, scale)?;

    let mut renderer = match pollster::block_on(Renderer::new(window.clone())) {
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

    let mut frame_stats = FrameStats::default();
    // First transparent frame is presented while hidden, then shown without
    // activation. A failed first frame means the window is never shown.
    let start = Instant::now();
    match renderer.render(&state, scale) {
        Ok(true) => frame_stats.push(start.elapsed()),
        Ok(false) => log.line("first frame skipped; will retry on redraw"),
        Err(error) => {
            hide_on_failure(handle, log, &format!("first frame failed: {error}"));
            return Err(error.to_string().into());
        }
    }

    let launched = Instant::now();
    let smoke_deadline = options
        .smoke_ms
        .map(|ms| launched + Duration::from_millis(ms));
    let smoke_click = options.smoke_click;
    let exit_code = Rc::new(Cell::new(EXIT_OK));
    let exit_code_in_loop = exit_code.clone();
    let mut pointer = PhysicalPosition::new(-1i32, -1i32);
    let mut visible = !fullscreen::should_hide(shell_state(), foreground_facts(handle).as_ref());
    show(handle, visible);
    if visible {
        window.request_redraw();
    } else {
        log.line("fullscreen/presentation detected at launch: starting hidden");
    }
    let mut next_fullscreen_check = Instant::now() + FULLSCREEN_POLL_VISIBLE;
    let mut next_tick = Instant::now();
    let mut last_step = Instant::now();
    let mut log = std::mem::replace(log, RunLog::stderr_only());

    event_loop.run(move |event, target| match event {
        Event::WindowEvent { window_id, event } if window_id == window.id() => match event {
            WindowEvent::CloseRequested => {
                save_state(&mut store, &state, &mut log);
                frame_stats.save(&store, &renderer, &mut log);
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
                if !geometry::hits_pal(pointer.x, pointer.y, state.pal_x, state.pal_y, scale) {
                    return;
                }
                if button == MouseButton::Right {
                    log.line("PAL_EXIT right-click");
                    save_state(&mut store, &state, &mut log);
                    frame_stats.save(&store, &renderer, &mut log);
                    target.exit();
                } else if button == MouseButton::Left {
                    state.click();
                    last_step = Instant::now();
                    save_state(&mut store, &state, &mut log);
                    if let Err(error) = apply_pal_region(handle, &state, scale) {
                        hide_on_failure(handle, &mut log, &error.to_string());
                        exit_code_in_loop.set(EXIT_FATAL);
                        target.exit();
                    }
                    window.request_redraw();
                    log.line(format!("PAL_CLICK {}", state.pal_clicks));
                }
            }
            WindowEvent::Resized(size) => {
                renderer.resize(size);
                if let Err(error) = apply_pal_region(handle, &state, scale) {
                    hide_on_failure(handle, &mut log, &error.to_string());
                    exit_code_in_loop.set(EXIT_FATAL);
                    target.exit();
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
                if let Err(error) = apply_pal_region(handle, &state, scale) {
                    hide_on_failure(handle, &mut log, &error.to_string());
                    exit_code_in_loop.set(EXIT_FATAL);
                    target.exit();
                }
                window.request_redraw();
            }
            WindowEvent::RedrawRequested if visible => {
                let start = Instant::now();
                match renderer.render(&state, scale) {
                    Ok(true) => frame_stats.push(start.elapsed()),
                    Ok(false) => window.request_redraw(),
                    Err(error) => {
                        hide_on_failure(handle, &mut log, &error.to_string());
                        exit_code_in_loop.set(EXIT_FATAL);
                        target.exit();
                    }
                }
            }
            _ => {}
        },
        Event::AboutToWait => {
            let now = Instant::now();
            if smoke_deadline.is_some_and(|deadline| now >= deadline) {
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
                report["visible_at_exit"] = visible.into();
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
                target.exit();
                return;
            }
            if now >= next_fullscreen_check {
                let hide =
                    fullscreen::should_hide(shell_state(), foreground_facts(handle).as_ref());
                if hide == visible {
                    visible = !hide;
                    log.line(format!(
                        "fullscreen policy: overlay {}",
                        if visible { "shown" } else { "hidden" }
                    ));
                    show(handle, visible);
                    if visible {
                        last_step = now;
                        window.request_redraw();
                    }
                }
                next_fullscreen_check = now
                    + if visible {
                        FULLSCREEN_POLL_VISIBLE
                    } else {
                        FULLSCREEN_POLL_HIDDEN
                    };
            }
            if visible && state.animate {
                if now >= next_tick {
                    let elapsed = now.duration_since(last_step);
                    last_step = now;
                    next_tick = now + ANIMATION_TICK;
                    if state.step(elapsed.as_millis() as u64) {
                        if let Err(error) = apply_pal_region(handle, &state, scale) {
                            hide_on_failure(handle, &mut log, &error.to_string());
                            exit_code_in_loop.set(EXIT_FATAL);
                            target.exit();
                            return;
                        }
                        window.request_redraw();
                    }
                    if !state.animate {
                        save_state(&mut store, &state, &mut log);
                    }
                }
            } else {
                // Idle suspension: no timers besides the fullscreen probe.
                last_step = now;
            }
            let mut wake = next_fullscreen_check;
            if visible && state.animate {
                wake = wake.min(next_tick);
            }
            if let Some(deadline) = smoke_deadline {
                wake = wake.min(deadline);
            }
            target.set_control_flow(ControlFlow::WaitUntil(wake));
        }
        _ => {}
    })?;
    Ok(exit_code.get())
}
