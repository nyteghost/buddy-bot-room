# Pixel Pals — S4 Windows 11 Portable wgpu/Win32 Feasibility Spike

Status: **research prototype / NOT COMPILED OR HARDWARE-ACCEPTED**. Branch based on immutable beta 099f0698bddc494a5cdfd819f0d32944a766e341. Only files within desktop-town/spikes/s4/. No production dependency or Unraid connection.

## Build on an authorized Windows 11 development machine

Required for the *builder*, not the app user: Rust MSVC target and Windows C++ Build Tools. Working directory: desktop-town/spikes/s4/.

    cargo fmt --all -- --check
    cargo check --target x86_64-pc-windows-msvc
    cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings
    cargo test --target x86_64-pc-windows-msvc
    cargo build --release --target x86_64-pc-windows-msvc
    ./scripts/pack-portable.ps1

Output when compilation/packing succeeds: dist/PixelPals-Portable.zip. The ZIP must be independently verified on an approved clean Windows 11 system, offline, without elevation and without any VC runtime or other installer. Do not represent source code as a built ZIP.

## Prototype

A transparent 640x360 Win32 window renders a small moving 2.5D-style Pal silhouette with native wgpu. Left-click Pal to start/stop walking; right-click Pal to save and exit. Empty overlay area is excluded with SetWindowRgn, not just rendered transparent. Use --monitor-index=1 for the second monitor (zero-based) or --self-test for the headless settings round-trip. Native wgpu uses D3D12 first; Vulkan and GL are attempted when a safe non-opaque surface is available. Rendering stops rather than using an opaque swapchain. Selected backend/adapter are printed to stderr. There is no webview and no WebView2 requirement for this native experiment.

Region clipping is also **visual clipping**: effects beyond the region are not drawn. Final roaming characters may require a separate non-interactive rendering window or more sophisticated hit-testing. wgpu does not manage desktops, transparency policies, display scaling or focus. The shared world simulation, app connections, AI and voice remain external contracts, not part of S4.

## Portable state and security

Data/settings.json lives beside PixelPals.exe. Only a version, a Pal location, its click count and motion state are serialized. Nothing in S4 accepts or stores passwords, API keys, auth tokens, credentials or networking endpoints. Settings writes use a same-directory temporary file followed by rename; corrupted settings fail closed rather than being reset. On non-writable media, state must remain read-only with a visible stderr warning: no installer, admin, registry, service, hidden fallback to AppData or Unraid. Remove/replace only the executable for an update, keeping Data/ intact. USB/removable execution requires an independently authorized validation run.

Future sign-in must use Windows DPAPI or Credential Manager, with reauthentication when moved between PCs; never store secrets in plaintext portable Data/. The native S4 spike does not implement credential handling.

A later Tauri/webview application must separately investigate WebView2 runtime presence and offline bundling. The native S4 experiment **does not** prove Tauri or WebView2 portability. Windows OS graphics stack, GPU drivers, signing/SmartScreen/AppLocker/WDAC policies and DX12 shader compiler availability are outstanding release gates. Do not bypass employer IT policies.

## Verification evidence

Unit tests cover pure silhouette geometry, validation and basic persistence. The 100/100 and 30/30 unit samples are not OS click tests. This environment has neither cargo/rustc nor Windows hardware. No cargo fmt, check, clippy, cargo test, compiled artifact, GPU benchmark, real transparency, 20-cycle stability or 100/100 OS click evidence is claimed. See QA-WINDOWS.md and PERFORMANCE.md for required independent tests.

No merge, deployment, installation to managed hardware, background services, production credentials or Unraid changes.
