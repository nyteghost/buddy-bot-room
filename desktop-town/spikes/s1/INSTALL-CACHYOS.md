# S1 — CachyOS / Arch development install (disposable prototype)

> **Research spike, not a release.** Installing this on the owner's PC needs
> the owner's own go-ahead (PP-DT-001: no installation without separate
> authorization). Nothing here starts at login, adds services, touches
> Pixel Pals data, Unraid or the network at runtime.

Two supported paths. **A** (pacman package) is preferred because `pacman -R`
removes every installed file. **B** (cargo in the checkout) installs nothing.

## 0. Prerequisites (both paths)

```bash
sudo pacman -S --needed base-devel git rust pkgconf gtk4 gtk4-layer-shell
# optional QA helpers
sudo pacman -S --needed python tk wayland-utils spectacle
```

`gtk4-layer-shell` is in Arch `extra` (CachyOS inherits it). Do not
substitute an AUR or hand-built copy without recording its version.
Rust ≥ 1.92 is required (Arch `rust` is newer).

Check out the **exact** commit you were asked to test:

```bash
git clone https://github.com/nyteghost/buddy-bot-room.git ~/src/buddy-bot-room
cd ~/src/buddy-bot-room
git fetch origin spike/desktop-town-kwin-overlay-20261114
git checkout --detach <EXACT_SHA_FROM_PR_46>
git rev-parse HEAD          # record this in the QA report
```

## A. pacman package built from the checkout (preferred)

```bash
cd desktop-town/spikes/s1/packaging/arch
makepkg -si                  # fetches crates per committed Cargo.lock, runs cargo test
pacman -Qi pixel-pals-s1-overlay-dev | grep -E 'Version|Install Date'
```

Installed files (verify with `pacman -Ql pixel-pals-s1-overlay-dev`):

| Path | Purpose |
| --- | --- |
| `/usr/bin/pixel-pals-s1-kwin-overlay` | the overlay binary |
| `/usr/share/pixel-pals-s1/qa/` | environment, lifecycle and underlay QA scripts + checklist |
| `/usr/share/doc/pixel-pals-s1-overlay-dev/` | README and this file |

Removal: `sudo pacman -Rns pixel-pals-s1-overlay-dev` (evidence you wrote to
`~/pixel-pals-s1-evidence` is yours to keep or delete).

The version string encodes the commit: `0.1.0.r<N>.g<12-char SHA>`.
`makepkg` rewrites the `pkgver=` line of the PKGBUILD in your checkout to
that value; `git checkout -- PKGBUILD` restores it.

## B. Run from the checkout without installing

```bash
cd desktop-town/spikes/s1
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo run --locked -- --help
```

`--locked` fails if `Cargo.lock` would change; that is intentional.

## First launch (either path) — safety first

1. Open **two** terminals. In terminal 2 keep this ready:
   `pkill -TERM -f pixel-pals-s1-kwin-overlay` (clean exit, logs `S1_SIGNAL_EXIT`).
   If the desktop stops responding: Ctrl+Alt+F3, log in, run the same command.
2. Short, safe first run (60 s self-close):

   ```bash
   pixel-pals-s1-kwin-overlay --seconds 60 --speed 0 --trace-region
   # or: cargo run --locked -- --seconds 60 --speed 0 --trace-region
   ```

3. Expected stdout: `S1_OUTPUT …` per monitor, then `S1_READY`,
   `S1_ALLOCATED … surface_scale=…`, `S1_REGION … bbox=…`. If you see
   `S1_SAFE_FALLBACK` the overlay did **not** start (town-only window
   instead) — record the reason; roaming gates cannot pass.
4. Click a desktop icon / window away from the blue Pal: it must respond
   normally. Click the Pal: terminal prints `S1_PAL_CLICK`.
   **Any `S1_SPURIOUS_CLICK` line = click-through failure → stop.**

Useful flags: `--monitor DP-1` (connector from `S1_OUTPUT` lines),
`--all-monitors`, `--layer bottom`, `--town-only`, `--require-overlay`.

Then continue with [`qa/DEVICE-QA-CHECKLIST.md`](qa/DEVICE-QA-CHECKLIST.md). The helper
`qa/owner_kde_gates.sh` (installed under `/usr/share/pixel-pals-s1/qa/`) runs
the automatable parts (`env`, `smoke`, `lifecycle`, `failclosed`) and logs
interactive runs (`run …`) to `~/pixel-pals-s1-evidence/<date>/`.
