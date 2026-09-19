# Grounded deployment runbook

Grounded ships as one container: Fastify serves the built React application,
REST API, WebSocket channel and SQLite evidence store on port `8787`.

## Local production rehearsal

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
# open http://localhost:8787
```

Health check: `GET /api/health` returns the engine version and loaded site-data
profile count. The app works with cached NASA calibration when the upstream
service is unavailable.

## Docker

```bash
docker compose up --build
```

Persist `/data`; it contains the SQLite evidence ledger. Commissioned profiles
are written under `data/site-profiles` inside the application image/workspace,
so a production platform should also mount that path or replace it with object
storage before accepting user uploads at scale.

## Required production settings

- `PORT`: platform-assigned HTTP port (default `8787`).
- `VERDANT_DB_PATH`: durable SQLite path (default shown in the Docker image).
- `SITE_PROFILE_DIR`: durable directory for commissioned profile JSON files.
- `ALLOWED_ORIGINS`: comma-separated additional HTTPS origins. Same-origin and
  local development are accepted by default; arbitrary origins are rejected.

The server applies security headers, a 25 MB body limit, schema validation,
generic 500 responses and a 300-request/minute IP rate limit. Terminate TLS at
the deployment platform. Do not expose private commissioning files through a
public deployment without authentication and a documented retention policy.

## Demo resilience checklist

1. Confirm `/api/health` is green.
2. Run a 100-future smoke simulation.
3. Confirm the Method workspace displays climate and site fingerprints.
4. Keep the measured reference profile available as an offline-safe fallback.
5. Record a backup demo video and screenshots before judging.
