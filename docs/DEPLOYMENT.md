# Grounded deployment runbook

Grounded has two deployment modes. The public static application performs
simulation in a browser worker. The Fastify/SQLite service is a **local
rehearsal service**, not yet a production multi-tenant telemetry backend.

## Public static application

```bash
pnpm install --frozen-lockfile
pnpm build:static
```

Vercel serves the generated static application. GitHub authentication and
Supabase world sync do not provide cloud storage for complete decision evidence.
Baseline summaries, optimization reports, target and manifests are retained in
IndexedDB on the current browser/device, with a maximum of 20 snapshots per
workspace. Milestone proof packages are pinned outside this rolling limit so
new snapshots do not evict a building's complete report. Browser storage eviction
or clearing can still remove either store. A synced certificate summary cannot
replace the complete proof needed for replay or placement.

Evidence is schema-validated, checked against its owner scope, audited counts,
model version and source manifests, and covered by a canonical JSON SHA-256
checksum. This detects accidental corruption, **not authenticity**: it is not
an encrypted record, digital signature or externally witnessed audit log.
Corrupt or incompatible latest records are retained and reported; they are not
silently optimized or replaced with an older decision. Reload must not plant
another tree or award another building for the same work.

The Proof screen replays a baseline or complete optimization in a separate
cancellable worker and exports the full package. Replay checks the current
model, scientific values and source-date ledger. A matching deterministic replay
does not authenticate who supplied the data or validate the real facility.

Do not bundle private exports, correspondence, secrets or reviewer identity
into the public build. Public framework-prefixed configuration is public; only
publishable client configuration belongs there. GitHub/Vercel release commands
are documented in `docs/GITHUB_VERCEL_RUNBOOK.md`.

## Local server rehearsal

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
# open http://localhost:8787
```

Fastify serves the built application, REST API and WebSocket channel on port
`8787`. `GET /api/health` reports the engine version and loaded site profiles.
Cached NASA calibration is available when the upstream service is unavailable.

The SQLite store uses schema version 3 and retains run summaries, complete
optimization reports, pending milestones, placement details and growth receipts.
Immutable result-run records preserve each building's original complete proof
when another policy is optimized from the same baseline. Earlier tables/history are preserved;
a database from a newer schema is rejected rather than overwritten.
`GET /api/evidence/:runId` retrieves a retained baseline and its optimization
report. It currently has **no per-user authorization boundary**.
`GET /api/evidence/result/:runId` retrieves the exact immutable result proof;
`POST /api/world/place` validates a pending milestone, design, plot and rotation
against that saved full report before committing placement. These routes share
the same current anonymous authorization boundary.

## Container rehearsal and durable paths

```bash
docker compose up --build
```

Persist `/data` for the SQLite ledger. Also persist the commissioned-profile
directory if using synthetic/public commissioning fixtures in a local
rehearsal; it is separate from SQLite. Confirm the actual environment settings:

- `PORT`: HTTP port, default `8787`.
- `VERDANT_DB_PATH`: durable SQLite file path.
- `SITE_PROFILE_DIR`: commissioned-profile JSON directory.
- `ALLOWED_ORIGINS`: comma-separated additional accepted HTTPS origins.

Origin filtering is not authentication. TLS termination, storage permissions
and backup/restore checks remain the deployment operator's responsibility.

## Security boundary — do not deploy private telemetry yet

The current Fastify process is anonymous and shares one world/evidence store.
Public GitHub sign-in does not authenticate its API. It does not yet provide
tenant isolation, per-record access control, encrypted evidence storage,
consent/retention enforcement or a durable CPU job queue. Do not expose this
service as a public upload API or send it private hospital/facility exports.
Use synthetic/public fixtures for rehearsal until those controls exist and
have been tested. Private partner evidence stays outside the public repository,
static assets and unprotected server endpoints.

Existing safeguards include security headers, a 25 MB body limit, shared schema
validation, generic 500 responses and a global 300-request/minute IP limit.
Operation limits are 12 simulations, six sweeps, two optimizations and three
commissioning requests per minute. Simulation sizes are bounded integers; the
validation sampling plan caps each cohort at 2,000 model evaluations. These
limits are not a substitute for admission control, worker isolation, cancellation,
tenant quotas or a job queue. Review trusted-proxy configuration before any
network exposure; client IP limits depend on a correct proxy boundary.

## Release checks

1. Run type checks, unit/integration tests and the production static build.
   Record results actually observed; a listed test command is not a pass.
2. Test a real browser run, reload its retained evidence, optimize the restored
   baseline, and reload the complete report without duplicate growth.
3. Verify the target, sources, audits, cluster bounds and unresolved gates are
   visible and remain attached to the correct configuration.
4. Verify anonymous and signed-in world behavior separately. Do not imply that
   a synced world proves cloud evidence persistence.
5. Check the deployed application, health endpoints where applicable, and the
   cached-reference fallback. Keep a backup video/screenshots for judging.
6. Replay/export a real stored report, cancel replay, and confirm it never changes
   the world. Exercise valid placement, occupied/locked rejection and reload with
   synthetic/public proof fixtures; never manufacture a production milestone.
7. Commission paired synthetic demand/PV days and check sampled dates, withheld
   dates, missing-day disclosure and continuous battery state. The public NSW
   averaged reference must still display its repeated-average fallback.

See `docs/SCIENCE_UPGRADE.md` for the current scientific and architectural
limitations. Deployment availability is not field validation or an engineering
certification.
