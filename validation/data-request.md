# Minimal Jaipur telemetry request

Grounded requests operational energy data only. No patient, staff, consumer,
billing-account, credential, precise personal-location, or other personally
identifiable data is needed.

Requested package:

- 30–90 continuous days of facility demand in kW at 15-minute resolution.
- Matching PV inverter or revenue-meter production in kW.
- Outage start and restoration timestamps for the same facility boundary.
- Installed PV capacity, battery rating if present, and critical-load estimate.
- Timezone, meter boundary, unit confirmation, missing intervals, meter resets,
  maintenance periods, and known manual corrections.
- A named technical contact willing to review the generated aggregate profile.

Data handling:

- Raw files remain private and are excluded from Git.
- Each file is hashed; completeness and chronology are checked automatically.
- Every fifth day/event is withheld for out-of-sample validation.
- The public demo receives only an authorized derived 96-slot profile,
  restoration distribution, quality metrics, disclosure, and fingerprint.
- The source organization controls whether it may be named publicly.
