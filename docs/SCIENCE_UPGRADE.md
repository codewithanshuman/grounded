# Science and evidence upgrade status

This document covers the integrity upgrade, paired measured-day sampling,
Evidence City placement and complete proof replay for engine **2.8.0**. The
research roadmap still includes work listed below. City objects express stored
model evidence; their construction is a visualization of that evidence.

## Implemented

### 1. Correct reliability exposure

Commissioning requires a separately declared observation window and an explicit
continuous-coverage attestation. Annualization uses the full exposure, including
outage-free time. One event in 30 days is 12.175 events/year, not one. The importer
reports a nominal equal-tailed exact Poisson/Garwood 95% rate interval, including
zero-event uncertainty. Stationarity, independent arrivals and complete
site-supply-point reporting are assumptions; the uploader's attestation is not
independent proof. Censored, overlapping, duplicate and invalid events are
rejected, not silently removed to improve the result.

### 2. Separate energy and reliability evidence

Demand/PV quality and reliability history receive separate labels. Strong
energy exports with sparse outages are `PARTIALLY_VERIFIED`. Reliability needs
at least 365.25 observed days, 30 complete events, six withheld events and an
acceptable duration holdout before it can qualify. Sparse reliability cannot
replace disclosed simulation frequency/restoration assumptions. A structural
quality pass does not certify meter accuracy, consent or site ownership.

### 3. Target-aware selection

The 245-policy search receives the chosen planning target. Feasible discovery
policies are ordered by minimal disruption, then cost/carbon; when none meets
the discovery bound, a disclosed unresolved risk-first fallback is returned.
Discovery is separate from the selected sample and independent validation.
Changing the target requires rerunning selection/validation for that target.

### 4. Seed-cluster decision uncertainty

Hazards sharing a seed are not counted as independent evidence. A seed cluster
is critical if any of its hazards fails. A one-sided 95% exact binomial upper
bound on that event conservatively bounds mean hazard failure probability.
Incomplete clusters are treated pessimistically. Nominal evaluation-level
Wilson bounds and paired inference remain diagnostics, not decision substitutes.
Paired improvement is also calculated at the independent seed-cluster level
using exact McNemar inference.

This is not a cluster bootstrap. Paired measured-day sampling is implemented
below, but does not supply a statistical cluster-bootstrap interval. Discovery
bounds are pointwise and selection-biased if presented as validation. Independent
holdouts reduce that selection problem; their bounds still are not a simultaneous
family-wise guarantee, field reliability interval or proof of model correctness.
Target-based cohort size is selected before outcomes, capped at 2,000 evaluations
per cohort, and can leave stringent targets unresolved.

### 5. Evidence-earned growth

An ordinary completed run earns a tree only when its counts, audit and replay
pass. Safe-sample percentages do not automatically create buildings. A milestone
requires complete shared readiness evidence: matching model/source/policy,
disjoint seed ranges, target support in every independent holdout, no introduced
failures across the tested holdouts/shocks/compound envelope, and stable
recommendation/shortlist behavior. It additionally requires positive selected-
sample improvement from a nonzero baseline and exact paired cluster improvement
with `p < 0.05` in every holdout. An unresolved gate withholds the milestone even
if the selected sample improves. Idempotent receipts prevent duplicate growth.

A milestone unlocks three category-appropriate architecture choices and eligible
plots. Users choose a design, rotation and plot; shared browser/server checks
validate the pending entitlement, occupation and exact complete proof before
placement. Construction animation follows the committed placement event.
Storage, flexibility and resilience categories indicate levers in a validated
combined policy, not isolated asset-effect attribution. Each category has three
levels; upgrades require the same physical/source context, an equal or stricter
target and a strictly improved worst holdout bound. Building inspection exposes
the certificate, retained complete report, replay and comparison.

These objects record computational evidence, not real planting, construction or
facility certification. Legacy history is preserved, not retroactively certified.

### 6. Shared logic and retained evidence

Browser and server share request schemas, selection/readiness and growth logic.
Input limits, target propagation and paired seed offsets follow the same
contract. The local server persists baseline/result summaries and complete
optimization reports in SQLite schema version 3. Complete reports are retained
immutably by result-run identity, so later optimization of the same baseline
cannot overwrite a building's proof. Prior tables/history remain.

