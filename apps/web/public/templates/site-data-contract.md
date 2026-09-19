# Grounded site commissioning CSV contract

Upload three UTF-8 CSV files. Use ISO 8601 timestamps with the site UTC offset.
At least 30 continuous days of 15-minute demand and PV readings are recommended.

## Demand

`timestamp,demand_kw`

## PV

`timestamp,pv_kw`

## Outages

`outage_started_at,restored_at,cause`

Grounded measures completeness, withholds every fifth day/event for validation,
and fingerprints every normalized value. Incomplete inputs are marked `REVIEW`.

