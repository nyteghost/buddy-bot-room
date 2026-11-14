#!/usr/bin/env bash
# Avoid exporting private env/config or secrets into reports.
set -u
printf 'DATE: '; date -Is
printf 'SESSION_TYPE: %s\nDESKTOP: %s\nWAYLAND_DISPLAY_SET: %s\n' \
  "${XDG_SESSION_TYPE:-unset}" "${XDG_CURRENT_DESKTOP:-unset}" "${WAYLAND_DISPLAY:+yes}"
printf '\nKDE session/version:\n'; plasmashell --version 2>&1 || true
printf '\nKWin/version:\n'; kwin_wayland --version 2>&1 || true
printf '\nOutputs (includes fractional scale):\n'; kscreen-doctor -o 2>&1 || true
printf '\nNVIDIA information:\n'; nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>&1 || true
printf '\nRequired packages:\n'; pacman -Q gtk4 gtk4-layer-shell rust pkgconf 2>&1 || true
printf '\nLayer-shell Wayland global:\n'; \
  if command -v wayland-info >/dev/null 2>&1; then
    wayland-info 2>/dev/null | grep -m 3 'zwlr_layer_shell_v1' || true
  else echo 'wayland-info not installed'; fi
