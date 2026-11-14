# Pixel Pals — S4 Windows 11 Portable wgpu/Win32 Spike

Status: **compiles and passes automated checks on a GitHub-hosted Windows CI runner; NOT HARDWARE-ACCEPTED.**
Isolated spike under `desktop-town/spikes/s4/` (plus one isolated CI workflow, see below). No production
dependency, no Unraid connection, no installer, no network use.

## What this prototype is

A transparent, always-on-top, non-activating Win32 window (640x360 logical pixels, scaled per monitor DPI)
draws one small Pal silhouette with native wgpu. Left-click the Pal to start/stop walking; right-click the
Pal to save and exit. Everything outside the silhouette is removed from the window with `SetWindowRgn`, so
clicks there go to the application underneath. There is no WebView2 dependency.

* **Rendering:** wgpu 27, Direct3D 12 first. D3D12 presents through a DirectComposition visual
  (`Dx12SwapchainKind::DxgiFromVisual`) because an HWND flip-model swapchain only supports opaque alpha.
  Vulkan and GL are tried next; any backend that only offers an opaque swapchain is refused and the app
  exits instead of showing a black rectangle. Shaders compile with FXC (`d3dcompiler_47.dll`, part of
  Windows), so no `dxcompiler.dll`/`dxil.dll` is shipped.
* **Input:** the window region is the union of the silhouette rectangles, computed by the same function that
  produces the GPU quads (`geometry::pal_shapes`), so the drawn and clickable shapes cannot drift apart.
  Region clipping is also visual clipping: nothing outside the silhouette is drawn.
* **DPI:** PerMonitorV2 (embedded manifest and runtime opt-in). Geometry is stored in logical pixels and
  converted with the window's scale factor; `WM_DPICHANGED` resizes the window and rebuilds the region.
  The overlay is placed inside the chosen monitor's work area (negative virtual coordinates supported).
* **Fullscreen safety (explicit policy, not z-order):** the overlay is a *topmost* window, so ordinary
  stacking would keep it above a non-topmost fullscreen browser or game. It disappears because
  `fullscreen::hide_reason` asks it to. Every 500 ms (1 s while hidden) it hides when Windows reports an
  exclusive Direct3D app (`ExclusiveD3d`) or presentation mode (`PresentationMode`), or when a
  caption-less foreground window covers the overlay's monitor (`CoversMonitor { class_name }`, e.g.
  `Chrome_WidgetWin_1` for fullscreen YouTube). The reason is logged as
  `fullscreen policy: overlay hidden, reason=…`. The desktop wallpaper (`Progman`/`WorkerW`) and maximised
  captioned windows do not count. Only browser video has been owner-observed; games are not yet validated.
* **GPU adapter policy (explicit):** all adapters are enumerated and logged (`adapter candidate: …`).
  Only those with a supported surface **and** a transparent alpha mode are eligible.
  - Default `--gpu-preference=low-power`: integrated > discrete > virtual > other > software.
  - `--gpu-preference=high-performance`: discrete first.
  - The default keeps the discrete GPU free for games and avoids waking it on hybrid laptops. The owner's
    machine therefore selected "Intel(R) Graphics (IntegratedGpu)".
  - Whether integrated rendering costs extra when the monitor is wired to a discrete GPU (cross-adapter
    copy by DWM) must be measured. See QA-WINDOWS.md §9.
* **Memory:** wgpu `MemoryHints::MemoryUsage` (8/4 MiB D3D12 suballocation blocks instead of 256/64 MiB).
  Every run writes `Data/s4-memory.json` with a per-stage breakdown. See PERFORMANCE.md §1.
* **Idle:** rendering is event-driven. With the Pal idle, no frames are drawn and the only timer is the
  fullscreen probe; while walking, a 33 ms tick drives movement. Hidden overlays stop animating.
* **Launch safety (QA finding F5):** the window is created hidden **with an empty window region**, so it can
  neither be seen nor hit-tested. `src/startup.rs` then runs a bounded first-frame handshake: up to 8
  present attempts within 3 s, exponential backoff 16→250 ms, reconfiguring the surface after Lost/Outdated
  and retrying after Timeout. Only after a frame is successfully presented is the Pal region installed and
  the window shown with `SW_SHOWNOACTIVATE`. If no frame can be presented (or a fatal surface error or
  region failure occurs) the app exits with code 4 and the overlay was never visible or clickable.
  At runtime, 5 consecutive failed presents hide the overlay and empty its region; it is re-shown only
  after a fresh frame is presented. On every graceful exit (right-click, close, smoke end) the overlay is hidden and
  its region emptied before GPU objects and the window are released. It never takes focus and has no taskbar button.

## Portable layout