The browser retains up to 20 owner-scoped evidence snapshots per workspace in
IndexedDB, including baseline, optimization, target and manifests. Restore
checks schema, counts/audit agreement, deterministic replay, source fingerprints
and model compatibility. A canonical JSON SHA-256 checksum detects accidental
corruption, **not authenticity**. It is not a signature or encryption. Corrupt
or incompatible latest records remain retained but are not silently loaded,
optimized or replaced by an older decision. These records are local to the
browser/device; Supabase world sync is not cloud evidence persistence. Milestone
proofs are pinned outside the rolling 20-snapshot limit. Clearing or evicting
browser storage can still remove them; a certificate summary alone does not
grant construction or allow complete proof replay.

### 7. Paired measured-day operational sampling

Commissioning preserves complete local 96-slot demand/PV days with exact matching
UTC timestamps. Missing, unmatched and daylight-saving days are excluded without
interpolation and their dates are disclosed. Every fifth complete paired date
is withheld from scenario sampling for profile checks; demand and PV share the
same split. This measured-day holdout differs from the policy seed holdouts.

The engine samples complete consecutive three-day training blocks uniformly
where available. If no block exists, it draws paired days independently with
replacement and states that inter-day persistence is lost. The same seed draws
the same paired days across interventions and hazards; SOC stays continuous
through all 288 intervals. Samples preserve measured load/PV pairing, while
configured capacity scaling and hazard overlays are still modeled.

Run records retain source-date draw counts, day fingerprints and raw-export/
dataset hashes. Actual trajectories are bound into the run fingerprint, rather
than trusting a caller-supplied dataset label. Calendar labels use the declared
timezone; high load and low PV are training-quartile classifications. Low PV is
not a measured cloud/weather label. No claim of seasonal or rare-event coverage
follows from retaining a finite sample of days. The bundled public NSW profile
contains only average curves and continues to disclose repeated-average fallback.
Native five-minute commissioning and a broader joint weather/outage bootstrap
remain outside this release.

### 8. Complete proof replay

A separate browser worker can recompute a retained baseline or complete
optimization package, including discovery, independent holdouts, shocks, the
81-cell stress envelope, shortlist stability and dated climate replay where
present. It compares scientific fields and sampling provenance within the
declared numerical tolerance; only transport run IDs/timestamps are ignored.
Input/schema/model/source consistency is checked before replay, and cancellation
terminates the worker. A pass shows deterministic agreement with the recorded
model, not external authenticity, field reliability or independent validation.
Reports from incompatible model versions remain retained and are rejected for
current-model replay rather than silently reinterpreted.

## Explicitly not completed

- Joint measured weather/load/PV/outage modeling, seasonal/rare-event coverage,
  native five-minute commissioning and independently validated local calibration.
  The public reference still uses 96-slot average curves.
- Generator start/fuel/failure dynamics, clinical load tiers, detailed EV
  charging/vehicle state and thermal comfort dynamics.
- Cluster bootstrap, confidence intervals for CVaR/tail severity, broader
  sensitivity research and field validation of uncertainty assumptions.
- Signed/witnessed evidence, encrypted remote evidence storage and durable
  multi-device/cloud decision-history synchronization.
- Authenticated Fastify users, tenant-isolated records/worlds, per-record
  authorization, durable jobs, cancellation and worker admission control.
- Named Jaipur facility validation or telemetry unless separately supported by
  authorized retained evidence. Outreach is not a partnership.
- AC power flow, protection coordination, network failures, procurement-grade
  or clinical safety certification.

The Fastify service remains anonymous and single-world. It must not be exposed
as a public private-telemetry upload service. See `docs/DEPLOYMENT.md`. Static
sign-in does not close that backend security gap.

## Verification scope

Use the repository type checks and unit/integration suites for the shared
model, commissioning, request contract, growth, persistence and worker workflows.
Also exercise a real browser run → reload → optimize → reload sequence and
verify no duplicate growth. Run browser E2E and deployment checks separately;
do not infer they passed from a unit suite or a successful build. Test counts
and a smooth demonstration do not prove field reliability or scientific validity.
