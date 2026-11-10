# Pixel Pals — Step 1b isolated preview, stages 1–3

**Status:** Draft, stacked on Step 1a PR #40. Stage 4 is not included or authorized.
The isometric Office is **not imported or mounted** in room.tsx. No Room Settings,
CSS, Character Universe importer, Pal identity/permission, service, Unraid, or
active flat-HD renderer code has changed.

## Preview contracts

- **Settings:** the optional per-device isoOffice flag is absent/false in old
  storage. Activation needs explicit opt-in, the HD Office on the Linux theme,
  desktop-sized viewport **and no coarse primary pointer or mobile device
  classification**, low-power or data saver. Width alone is insufficient for
  landscape phones. The current app does not read this selection.
- **Nine Pals/six visitors:** canonical immutable AgentId-to-seat mapping,
  ordered distinct visitor homes, no Pal/visitor identity conversion; real
  activity comes only from supplied authoritative state. Ambient choices
  reserve unique social anchors or fall back to each actor's own home.
- **Navigation:** sealed Step 1a ground geometry only. worldIsoCrowd reserves
  the complete old/current trajectories, moves along *each verified route
  segment* and checks every dynamic swept disc, not the shortcut chord.
  No teleport or ignoring furniture to satisfy arrival.
- **Congestion:** deterministic Pal/real-work priority, bounded substeps and
  limited temporary yielding on walkable ground. On a busy route the actor can
  wait; a genuinely unavailable workstation or no safe recovery is explicitly
  reported as blocked/unreachable. The simulator does **not guarantee**
  that every arbitrary bounded geometry permits all actors to arrive.
- **Diagnostics:** worldIsoCrowd.diagnostics() reports total ticks, simulated
  and dropped time, path queries, assignment failures, bounded recovery
  attempts, moves, max continuous wait, per-actor status, goal and failure
  reason. The isolated component may forward diagnostics to an owner callback.
  This is **not** a server-activity or privacy permission channel.
- **Clock:** elapsed simulated time is held in a stable ref independent of
  parent arrays. Real pauses stop the clock and movement; resumption does
  not replay suspended time. Each update simulates at most 200 ms, partitioned
  into at most four 50 ms movement slices. Excess elapsed wall time is
  explicitly dropped. Roster changes join/leave actors without discarding
  surviving Pal trajectories.
- **Error containment:** PreviewBoundary catches synchronous component
  failures; the RAF catches asynchronous simulation failures and stops.
  Both display the caller-supplied fallback ReactNode or a default alert.
  Stage 4's future owner MUST provide the existing flat-HD Office element
  as that fallback. **No flat renderer is mounted by this PR.**
- **Camera:** optional, externally owned WorldCamera transform. It does not
  implement Fit/Follow/Pan/Pinch inputs; these remain a future Stage 4
  integration dependency.

## CI and stress methodology

The standalone Node/Vitest tests simulate five named full-office scenarios,
**nine Pals + six visitors, 20 simulated minutes per scenario** in bounded
200 ms updates. Scenarios include ambient schedules, desk recalls, visitor
rotation, doorway/head-on travel, contended socials, blocked workstations,
pause/resume, leave/rejoin and deterministic assignment. They log
ISO_STRESS_RESULT JSON records with measured collisions, invalid ground,
teleports, arrivals, blocked/unreachable samples, failed routes, max wait,
path queries, recovery attempts, test-process CPU wall time and approximate
heap delta. A measured heap delta is **not** a browser heap profile.

Separate tests reproduce the Core head-on example (0.6-tile initial separation,
opposite goals), a tight desk corner with a chord that clips the desk, route
reservation retries, timestep partitioning, landscape eligibility, a
persistent clock, React rerenders, pause/resume and preview error fallback.

The <=25-second waiting objective applies **only where a conflict-free path
exists**. Safety and deterministic refusal are the higher priority where a
destination is irreducibly blocked. The stress results must be inspected;
a green test suite alone does not prove deadlock freedom, 25-second recovery
for all configurations, iPhone Safari performance, or realistic HD256
occlusion. Any measured exception is a release blocker to report, not a
passing claim to fabricate.

## Restrictions and remaining gates

The active Room, its separate Room Settings popup, Classic and Mobile Pixel
presentations, existing flat Office and Character Universe v3 HD256 import
remain untouched. No production assets, no live UI checkbox, and no stage 4.

Independent Core/QA review must inspect the exact new SHA, test logs and
reproducible congestion scenarios. Separate Stage 4 authorization is required
after PR #34 UX acceptance, performance/physical-device testing and reliable
flat fallback input/controller wiring. Do not merge or deploy without approval.
