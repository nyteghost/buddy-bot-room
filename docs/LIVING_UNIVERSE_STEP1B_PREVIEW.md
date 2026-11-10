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
- **Congestion:** deterministic real-work/Pal priority, bounded substeps and
  limited temporary yielding on swept-clear ground. A yielding route intercepted
  by a later actor is invalidated, and a bounded alternate sidestep is attempted
  without teleporting or ignoring furniture. If alternate recovery is unavailable
  the actor reports blocked/unreachable rather than yielding forever. A logical
  request with no new best progress for 25 seconds is marked stalled, even
  if temporary yielding or schedule retries reset per-actor waiting counters.
  The simulator does **not guarantee** that every arbitrary bounded geometry
  permits all actors to arrive.
- **Diagnostics:** worldIsoCrowd.diagnostics() reports total ticks, simulated
  and dropped time, route queries, assignment failures, recovery attempts,
  moves, maximum wait, and each actor's requested versus reserved destination.
  A rejected assignment explicitly releases the prior reservation and never
  creates an active claim; initial join positions are not destination claims.
  Arrival is true **only after successful reservation and actual completion**,
  never because a rejected/nonfinite request fell back to the current position.
  Per-logical-goal records include request/reservation/completion/finish times,
  canceled/rejected/unreachable/stalled outcome and reason, cumulative/maximum
  continuous blocked time, yielding duration, recovery attempts, and
  no-new-goal-progress time. Reassigning the same logical target does not
  reset its request age or no-progress history. The diagnostics history is
  capped at 4,096 records with an explicit truncated counter for long-lived
  previews. This is **not** a server-activity or privacy permission channel.
- **Clock:** elapsed simulated time is held in a stable ref independent of
  parent arrays. Real pauses stop the clock and movement; resumption does
  not replay suspended time. Each update simulates at most 200 ms, partitioned
  into at most four 50 ms movement slices. Excess elapsed wall time is
  explicitly dropped. Roster changes join/leave actors without discarding
  surviving Pal trajectories.
- **Error containment:** PreviewBoundary catches synchronous component
  failures; the RAF catches asynchronous simulation failures and stops.
  A scene frame that throws **or returns null** latches a once-only fault,
  cancels/blocks further RAF and scene-generation attempts, and notifies
  the owner through onFailure exactly once. Render-time fault detection
  schedules a state effect, not a render-time state update.
  All failures display the caller-supplied fallback ReactNode or a default alert.
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
ISO_STRESS_RESULT JSON records with observed endpoint collisions, invalid
ground points, displacement violations, actor-period arrival **samples**,
blocked/unreachable actor-tick samples, rejected assignments, per-goal
completion/rejection/cancellation/stall counts, maximum accumulated and
continuous blocked time, goal age, path queries, recovery attempts, and
test-process **wall elapsed** time. `performance.now()` does not measure CPU
utilization; a `heapUsed` delta is not process peak heap or browser memory.
Snapshot collision checks are not a continuous-time swept oracle, and one
actor-period arrival sample is not necessarily one completed logical goal.

Separate tests reproduce the Core head-on example (0.6-tile initial separation,
opposite goals), a **three-actor late interception of an already active
yielding route**, a held 30-second permanently obstructed corridor with
repeated same-goal assignment, a 60-second 15-actor **fixed-goal** scenario,
three claimants competing for a released anchor, invalid numeric/malformed/
blocked-furniture/unreachable destinations, a tight desk corner, timestep
partitioning, rapid roster churn, deterministic complete-state replay, tab
suspension/pause, scene frame null/throw and once-only fail-stop fallback.
The fixed-goal synthetic test also compares sampled movement segments for
swept intersections; this is not an independent continuous-time browser
collision oracle.

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
