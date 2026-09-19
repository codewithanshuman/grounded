# Grounded partner-validation workspace

This directory turns a real organizational reply and facility export into an
auditable evidence package. It does not create or imply a partnership.

## Evidence states

1. `DRAFT` — outreach prepared but not sent.
2. `CONTACTED` — dated sent-message record exists.
3. `ACKNOWLEDGED` — a named organizational contact replied.
4. `REVIEWED` — the contact reviewed the model boundary or signed the
   attestation.
5. `COMMISSIONED` — authorized telemetry passed the automated quality gate and
   produced a fingerprinted site profile.

Only publish the highest state supported by retained evidence. A phone number,
generic inbox, delivery receipt, or unanswered message is not human
validation.

## Private inbox contract

Place these files in `validation/inbox/`; that directory is ignored by Git:

- `manifest.json` based on `telemetry-manifest.template.json`
- `demand.csv` with `timestamp,demand_kw`
- `pv.csv` with `timestamp,pv_kw`
- `outages.csv` with `outage_started_at,restored_at,cause`
- optional `partner-attestation.pdf` or retained email export

Run `pnpm validate:partner`. The validator checks consent metadata, file
identity, time ranges, interval cadence, duplicates, completeness, timezone,
PV capacity, outage chronology, and SHA-256 hashes. Passing this gate means the
package is structurally usable; it does not certify meter accuracy or legal
authority.

Never commit raw operational exports, email addresses, signatures, or private
correspondence. Publish only an authorized derived profile and its fingerprint.
