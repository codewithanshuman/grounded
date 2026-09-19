# Grounded — Climate Resilience Digital Twin

**Grounded lets a community test thousands of possible climate futures before
the real emergency arrives.** It models a solar, battery, grid, hospital,
homes, and EV microgrid; finds the exact chain that causes critical failure;
and searches for a low-disruption intervention that survives the same future.

Public verified demo: https://grounded-jaipur-resilience.anshumanbahekar.chatgpt.site

Vercel production mirror: https://grounded-peach.vercel.app

Source: https://github.com/anshumanbahekar/grounded

## Why it is different

- **Climate-calibrated, operational-data digital twin** — NASA POWER monthly
  climatology is joined to a verified public operational reference: 34,944
  quarter-hour demand readings, 5,252,112 gross-metered PV intervals from 300
  systems, and 9,210 actual outage/restoration-duration records. Each source
  is disclosed, quality-scored and bound into the reproducibility fingerprint.
  Each future carries energy state through 72 hours (288 dispatch intervals)
  across correlated heat, cloud, measured load/PV shapes, EV peaks and an
  empirical restoration-duration distribution.
- **Engineering-level accounting** — PV temperature loss, battery charge and
  discharge limits, round-trip efficiency, minimum SOC, degradation cost,
  grid cost, grid carbon and critical/flexible unserved energy are all part of
  the executable model. Engine 2.5 also reports LOLP, LOLE, EENS and CVaR95 so
  judges can distinguish failure frequency, duration, energy severity and the
  average outcome inside the worst 5% of futures.
- **Conservative renewable provenance** — direct solar and solar-charged
  battery discharge are traced separately through every dispatch interval.
  Starting battery energy receives no renewable credit; the model reports
  solar capture, curtailment, renewable energy served and avoided operational
  grid carbon without claiming lifecycle or offset accounting.
- **Multi-hazard Climate Matrix** — one click tests the same microgrid against
  normal conditions, heatwave, storm, EV surge, and a combined extreme event.
  A worst-case robust score prevents safe averages from hiding a catastrophic
  weak point.
- **Explainable, out-of-sample strategy search** — Grounded exhaustively
  evaluates 245 battery-reserve, EV-delay, and pre-cooling strategies on an
  independent 300-future discovery cohort, exposes the non-dominated Pareto
  frontier, then validates the winner on the original unseen population,
  three additional disjoint holdouts and four disclosed assumption shocks.
- **Machine-audited dispatch** — every 15-minute step closes an explicit
  source-to-sink energy balance. Seven invariants verify conservation,
  classification totals, battery bounds, finite outputs, exact replay,
  declared Monte Carlo precision and the measured-data quality gate.
- **Commission any real site** — three ordinary CSV exports (15-minute demand,
  PV inverter power, and outage/restoration history) become a persistent
  `COMMISSIONED_SITE` profile. Grounded rejects malformed contracts, measures
  interval completeness, withholds every fifth day/event, fingerprints the
  normalized evidence and labels weak inputs `REVIEW` instead of manufacturing
  confidence.
- **Statistical honesty** — critical-risk estimates include a 95% Wilson score
  interval, and the in-app model card discloses sources, calibration status,
  operational assumptions, and important boundaries.
- **Causal sensitivity** — paired stress perturbations quantify which physical
  uncertainty controls risk, then replay the two dominant drivers together to
  expose second-order interaction instead of assuming additive effects.
- **Interpretable ML audit** — after exact dispatch finishes, a regularized
  logistic surrogate learns five physical risk drivers on 80% of the seeded
  futures and reports AUROC, Brier score, calibration error and balanced
  accuracy only on the untouched 20%. Standardized coefficients are exposed;
  the surrogate is diagnostic and never controls dispatch or recommendations.
- **Robust multi-objective evidence** — the strategy search spans all five
  hazards and reports risk, unserved energy, disruption, cost and carbon. The
  selected plan is validated on the original population and replayed against
  the 12 highest-stress dated NASA POWER climate days from 2023. NASA supplies
  observed weather; outage and demand conditions remain explicitly simulated.
- **Paired policy safety** — every holdout and assumption shock replays
  identical seeds before and after intervention, counts prevented and newly
  introduced failures, and reports Wilson bounds, P99 severity and CVaR99.
- **Counterfactual proof** — the Compare Worlds panel replays the identical
  failure seed before and after the intervention, showing whether the hospital
  actually keeps power.
- **Durable evidence** — complete run summaries are persisted in SQLite, so a
  server restart does not invalidate a run ID or prevent later optimization.
- **A forest earned by evidence** — every completed simulation plants a
  persistent tree. Buildings appear only after a validated resilience
  milestone, never from a decorative timer.

## Five-minute judge demo

1. Choose **Extreme Combined Event** and run 500 three-day futures. Point out
   the operational-data selector, source fingerprint, NASA climate fingerprint
   and 288-interval horizon.
2. Open **Risk**: show the critical-rate distribution, cause contribution,
   the timestamped chain to hospital power failure, then show LOLP, LOLE,
   EENS, CVaR95, the renewable-provenance ledger, and the holdout-tested ML
   audit that explains which physical conditions predict simulated failure.
3. Run **Matrix** from the Stress panel: explain that 2,500 correlated futures
   compare all hazards with identical seeds and identify the system's weakest
   condition.
4. Open **Optimizer** and run the search: point out 245 strategies across five
   hazards, the risk/energy/cost/carbon Pareto frontier, the independent discovery cohort,
   three holdouts, assumption-shock audit, ablation benchmarks and dated
   historical-climate replay.
