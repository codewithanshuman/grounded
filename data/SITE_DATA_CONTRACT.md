# Grounded site commissioning CSV contract

Upload three UTF-8 CSV files. Use ISO 8601 timestamps with the site UTC offset.
Load and PV are assessed separately from reliability. At least 30 continuous
days of 15-minute demand and PV readings, 95% coverage and passing withheld-day
checks are required for their `VERIFIED` labels. These are internal quality
checks, not independent meter certification or proof of site ownership.
The current importer accepts native quarter-hour rows only; 5-minute exports
must first be reviewed and aggregated to 15-minute averages. Duplicates,
offset-free timestamps, off-grid timestamps, blank/negative/nonfinite values
and PV output above the declared inverter kW capacity are rejected rather than
silently rewritten or clipped. An all-zero load or PV signal is not verified.

## Demand

`timestamp,demand_kw`

## PV

`timestamp,pv_kw`

## Paired measured days

Engine 2.8 retains complete local days containing exactly 96 quarter-hour rows
in each export. Demand and PV must share the same UTC timestamp for every slot.
Incomplete, unpaired and daylight-saving days are excluded without interpolation;
the retained profile lists excluded dates. At least one complete paired day must
remain. Verification requires at least 30 complete paired days, six withheld
days and the separate demand/PV quality gates above.

Every fifth complete paired date is withheld from scenario sampling. Training
days supply consecutive three-day blocks where available; otherwise the engine
discloses independent paired-day sampling with replacement. Battery SOC remains
continuous over the 72-hour run. Source-date draws, day hashes and raw-export/
dataset hashes are retained. Complete trajectories also enter the run identity.
Measured demand is scaled to configured flexible load, PV to configured inverter
capacity, and simulated hazard overlays remain modeled assumptions.

Local calendar labels distinguish weekday/weekend. High load means a daily mean
above training-day Q75; low PV means daily energy below training-day Q25. Low PV
does not establish observed cloud cover. Measured-day profile checks and the
optimizer's independent seed holdouts are different forms of validation. The
bundled NSW averaged reference remains a repeated-average-day fallback.

## Outages

`outage_started_at,restored_at,cause`

Declare the full continuously observed reliability window separately:

```json
"outageObservationWindow": {
  "startedAt": "2025-01-01T00:00:00+05:30",
  "endedAt": "2026-01-01T00:00:00+05:30",
  "continuousCoverage": true
}
```

The window start is inclusive and end exclusive. It must be the actual period
for which the site supply-point log was observed completely, including days
with no outages. It must NOT be inferred from the first and last outage. The
continuous-coverage checkbox is the uploader's attestation, not independent
verification. Do not attest complete coverage for a log with unknown gaps.

Every event must start and restore inside the window. Invalid, duplicate,
overlapping or boundary-censored events are rejected rather than silently
discarded. A header-only outage CSV is valid when genuinely no outages were
observed throughout the declared window; it does not establish zero risk or a
restoration-duration distribution.

Frequency is `event count / observation years`, where one year is 365.25 days;
interrupted minutes are annualized using the same actual exposure. For example,
one outage in 30 observed days estimates 12.175 interruptions/year, NOT one.
A nominal equal-tailed exact Poisson 95% rate interval is reported, including
a nonzero upper bound when zero events are recorded. It assumes stationary,
independent interruptions and complete reporting at one site supply point;
clustering, seasonal changes and missing events are outside that interval.

Reliability remains `INSUFFICIENT_HISTORY` until at least 365.25 observed days,
30 complete events and six withheld events support the duration comparison.
Adequate history whose withheld-duration KS statistic exceeds 0.35 is `REVIEW`.
Sparse estimates must not replace the simulator's disclosed reference prior.

Overall `VERIFIED_SITE` requires verified load, PV AND reliability. A good
load/PV export with sparse outages is `PARTIALLY_VERIFIED`, never fully verified.
Grounded withholds every fifth complete paired day/event for validation and
fingerprints the retained trajectories, profile, observation window and uncertainty. Uploaded
private logs still require permission and must not be published automatically.

Interval methodology: [exact Poisson rate limits](https://www.statsdirect.com/help/rates/poisson_rate_ci.htm).
