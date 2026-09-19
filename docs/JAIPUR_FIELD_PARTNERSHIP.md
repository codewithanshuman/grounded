# Grounded Jaipur field partnership packet

## Evidence status

Grounded has a real Jaipur facility anchor, but it does not yet claim a formal
partnership or commissioned interval dataset.

The published 2025–26 impact assessment for Rajkiya Dharamshala at Sawai Man
Singh Hospital documents a 70 kWp on-grid solar installation, approximately 80%
of site energy demand supplied by solar, and a reported monthly electricity-bill
reduction from about ₹90,000 to about ₹40,000. The assessment used project
records, field visits, stakeholder surveys and interviews with the CMO office
and operations team. It does not publish 15-minute demand, inverter production,
or outage/restoration telemetry.

Primary source: https://www.aavas.in/img/pdf/solar-power-plants-in-government-hospitals-2025-26.pdf
(facility capacity on page 9, demand share on page 17, Jaipur case study on page
22).

## First-choice collaborators

1. **Aavas Foundation / Aavas Financiers CSR team** — the Jaipur-headquartered
   implementing organization behind the hospital solar project. Ask for an
   introduction to the facility operations contact and permission to validate
   aggregate project findings in Grounded.
2. **Rajkiya Dharamshala / SMS Hospital operations or CMO office** — ask for a
   limited, de-identified technical export and a 20-minute review of the model
   boundary.
3. **Gram Bharati Samiti** — a Jaipur organization with environment, community
   health and field-research experience. Ask for community-review support if
   hospital data access takes longer than the hackathon window.

Public contact routes:

- Aavas corporate office: 201–202 Southend Square, Mansarovar Industrial Area,
  Jaipur 302020; 0141-6618888; customercare@aavas.in.
- Rajasthan Health Department Jaipur contact directory:
  https://rajswasthya.rajasthan.gov.in/contact.php
- Gram Bharati Samiti: bskusum@gmail.com; 0141-2530719;
  https://gbsjaipur.org/about/

## Data request

Request only operational data needed for the resilience model. No patient,
staff, billing-account, or personally identifiable data is required.

- 30–90 days of timestamped facility demand at 15-minute resolution.
- Matching solar-inverter or revenue-meter production at 15-minute resolution.
- Outage start and restoration timestamps for the same site boundary.
- Installed PV and battery ratings, if a battery exists.
- Critical-load definition and approximate kW requirement.
- Written confirmation of timezone, meter boundary and any missing intervals.

Grounded will hash the normalized dataset, display completeness and withheld
holdout metrics, and label weak inputs for review. The public demo should use a
derived profile rather than publishing raw operational exports.

## Initial outreach email

**Subject:** Jaipur hospital energy-resilience study — request for a limited
technical validation

Hello,

We are building Grounded, a student climate-resilience digital twin that tests
how a hospital-scale solar, storage and grid system behaves during heat, low
solar output and power outages. We found the published Aavas Foundation impact
assessment for the 70 kWp installation at Rajkiya Dharamshala, SMS Hospital.

We would value a short technical review from the operations or CSR team. We are
requesting no patient information and no confidential financial records. A
de-identified 30-day export of 15-minute facility demand and solar production,
plus outage and restoration timestamps if available, would let us replace our
public reference profile with a quality-gated Jaipur site profile.

We will show the data source, completeness, model limitations and review status
inside the application. We will not present the organization as a partner or
publish the raw data without written permission.

Could you connect us with the appropriate facility engineer, operations contact
or CSR project lead for a 20-minute review?

Thank you,

Grounded project team

## Evidence ladder for the submission

- **Public evidence:** published Jaipur facility case and source pages.
- **Contacted:** dated copy of the outreach message.
- **Acknowledged:** reply from a named organizational contact.
- **Reviewed:** meeting note or signed one-page boundary confirmation.
- **Commissioned:** fingerprinted interval profile and holdout results.

Use only the highest stage actually completed. Never describe outreach as a
partnership.