5. Open **Method**: show the measured demand/PV curves, 9,210 historical outage
   records, restoration P50/P90/P95 and all three clickable source records.
6. Open **Compare**: show the same seed failing in World A and surviving in
   World B, then point to the newly earned growth in the persistent forest.

## Measured operational reference

The default operational layer is deliberately real and reproducible:

- **Demand:** Ausgrid Auburn 33/11 kV FY2025 raw SCADA/metered demand,
  34,944 readings at 15-minute resolution (99.73% expected-interval coverage).
- **PV:** Ausgrid Solar Home Electricity Data, 5,252,112 valid half-hour gross
  generation intervals across 300 systems (99.93% coverage), capacity-weighted
  and normalized to the engine's 15-minute clock.
- **Outage/restoration:** 9,210 Ausgrid past-outage events from 2016-07-01 to
  2021-06-30, representing 5,522,219 customer interruptions. The simulator
  samples the observed 101-point duration quantile curve (median 1.77 h, P90
  6.40 h, P95 10.24 h); audited FY2025 SAIFI sets annual occurrence frequency.

The compact derived profile is `data/ausgrid-measured-reference.json`, with
source fingerprint `SITE-68A008486D22`. `scripts/build-site-profile.mjs`
rebuilds it from the three raw exports. This is a measured New South Wales
reference cohort, not Jaipur telemetry. The interface says so explicitly;
the Local Commissioning panel accepts the team's own meter and outage exports
under the contract in `data/SITE_DATA_CONTRACT.md`.

The reference profile also has a blocked out-of-sample check: 72 demand days,
73 PV days and 1,842 outage events are withheld. Current holdout errors are
0.415% demand-profile MAE, 0.007 PV capacity-factor MAE and 0.0231 outage
duration KS drift. These metrics validate profile stability; they do not turn a
cross-region reference into Jaipur commissioning data.

Real Jaipur telemetry is accepted only through the private evidence workflow in
`validation/`. A named reviewer, explicit permissions, meter boundary, 30-day
interval coverage and file fingerprints are required before Grounded labels a
profile commissioned. Run `pnpm validate:partner` against the private inbox;
raw exports are ignored by Git and never belong in the public static build.

A real Monte Carlo energy simulation for a solar+battery+grid microgrid, wrapped
in a persistent **Resilience Forest**: every simulation you run plants a tree;
every genuinely validated fix the optimizer finds grows a building. Nothing
grows on a timer or from the UI alone — only from real, completed work.

Architecture and tooling conventions (pnpm workspace, Fastify+WS server,
Vite+React client, packages split into pure/testable logic vs. app glue) are
deliberately modelled on the `claude-clan-main` project this was built
alongside.

## Packages

- `packages/protocol` — shared zod schemas + shared isometric geometry constants
- `packages/sim` — the energy model: physics simulation, Monte Carlo runner,
  intervention optimizer, failure-narrative builder. Pure functions, no I/O.
- `packages/world` — SQLite-backed (`node:sqlite`) persistence for complete
  evidence runs, the Resilience Forest, and its growth policy.
- `apps/server` — Fastify + WebSocket API tying `sim` and `world` together.
- `apps/web` — Vite + React + Phaser client: an isometric forest that grows
  live inside a structured evidence laboratory (Digital Twin, Climate Matrix,
  Risk Evidence, Strategy, Counterfactual Proof, and Methodology).
- `apps/cli` — boots server + web together for local development.

## Running it

```bash
pnpm install
pnpm --filter @verdant/cli exec tsx src/index.ts
# or, in two terminals:
#   cd apps/server && pnpm dev      (http://localhost:8787)
#   cd apps/web    && pnpm dev      (http://localhost:5173)
```

For a single production service:

```bash
pnpm build
pnpm start                         # web + API + WebSocket on :8787
docker compose up --build          # equivalent container rehearsal
```

For the read-only Vercel/static showcase:

```bash
pnpm build:static
```

GitHub and Vercel release commands are documented in
`docs/GITHUB_VERCEL_RUNBOOK.md`.

`GET /api/health` is the deployment health check. See
`docs/DEPLOYMENT.md` for persistence, origins and production boundaries.

`node:sqlite` is experimental in Node 22 — the server's `dev`/`start` scripts
already set `NODE_OPTIONS=--experimental-sqlite` for you.

## Verifying it

```bash
pnpm -r typecheck   # all 6 TS packages/apps, zero errors
NODE_OPTIONS=--experimental-sqlite pnpm -r test   # 37 unit/integration tests
pnpm exec playwright test                       # judge flow, commissioning, mobile layout
pnpm -r build       # server compiles, web produces a production bundle
```

## What's measured vs. simulated

Measured and fingerprinted: a 96-slot demand profile from one year of 15-minute
network readings, a 96-slot PV capacity-factor profile derived from 300
gross-metered systems, and an empirical restoration-duration distribution from
9,210 historical events. NASA POWER supplies location-specific climatology and
dated stress-day observations.

Executable and tested: the physics model (priority-based energy allocation,
stochastic weather/outages/demand), the Monte Carlo population, the optimizer's
grid-search, energy-balance audit, deterministic manifests, disjoint holdout
validation, ML-surrogate holdout scoring, SQLite evidence persistence, the forest's growth policy and the
server↔client wiring.

Still simulated: individual 72-hour future weather, outage occurrence and the
coincidence of load, PV and restoration. The public operational cohort is used
as a measured reference shape/distribution and is scaled to the configured
Jaipur microgrid; it is not field telemetry from that facility. The model does
not claim AC power-flow, protection coordination, component-network failures or
certified engineering status. NREL PVWatts remains a methodology reference;
real procurement requires local site measurements and engineering review.