```
PixelPals-Portable/
  PixelPals.exe        GUI-subsystem exe, static CRT, embedded asInvoker manifest
  BUILD-INFO.txt       source commit, compiler, target, exe SHA-256
  README.txt  QA-WINDOWS.md  PERFORMANCE.md
  Data/                all persistent state, created/used beside the exe
    settings.json        version, Pal position, click count, walking flag (no secrets)
    s4-last-run.log      diagnostics from the most recent run
    s4-render-sample.json  CPU-side render call timings (not GPU/FPS)
    s4-memory.json       per-stage process memory + wgpu suballocator report
  QA/
    test-portable.ps1    automated portable checks (read-only apart from Data/)
    profile-memory.ps1   read-only CPU/memory/GPU-memory sampler (PERFORMANCE.md)
```

* No installer, administrator rights, registry keys, services, AppData fallback or network.
* Settings are written to a temporary file in `Data/` and renamed over `settings.json`.
* Corrupt or unknown settings → the app exits with code 1 and leaves the file untouched.
* Unwritable `Data/` (read-only media, ACL) → the app runs without persistence and logs a warning; it never
  writes anywhere else.
* Update = replace **only** `PixelPals.exe`; keep `Data/`.

Future sign-in must use Windows DPAPI or Credential Manager with re-authentication when moved between PCs;
never plaintext secrets in `Data/`. The spike implements no credentials.

## Command line and exit codes

```
PixelPals.exe [--monitor-index=N] [--self-test] [--smoke-test-ms=N [--smoke-click]]
              [--qa-fault-first-frame=timeout|lost|outdated|fatal[:COUNT|:never]]
              [--gpu-preference=low-power|high-performance] [--qa-memory-hints=memory|performance] [--qa-walk]
```

| Flag | Purpose |
| --- | --- |
| `--monitor-index=N` | zero-based monitor; default is the primary monitor |
| `--self-test` | headless Data/ round-trip in an isolated sub-folder; no window |
| `--smoke-test-ms=N` | automation: run the real overlay for N ms, save, write `Data/s4-smoke.json`, exit |
| `--smoke-click` | automation: count one synthetic Pal click before the smoke exit (not OS mouse evidence) |
| `--gpu-preference=…` | adapter ordering; default `low-power` (integrated first) |
| `--qa-memory-hints=…` | QA A/B: `performance` restores wgpu's 256/64 MiB suballocation blocks |
| `--qa-walk` | QA soak (smoke runs only): start walking and restart at the boundary |
| `--qa-fault-first-frame=…` | QA only: the first COUNT (or all, `never`) first-frame presents report the given failure, to exercise the fail-closed handshake on a real desktop |

Exit codes: 0 success, 1 fail-closed (no safe transparent GPU path, corrupt settings, Win32 failure),
2 usage error, 3 smoke run presented no frames, 4 first frame never presented (overlay never shown).

## Reproducible Windows build

Builder requirements (not needed by users of the ZIP): Windows 10/11 x64, Visual Studio 2022 Build Tools
with the "Desktop development with C++" workload (MSVC linker + Windows SDK), rustup, git, PowerShell 7.
The compiler is pinned by `rust-toolchain.toml` (1.97.0) and every dependency by `Cargo.lock`.

```powershell
git clone https://github.com/nyteghost/buddy-bot-room
cd buddy-bot-room
git checkout <exact commit SHA under test>
cd desktop-town/spikes/s4
rustup toolchain install            # installs the pinned toolchain from rust-toolchain.toml
cargo fmt --all -- --check
cargo check  --locked --target x86_64-pc-windows-msvc
cargo clippy --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings
cargo test   --locked --target x86_64-pc-windows-msvc
cargo build  --locked --release --target x86_64-pc-windows-msvc
./scripts/pack-portable.ps1 -Commit (git rev-parse HEAD)
# Extract and run the automated portable checks on the build/QA machine:
Expand-Archive dist/PixelPals-Portable.zip -DestinationPath $env:TEMP\pp-test
./scripts/test-portable.ps1 -ExtractedFolder $env:TEMP\pp-test\PixelPals-Portable
```

`.cargo/config.toml` links the C runtime statically (`+crt-static`), and `build.rs` embeds
`windows/PixelPals.exe.manifest` through the MSVC linker. Pure logic tests also run on Linux with
`cargo test --locked`.

## Continuous integration

`.github/workflows/desktop-town-s4-windows.yml` (read-only token, no secrets, path-filtered to this spike)
runs on every pull-request update:

* Linux: `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test`.
* `windows-2025`: fmt, check, clippy, test for `x86_64-pc-windows-msvc`, release build, `pack-portable.ps1`,
  extraction to a fresh folder and `test-portable.ps1` (including F5 fault injection observed from a second
  process via `IsWindowVisible`/`GetWindowRgnBox`); uploads `PixelPals-Portable-<sha>` (ZIP + SHA-256)
  and `s4-windows-ci-evidence-<sha>` artifacts.

The hosted runner has no physical GPU (Direct3D 12 runs on the WARP software adapter), runs as an
administrator, uses 100% scaling on one virtual display and has no human input. CI results are **build and
smoke evidence only**; they are not overlay, click-through, DPI, fullscreen, focus or performance acceptance.
See `QA-WINDOWS.md`.

No merge, deployment, installation on managed hardware, background services, credentials or Unraid changes.
