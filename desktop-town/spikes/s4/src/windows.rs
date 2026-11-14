//! Windows-specific, purposely isolated experiment. Region management is Win32;
//! wgpu has no responsibility for window placement, DPI, click-through or z-order.
use crate::{geometry::{self, Rect}, portable::Store, state::DemoState};
use bytemuck::{Pod, Zeroable};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{error::Error, fs, sync::Arc, time::{Duration, Instant}};
use wgpu::util::DeviceExt;
use windows_sys::Win32::{
    Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, RGN_OR},
    UI::{
        HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
        WindowsAndMessaging::{
            GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW,
            SetWindowRgn, ShowWindow, GWL_EXSTYLE, SW_HIDE, SW_SHOWNOACTIVATE,
            WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    },
};
use winit::{
    dpi::{PhysicalPosition, PhysicalSize},
    event::{ElementState, Event, MouseButton, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::{Window, WindowBuilder, WindowLevel},
};

const WINDOW_WIDTH: u32 = 640;
const WINDOW_HEIGHT: u32 = 360;

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
}

impl Renderer {
    async fn new(window: Arc<Window>) -> Result<Self, Box<dyn Error>> {
        let mut errors = Vec::new();
        for backend in [wgpu::Backends::DX12, wgpu::Backends::VULKAN, wgpu::Backends::GL] {
            let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
                backends: backend,
                ..Default::default()
            });
            let surface = match instance.create_surface(window.clone()) {
                Ok(surface) => surface,
                Err(error) => { errors.push(format!("surface {backend:?}: {error}")); continue; }
            };
            let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            }).await;
            let Some(adapter) = adapter else {
                errors.push(format!("no adapter: {backend:?}"));
                continue;
            };
            let caps = surface.get_capabilities(&adapter);
            let alpha_mode = caps.alpha_modes.iter().copied().find(|mode| {
                *mode == wgpu::CompositeAlphaMode::PreMultiplied
            }).or_else(|| caps.alpha_modes.iter().copied().find(|mode| {
                *mode == wgpu::CompositeAlphaMode::PostMultiplied
            }));
            let Some(alpha_mode) = alpha_mode else {
                errors.push(format!("opaque-only surface: {backend:?}; refusing unsafe overlay"));
                continue;
            };
            let Some(format) = caps.formats.iter().copied().find(|f| f.is_srgb())
                .or_else(|| caps.formats.first().copied()) else {
                errors.push(format!("no surface format: {backend:?}"));
                continue;
            };
            let (device, queue) = match adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("Pixel Pals S4 wgpu device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            }, None).await {
                Ok(pair) => pair,
                Err(error) => { errors.push(format!("request device {backend:?}: {error}")); continue; }
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
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("S4 silhouette shader"),
                source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
            });
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("S4 silhouette pipeline"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: "vs_main",
                    buffers: &[wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4],
                    }],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: "fs_main",
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
            });
            let info = adapter.get_info();
            return Ok(Self {
                surface, device, queue, config, pipeline,
                backend: format!("{:?}", info.backend),
                adapter: info.name,
            });
        }
        Err(format!("No safe transparent GPU backend: {}", errors.join(" | ")).into())
    }

    fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 { return; }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
    }

    fn render(&mut self, state: &DemoState) -> Result<(), wgpu::SurfaceError> {
        let frame = self.surface.get_current_texture()?;
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let vertices = sprite_vertices(state.pal_x, state.pal_y, self.config.width, self.config.height);
        let buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("S4 pal geometry"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("S4 draw encoder"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("S4 alpha pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
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
        frame.present();
        Ok(())
    }
}

fn sprite_vertices(x: i32, y: i32, width: u32, height: u32) -> Vec<Vertex> {
    let mut output = Vec::with_capacity(8 * 6);
    let colors = [
        [0.64, 0.34, 0.86, 1.0], [0.64, 0.34, 0.86, 1.0],
        [0.76, 0.51, 0.96, 1.0], [0.42, 0.56, 0.92, 1.0],
        [0.24, 0.27, 0.50, 1.0], [0.24, 0.27, 0.50, 1.0],
    ];
    for (part, color) in geometry::pal_shapes(x, y).into_iter().zip(colors) {
        add_quad(&mut output, part, color, width, height);
    }
    for eye in [Rect::new(x + 26, y + 48, 7, 7), Rect::new(x + 47, y + 48, 7, 7)] {
        add_quad(&mut output, eye, [0.04, 0.04, 0.09, 1.0], width, height);
    }
    output
}

fn add_quad(output: &mut Vec<Vertex>, rect: Rect, color: [f32; 4], width: u32, height: u32) {
    let xy = |x: i32, y: i32| Vertex {
        position: [2.0 * x as f32 / width as f32 - 1.0, 1.0 - 2.0 * y as f32 / height as f32],
        color,
    };
    let l = rect.x;
    let t = rect.y;
    let r = l + rect.width;
    let b = t + rect.height;
    output.extend_from_slice(&[xy(l,t), xy(r,t), xy(l,b), xy(r,t), xy(r,b), xy(l,b)]);
}

fn hwnd(window: &Window) -> Result<isize, Box<dyn Error>> {
    let handle = window.window_handle()?.as_raw();
    match handle {
        RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get()),
        _ => Err("not a Win32 HWND".into()),
    }
}

fn apply_pal_region(window: &Window, state: &DemoState) -> Result<(), Box<dyn Error>> {
    let handle = hwnd(window)?;
    // SAFETY: Win32 GDI handles are created and used on the UI thread; ownership
    // of the root HRGN transfers to Windows ONLY when SetWindowRgn succeeds.
    unsafe {
        let root = CreateRectRgn(0,0,0,0);
        if root == 0 { return Err("CreateRectRgn(root) failed".into()); }
        for rect in geometry::pal_shapes(state.pal_x, state.pal_y) {
            let part = CreateRectRgn(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
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

fn hide_on_failure(window: &Window, message: &str) {
    eprintln!("FATAL OVERLAY SAFETY: {message}");
    if let Ok(handle) = hwnd(window) {
        // SAFETY: HWND belongs to this live window. Hiding fails closed.
        unsafe { ShowWindow(handle, SW_HIDE); }
    }
}

fn fullscreen_foreground_on_our_monitor(window: &Window) -> bool {
    let Ok(ours) = hwnd(window) else { return true; };
    let Some(monitor) = window.current_monitor() else { return true; };
    // SAFETY: Win32 query functions accept valid HWNDs and a writable RECT.
    unsafe {
        let front = GetForegroundWindow();
        if front == 0 || front == ours { return false; }
        let mut rect = std::mem::zeroed();
        if GetWindowRect(front, &mut rect) == 0 { return false; }
        let pos = monitor.position();
        let size = monitor.size();
        let right = pos.x.saturating_add(size.width as i32);
        let bottom = pos.y.saturating_add(size.height as i32);
        // Conservative 2px tolerance for window border/compositor differences.
        rect.left <= pos.x + 2 && rect.top <= pos.y + 2 &&
        rect.right >= right - 2 && rect.bottom >= bottom - 2
    }
}

#[derive(Default)]
struct FrameStats {
    frame_cpu_ms: Vec<f64>,
    start: Option<Instant>,
}

impl FrameStats {
    fn push(&mut self, elapsed: Duration) {
        self.start.get_or_insert_with(Instant::now);
        if self.frame_cpu_ms.len() < 18000 { self.frame_cpu_ms.push(elapsed.as_secs_f64() * 1000.0); }
    }

    fn save(&self, store: &Store, renderer: &Renderer) {
        if self.frame_cpu_ms.is_empty() || !store.writable { return; }
        let mut timings = self.frame_cpu_ms.clone();
        timings.sort_by(f64::total_cmp);
        let len = timings.len();
        let p95 = timings[((len as f64 * 0.95).ceil() as usize).saturating_sub(1).min(len-1)];
        let metrics = serde_json::json!({
            "note":"CPU-side render+submit+present timings ONLY, NOT GPU timing or FPS benchmark",
            "backend":renderer.backend, "adapter":renderer.adapter,
            "frames_sampled":len,
            "frame_cpu_p95_ms":p95,
            "frame_cpu_max_ms":timings[len-1],
        });
        if let Ok(bytes) = serde_json::to_vec_pretty(&metrics) {
            if let Err(error) = fs::write(store.data_path().join("s4-render-sample.json"), bytes) {
                eprintln!("Unable to save diagnostic sample: {error}");
            }
        }
    }
}

pub fn run() -> Result<(), Box<dyn Error>> {
    if std::env::args().any(|s| s == "--self-test") {
        crate::portable::run_self_test()?;
        println!("S4 portable settings round-trip: PASS");
        return Ok(());
    }
    let monitor_index = std::env::args().find_map(|s| s.strip_prefix("--monitor-index=")
        .and_then(|index| index.parse::<usize>().ok())).unwrap_or(0);
    // SAFETY: called before winit initializes HWNDs; failure is reported.
    unsafe {
        if SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) == 0 {
            eprintln!("WARNING: DPI v2 opt-in rejected; verify effective DPI awareness in QA");
        }
    }
    let event_loop = EventLoop::new()?;
    let monitors: Vec<_> = event_loop.available_monitors().collect();
    let monitor = monitors.get(monitor_index).ok_or("monitor index unavailable")?;
    let origin = monitor.position();
    let window = Arc::new(WindowBuilder::new()
        .with_title("Pixel Pals S4 — prototype")
        .with_decorations(false)
        .with_resizable(false)
        .with_transparent(true)
        .with_window_level(WindowLevel::AlwaysOnTop)
        .with_inner_size(PhysicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT))
        .with_position(PhysicalPosition::new(origin.x + 60, origin.y + 60))
        .build(&event_loop)?);
    let handle = hwnd(&window)?;
    // SAFETY: adjusts only our window; no global hooks/registry/machine services.
    unsafe {
        let existing = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(handle, GWL_EXSTYLE,
            existing | WS_EX_TOOLWINDOW as isize | WS_EX_NOACTIVATE as isize);
    }
    let mut store = Store::beside_executable()?;
    let mut state = store.load()?; // fail closed on corrupt file; do not overwrite
    // Test write capability before main loop, without rewriting existing settings.
    if let Err(error) = fs::create_dir_all(store.data_path())
        .and_then(|_| fs::OpenOptions::new().write(true).create_new(true)
            .open(store.data_path().join(".s4-write-check"))) {
        eprintln!("READ-ONLY portable folder (no fallback, no persistence): {error}");
        store.writable = false;
    } else {
        let _ = fs::remove_file(store.data_path().join(".s4-write-check"));
    }
    apply_pal_region(&window, &state)?;
    let mut renderer = match pollster::block_on(Renderer::new(window.clone())) {
        Ok(renderer) => renderer,
        Err(error) => { hide_on_failure(&window, &error.to_string()); return Err(error); }
    };
    eprintln!("S4 active backend={} adapter={} alpha={:?}, portable={:?}",
        renderer.backend, renderer.adapter, renderer.config.alpha_mode, store.data_path());
    let mut pointer = PhysicalPosition::new(-1i32, -1i32);
    let mut visible = true;
    let mut prev_tick = Instant::now();
    let mut prev_fullscreen_check = Instant::now() - Duration::from_secs(1);
    let mut frame_stats = FrameStats::default();
    window.request_redraw();
    event_loop.run(move |event, target| {
        match event {
            Event::WindowEvent { window_id, event } if window_id == window.id() => {
                match event {
                    WindowEvent::CloseRequested => {
                        if let Err(error) = store.save(&state) { eprintln!("READ-ONLY settings: {error}"); }
                        frame_stats.save(&store, &renderer);
                        target.exit();
                    }
                    WindowEvent::CursorMoved { position, .. } => {
                        pointer = PhysicalPosition::new(position.x as i32, position.y as i32);
                    }
                    WindowEvent::MouseInput { state: ElementState::Pressed, button, .. } => {
                        if geometry::hits_pal(pointer.x, pointer.y, state.pal_x, state.pal_y) {
                            if button == MouseButton::Right {
                                if let Err(error) = store.save(&state) { eprintln!("READ-ONLY settings: {error}"); }
                                frame_stats.save(&store, &renderer);
                                target.exit();
                            } else if button == MouseButton::Left {
                                state.pal_clicks += 1;
                                state.animate = !state.animate;
                                if state.animate && state.pal_x == 410 { state.pal_x = 100; }
                                if let Err(error) = store.save(&state) { eprintln!("READ-ONLY settings: {error}"); }
                                if let Err(error) = apply_pal_region(&window, &state) {
                                    hide_on_failure(&window, &error.to_string()); target.exit();
                                }
                                window.request_redraw();
                                eprintln!("PAL_CLICK {}", state.pal_clicks);
                            }
                        }
                    }
                    WindowEvent::Resized(size) => {
                        renderer.resize(size);
                        window.request_redraw();
                    }
                    WindowEvent::ScaleFactorChanged { .. } | WindowEvent::Moved(_) => {
                        renderer.resize(window.inner_size());
                        if let Err(error) = apply_pal_region(&window, &state) {
                            hide_on_failure(&window, &error.to_string()); target.exit();
                        }
                        window.request_redraw();
                    }
                    WindowEvent::RedrawRequested if visible => {
                        let start = Instant::now();
                        match renderer.render(&state) {
                            Ok(()) => frame_stats.push(start.elapsed()),
                            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                                renderer.resize(window.inner_size());
                            }
                            Err(error) => { hide_on_failure(&window, &error.to_string()); target.exit(); }
                        }
                    }
                    _ => {}
                }
            }
            Event::AboutToWait => {
                let now = Instant::now();
                if now.duration_since(prev_fullscreen_check) >= Duration::from_millis(250) {
                    prev_fullscreen_check = now;
                    let should_show = !fullscreen_foreground_on_our_monitor(&window);
                    if should_show != visible {
                        visible = should_show;
                        if let Ok(handle) = hwnd(&window) {
                            // SAFETY: only this HWND; SW_SHOWNOACTIVATE prevents focus stealing.
                            unsafe { ShowWindow(handle, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE }); }
                        }
                        if visible { window.request_redraw(); }
                    }
                }
                if visible && state.animate && now.duration_since(prev_tick) >= Duration::from_millis(33) {
                    let elapsed = now.duration_since(prev_tick);
                    prev_tick = now;
                    let did_move = state.step(elapsed.as_millis() as u64);
                    if did_move {
                        if let Err(error) = apply_pal_region(&window, &state) {
                            hide_on_failure(&window, &error.to_string()); target.exit();
                        }
                        window.request_redraw();
                    }
                    if !state.animate {
                        if let Err(error) = store.save(&state) { eprintln!("READ-ONLY settings: {error}"); }
                    }
                } else if !state.animate {
                    prev_tick = now;
                }
                target.set_control_flow(ControlFlow::WaitUntil(now + if visible && state.animate {
                    Duration::from_millis(33)
                } else {
                    Duration::from_millis(250)
                }));
            }
            _ => {}
        }
    })?;
    Ok(())
}
