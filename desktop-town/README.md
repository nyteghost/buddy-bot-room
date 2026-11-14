# Pixel Pals — Desktop Town (experimental)

**Phase 0 only.** This folder isolates platform feasibility spikes from the
production web application and its existing desktop wrapper.

- [S1 KDE Plasma / Wayland native layer-shell overlay](spikes/s1/README.md)
- Windows 11 is a separate **portable** target; it does not reuse GTK
  layer-shell as its windowing backend.
- Renderer-agnostic art/simulation interfaces, including a possible `wgpu`
  implementation, will be assessed separately. S1 establishes **only** native
  Linux surface, transparency, pointer-region and lifecycle feasibility.

No permissions, credentials, data stores, network connections, Unraid or
production integration are part of S1.
