# Dashboard and coastal railway upgrade

## Scope

The landing page and existing simulation features are retained. Dashboard styles
are scoped to `.lab-shell`. The existing city, airport, forest and reserve bridge
remain in their original positions; a northern research island and elevated
railway extend the scene using the vendored reference-city projection and drawing
primitives. No external facility validation or new measured telemetry is claimed.

## Dashboard

- White navigation, grouped system inputs, readable controls, green accents,
  keyboard focus states, mobile input access, and reduced-motion styling.
- A decision brief reports critical-loss probability, the unrounded Wilson 95%
  interval, expected critical energy loss, operational carbon and integrity checks.
- The selectable planning target assesses the upper sampling bound. It does not
  change the optimizer's objective and is not a field reliability certification.
- Editing any recorded input preserves the previous report with an explicit stale
  notice. Optimization requires a matching baseline. Restore run inputs is available.
- Simulation, climate sweep and optimization cannot overlap in the browser engine.
  Late responses from another account/input context cannot replace the open report.
- Worker startup, timeout and invalid-world failures have visible error states.
  Invalid saved worlds are backed up and verified before a replacement starts.
  If the backup cannot be saved, initialization stops without replacing the original.
- Open analysis reports are in memory; reloading clears them. Saved world growth is
  persisted separately. Recovery pauses cloud synchronization for that session.
- GitHub token refresh and duplicate sign-in notifications do not rehydrate an
  active account's world. Late account initialization cannot undo sign-out or
  account switching. On a fresh page, cloud hydration remains authoritative;
  offline multi-device conflict resolution is not part of this release.

## Evidence corrections

- Retained failure replays restore both the original climate calibration and the
  operational-data profile.
- Zero observed failures retain a nonzero upper uncertainty bound.
- Paired proof keeps aggregate and holdout results visible even when no baseline
  failure trace was retained. Regression copy is not presented as an improvement.
- World growth requires passing counts, audits and deterministic replay. Optimization
  milestones are idempotent per baseline, including after restoring saved state.
- The methodology view uses the completed run's provenance when a report is open,
  rather than mixing it with subsequently edited inputs.

## Railway

- Research Park, City Gate, Reserve Link and Airport are connected by two tracks.
- Two three-car trains follow a deterministic timetable with eased acceleration,
  station dwell, synchronized cars, pause/resume and 0.5×/1×/2× playback.
- Side platforms, stairs, overpasses, viaduct piers and overhead wires use the same
  isometric coordinate system as the city. The research campus has a masonry facade,
  colonnade and rooftop solar; mixed trees frame its island.
- Train and station inspection explicitly identifies the transit as illustrative.
- Transit is not a live railway, ridership dataset or energy-model input. The clock
  restarts when its scene is recreated. Reduced-motion preference starts it paused.

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build:static
```

New tests cover input snapshots and request ownership; measured-profile replay;
track bounds, timetable continuity and pause behavior; proof without failure traces;
idempotent milestones; saved-world backup failures; and the actual static-worker
init → measured extreme run → optimize → repeat optimize → climate-sweep workflow.
Session tests cover duplicate initialization, token refresh, account changes,
sign-out, retry after a bootstrap failure and subscription disposal.

Browser checks should include desktop and narrow layouts, a complete simulation,
stale-input/restore behavior, invalid inputs, optimizer proof, and railway pause,
speed and station inspection. Automated tests do not replace visual acceptance.
