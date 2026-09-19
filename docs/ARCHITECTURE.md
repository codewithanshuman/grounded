# Grounded architecture

```mermaid
flowchart LR
  A[NASA POWER climate] --> C[Calibrated location]
  B1[15-minute demand CSV] --> D[Commissioning + quality gates]
  B2[PV inverter CSV] --> D
  B3[Outage/restoration CSV] --> D
  D --> E[Fingerprint + blocked holdout]
  C --> F[Engine 2.6 correlated dispatch Monte Carlo]
  E --> F
  F --> G[Risk + causal failure chain]
  F --> H[245-strategy multi-hazard search]
  H --> I[3 holdouts + 4 assumption shocks]
  I --> J[Same-seed counterfactual proof]
  G --> K[SQLite evidence ledger]
  J --> K
  K --> L[React evidence laboratory + resilience forest]
```

## Trust boundaries

- Climate observations and operational measurements are immutable inputs to a
  run fingerprint.
- The simulation package is pure and deterministic; API and persistence code
  cannot change scenario physics.
- Optimization discovery seeds are disjoint from validation cohorts.
- Starting battery energy receives no renewable credit.
- Public reference data and commissioned site data are different schema scopes
  and receive different interface labels.
- The UI renders server evidence; it cannot award a successful audit by itself.

## Runtime

Fastify serves the React production bundle, REST endpoints and WebSocket stream.
SQLite stores complete run summaries and forest growth. A Docker health check
verifies the API. NASA calibration is cached for an offline-safe demonstration.
