# ShowPilot — Cobb Convention Center-Atlanta

Professional venue operations suite extracted from the existing Pixel Pals Work Tools implementation.

## Modules
- Event schedule: import Ungerboeck PDF/XLSX, review unfamiliar rooms, generate staffing and export Excel (convention center only; excludes CEPAC).
- My Shifts: read schedules, edit shifts, export .ics. Direct Google Calendar sync is planned but **not yet available**.
- Stage & Deck Planner: stage configurations and material calculations.
- Floor Maps: work-order PDF + floor plan utility placement.
- Vendors: offline quotes and local comparison. Automatic vendor web scraping and email integration are **not included yet**.
- Dashboard data backup: export/restore work-only local data.

**Repository Monitor is intentionally excluded.**

## Branches and source
Currently under active development in the isolated Pixel Pals `feat/showpilot-standalone` branch. The source tree of this branch is an independent, reduced project intended for transfer to `nyteghost/showpilot` when GitHub repository creation is available.

## Development
Requirements on a development machine: Bun or Node.js.
```bash
bun install
bun run check
bun test
bun run build
```
Tests include existing work-tools Excel/scheduling, floor-map and stage planning checks plus venue filter and backups.

## Portable Windows app
When the `ShowPilot standalone checks` workflow passes, download the **showpilot-windows-portable** GitHub Actions artifact, extract the ZIP, and open `ShowPilot.exe` from the extracted directory. This is a **portable folder** build: do not separate the EXE from its adjacent files. No developer Node.js installation required at work. Unsigned apps can be blocked by corporate IT.

The Windows build uses Electron with isolated renderer (Node integration disabled, context isolation and sandbox enabled). It operates without an internet connection for imported reports, schedules, .ics files, stage and floor-map tools.

## Offline data & privacy
Report imports are processed locally. Use the dashboard's **Export work data** button to back up work plans/preferences; **Restore from backup** imports your saved data to another ShowPilot installation. Local data lives per app/browser profile and isn't automatically transferred from Pixel Pals.

## Safety
Never copy secrets, `.env` files, or unrelated Pixel Pals modules into this project. Scheduling rules should be reviewed with the venue manager before altering staffing demand or employee constraints.
