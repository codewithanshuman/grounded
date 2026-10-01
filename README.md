# Grounded — Climate Resilience Lab

Grounded tests a solar, battery, grid, hospital, homes and EV microgrid against
simulated climate futures, then searches for a low-disruption operating policy.
The city and Resilience Forest visualize model work; they are not surveyed
Jaipur infrastructure or evidence of real-world construction or planting.

Public application: [grounded-peach.vercel.app](https://grounded-peach.vercel.app)

Source: [anshumanbahekar/grounded](https://github.com/anshumanbahekar/grounded)

Grounded is a probabilistic decision-support prototype, not a certified
infrastructure-grade digital twin. Its sources, simulated assumptions,
uncertainty and unresolved evidence are displayed alongside the results.

## What the model does

- Engine **2.8.0** carries energy state through 72 hours at 15-minute resolution
  (288 dispatch intervals). It includes PV temperature loss, battery charge and
  discharge limits, efficiency, minimum SOC, degradation cost, grid cost and
  carbon, and critical/flexible unserved energy.
- Every dispatch step is audited for source-to-sink energy balance. Run audits
  also check classification totals, battery bounds, finite outputs, deterministic
  replay, declared sampling precision and the operational-data quality gate.
- Renewable provenance distinguishes direct solar, solar-charged battery
  discharge and starting battery energy. Starting energy receives no renewable
  credit. Carbon results are operational grid estimates, not lifecycle offsets.
- A five-hazard matrix compares normal conditions, heatwave, storm, EV surge
  and a combined extreme event using paired seeds. Reliability and severity
  quantities describe the **72-hour experiment**, not annual facility reliability.
- Counterfactual replay compares the same seed before and after an intervention.
  Paired perturbations expose sensitivity and interaction inside the model;
  they do not establish real-world causation.
- A diagnostic logistic surrogate reports held-out predictive scores. It never
  controls dispatch or selects the recommended policy.

## Target-aware strategy search and validation

The optimizer exhaustively evaluates 245 battery-reserve, EV-delay and
pre-cooling policies on a separate discovery cohort. It receives the user's
planning target. Among policies whose discovery upper risk bound meets that
target, it selects minimal disruption, then cost/carbon. If none qualifies, it
returns an explicitly unresolved risk-first fallback instead of implying that
the target was achieved. Discovery bounds are pointwise and do not validate the
winner selected from 245 policies.

Mixed-hazard evaluations sharing a seed are treated as a **seed cluster**, not
as independent observations. The decision bound is a one-sided 95% exact
binomial upper bound on whether *any* hazard in a seed cluster fails. That
event conservatively bounds the mean hazard-failure probability. Nominal
evaluation-level Wilson intervals remain diagnostic; they are not substituted
for the cluster decision bound. This is **not a cluster bootstrap**, and the
bounds are not simultaneous guarantees across all cohorts or stress settings.

The selected policy is rerun on the original population and checked on three
disjoint mixed-hazard holdouts, four disclosed one-at-a-time shocks, an 81-cell
compound stress envelope, and independent shortlist reranking. Holdout size is
chosen before observing outcomes from the planning target and hazard count,
subject to a 2,000-evaluation-per-cohort cap. A tighter target may remain
unresolved; zero observed failures never establishes zero risk.

Readiness requires valid counts, audits, replay, sources, policy identity and
seed separation; the selected sample and every holdout upper bound meeting
the target; no introduced failures in the tested holdouts/shocks/stress cells;
and recommendation/shortlist stability. A forest building has a stricter gate:
it also requires a positive reduction from a nonzero baseline and exact paired
seed-cluster McNemar improvement with `p < 0.05` in **every** independent holdout.
Neither readiness nor a building certifies a real facility.

Only an audited completed run earns a persistent tree. A qualifying optimization
earns a pending Evidence City milestone. The user chooses one of three designs
in the earned storage, flexibility or resilience category, rotates it and places
it on an eligible plot. Shared rules reject locked or occupied plots; construction
starts only after a committed placement. Categories describe levers present in
the validated combined policy, not isolated causal effects of an individual asset.

Later proof can upgrade a category through three levels when the source context
matches, the target is no weaker and the worst holdout bound strictly improves.
Receipts prevent duplicate rewards on replay or reload. A building opens its
certificate, complete saved proof and comparison/replay actions. Existing city
objects and legacy history are retained; they are not retroactively certified.

## Measured operational reference

The default operational layer is real, disclosed **New South Wales reference
data**, not Jaipur facility telemetry:

- Demand: Ausgrid Auburn 33/11 kV FY2025 SCADA/metered demand, 34,944 readings
  at 15-minute resolution (99.73% expected-interval coverage).
- PV: Ausgrid Solar Home Electricity Data, 5,252,112 valid half-hour gross
  generation intervals across 300 systems (99.93% coverage), capacity-weighted
  and normalized to the engine's 15-minute clock.
- Outage duration: 9,210 Ausgrid past-outage events from 2016-07-01 through
  2021-06-30. The simulator samples a derived duration quantile curve; audited
  FY2025 SAIFI supplies the reference annual occurrence frequency.

`data/ausgrid-measured-reference.json` contains the compact profile with source
fingerprint `SITE-68A008486D22`; `scripts/build-site-profile.mjs` rebuilds it
from the raw exports. Withheld demand/PV days and outage events check derived
profile stability. They do not validate the scaled Jaipur facility or the joint
coincidence of weather, load, PV and outages.

The bundled NSW reference contains **96-slot average profiles** and remains an
explicit repeated-average-day fallback. Commissioned exports can now retain
complete paired local demand/PV days. Engine 2.8 samples consecutive three-day
training blocks uniformly where available, preserving their measured load/PV
pairing and inter-day sequence. Without a complete block it discloses independent
paired-day sampling with replacement. Battery SOC continues across midnight.

Every fifth complete paired day is withheld for profile checks and never drawn
for model scenarios. Those measured-day checks differ from the optimizer's
independent seed holdouts. The run records sampled source dates, per-day hashes,
raw-export/dataset hashes and actual trajectories in its identity. Weekday/weekend
labels come from the local calendar; high-load/low-PV labels use training quartiles.
Low PV is not an observed weather label. Configured load/PV scaling and simulated
stress overlays remain assumptions. NASA POWER supplies location-specific
climatology and dated stress-day observations; dated climate replay does not turn
simulated outages or facility outcomes into observations.

## Commissioning a site honestly

The [CSV contract](data/SITE_DATA_CONTRACT.md) defines quarter-hour demand/PV
exports and an outage log with a separately declared, continuously observed
reliability window. The uploader's complete-coverage attestation is not
independent verification. Unknown gaps must not be declared continuous.

Outage frequency is event count divided by the **full observation exposure**,
including outage-free days, not the span between the first and last event.
One outage in 30 observed days estimates 12.175 interruptions/year. A nominal
equal-tailed exact Poisson (Garwood) 95% interval reports rate uncertainty,
including a nonzero upper limit for zero events, under the disclosed stationary,
independent-arrival and complete-reporting assumptions.

Demand, PV and reliability have separate evidence labels. Good load/PV exports
with sparse outage history are `PARTIALLY_VERIFIED`, not fully verified.
Reliability needs at least 365.25 observed days, 30 complete events, six
withheld events and acceptable withheld-duration drift before it can qualify.
Sparse commissioned reliability does not replace the simulator's disclosed
preset frequency and configured restoration assumptions. These are internal data-quality checks,
not proof of ownership, meter accuracy, legal authority or field validation.

Authorized Jaipur evidence belongs in the private `validation/` workflow.
Unanswered outreach is not a partnership. Raw exports, correspondence and
signatures must not enter the public repository or static build. The current
anonymous Fastify service is **not ready to accept private operational data**;
see [deployment boundaries](docs/DEPLOYMENT.md).

## Evidence persistence and architecture

- The static browser engine and server use shared request schemas, simulation,
  decision-readiness and growth logic in `packages/protocol` and `packages/sim`.
- Browser IndexedDB retains baseline summaries, complete optimization reports,
  planning target and manifests in up to **20 snapshots per workspace on that
  browser/device**. Canonical JSON SHA-256 checksums detect accidental
  corruption; they are not signatures, encryption or proof of authenticity.
  Schema, owner scope, audit/count/source consistency and model compatibility
  are checked on restore. An incompatible or corrupt latest record is retained
  and reported rather than silently used or replaced by an older decision.
  Milestone proofs are pinned separately from the rolling snapshot limit; they
  remain device-local and can still be lost if browser storage is cleared.
- The local server stores run summaries and full optimization reports in SQLite
  schema version 3. Immutable result-run proof records preserve certificates even
  when a baseline is optimized again. Versioned tables and receipts retain history;
  databases written by a newer schema are rejected rather than overwritten.
- GitHub sign-in/Supabase world sync in the public static application does
  **not** mean the full evidence report is stored in the cloud. Clearing browser
  storage can remove local evidence. The server is currently an anonymous,
  single-world service, not an authenticated multi-tenant evidence backend.
- Replay recomputes the saved baseline and, where present, the complete policy
  search, holdouts, stress envelope and stability report in a separate cancellable
  browser worker. It compares scientific values and source-date ledgers, ignoring
  only transport run IDs/timestamps. A replay pass establishes deterministic model
  agreement, not field validity or an external signature. Unsupported model
  versions remain retained and cannot be silently replayed as the current model.

Packages: `packages/protocol` (schemas), `packages/sim` (pure model and shared
gates), `packages/world` (SQLite), `apps/server` (Fastify/WebSocket), `apps/web`
(React/Phaser/worker), and `apps/cli` (local development orchestration).
The workspace and visual city conventions were adapted from `claude-clan-main`.

## Running and checking it

```bash
pnpm install --frozen-lockfile
pnpm --filter @verdant/cli exec tsx src/index.ts
# Or run apps/server and apps/web dev scripts in separate terminals.

pnpm build:static                  # public browser-compute application
pnpm build
pnpm start                         # local server rehearsal on :8787

pnpm -r typecheck
NODE_OPTIONS=--experimental-sqlite pnpm -r test
pnpm exec playwright test          # separate browser suite; verify its result
pnpm -r build
```

`node:sqlite` is experimental in Node 22; server scripts enable the required
flag. `GET /api/health` is the server health check. Releasing a static build and
hosting a server with private telemetry are different deployment decisions.
See [deployment](docs/DEPLOYMENT.md) and the
[GitHub/Vercel runbook](docs/GITHUB_VERCEL_RUNBOOK.md).

## A focused judge walkthrough

1. Run 500 Extreme Combined Event futures. Explain the 72-hour horizon, source
   fingerprints, NSW reference scope and run audit.
2. Open Risk: show critical loss risk, loss duration, unserved energy, a dispatch
   event timeline and a reproducible failure seed.
3. Compare the five hazards, then run Strategy with a stated planning target.
   Show the discovery selection rule and independent cluster holdouts. If a
   gate is unresolved, explain it; do not present the plan as validated.
4. Replay the same seed before/after and inspect paired failures, stress cells
   and shortlist stability. A lower selected-sample percentage is not enough.
5. Open Proof to replay/export the full saved report. If every growth gate passes,
   choose an earned design and plot, then inspect its certificate. Open Method for
   source/evidence limitations and reload without duplicate world growth.

## What remains

This release implements the integrity upgrade, paired measured-day sampling,
Evidence City placement and complete proof replay. Richer generator/clinical-tier/
EV/thermal models, cluster-bootstrap and tail/CVaR uncertainty, authenticated
Fastify tenant isolation, job queues and external facility validation remain
unfinished. The model does not implement AC power flow, protection coordination
or network failure propagation. Procurement and safety decisions require local
measurements and qualified engineering review.

See [Science upgrade status](docs/SCIENCE_UPGRADE.md) for implemented work and
remaining boundaries. No software change guarantees a competition prize.
