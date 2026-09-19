# Grounded site commissioning contract

Grounded commissions a site from three UTF-8 CSV exports. Timestamps must be
ISO 8601 and should include their UTC offset (for example,
`2026-01-01T00:00:00+05:30`). Demand and PV files should contain at least 30
days of continuous 15-minute measurements for a verified result. Files with
gaps or shorter coverage are accepted as `REVIEW`, never silently promoted to
verified data.

## 1. Demand meter

```csv
timestamp,demand_kw
2026-01-01T00:00:00+05:30,418.2
2026-01-01T00:15:00+05:30,409.7
```

Required columns: `timestamp`, `demand_kw`. Accepted value aliases include
`load_kw`, `power_kw`, and `kw`.

## 2. PV inverter

```csv
timestamp,pv_kw
2026-01-01T00:00:00+05:30,0
2026-01-01T12:00:00+05:30,382.4
```

Required columns: `timestamp`, `pv_kw`. Supply the installed DC/AC reference
capacity in the commissioning form so Grounded can calculate capacity factor.

## 3. Outage/restoration history

```csv
outage_started_at,restored_at,cause
2025-06-18T14:05:00+05:30,2025-06-18T16:42:00+05:30,Distribution fault
```

Required columns: `outage_started_at`, `restored_at`. `cause` is optional.
Restoration must occur after the outage start.

## Quality and validation

- Duplicate interval timestamps are deterministically collapsed.
- Invalid or negative measurements are rejected from the profile.
- Completeness is measured against every expected 15-minute interval between
  the first and last timestamp.
- Every fifth observed day/event is withheld. Grounded reports demand MAE and
  RMSE, PV capacity-factor MAE and RMSE, and outage-duration KS drift.
- The exact normalized profile, sources, validation metrics and disclosure are
  SHA-256 fingerprinted. Changing any input changes the fingerprint.
- Uploaded profiles are stored only on the configured Grounded server under
  `data/site-profiles/`. Grounded does not certify meter ownership or accuracy.

