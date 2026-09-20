# Difficult judge questions — concise answers

## “Is this Jaipur data?”

No. Jaipur climate is calibrated from NASA POWER; the default operational layer
is a measured Ausgrid reference cohort. The interface labels the cross-region
combination explicitly. The commissioning panel accepts local site exports and
creates a separate `COMMISSIONED_SITE` profile.

## “Why trust the optimizer?”

It cannot evaluate and validate on the same seeds. It searches 245 policies on
an independent discovery cohort, then uses the original population, three
disjoint holdouts, exact paired inference, four single-factor shocks, an 81-cell
compound stress envelope and historical-climate replay. It also reranks the
Pareto finalists on every holdout and discloses rank and regret. The before/after
proof reuses the exact same failure seed.

## “Does the recommended policy always remain the best?”

Grounded does not hide that uncertainty. It reruns every discovered Pareto
finalist on three untouched cohorts and reports the chosen policy's rank, the
winning alternative and maximum risk regret. This is shortlist stability—not a
claim that every possible real-world control policy has been evaluated.

## “Are the results reproducible?”

Yes. Model version, configuration, intervention, scenario count, seed scheme,
climate fingerprint and site-data fingerprint create the run fingerprint.
Identical inputs reproduce identical outputs and this is a machine audit check.

## “Is it an AI prediction?”

No opaque model decides the result. Grounded is a transparent stochastic
engineering simulation with deterministic random seeds. Its uncertainty comes
from disclosed distributions and measured profiles.

## “Can a hospital buy equipment from this?”

No. Grounded is decision support for exploring risk and operating strategies.
Procurement still requires local measurements and certified power-system,
protection and safety engineering.

## “What happens when the internet fails during judging?”

Climate calibration is cached, the operational profile is bundled, the engine
runs locally, and the production container exposes a health check. Keep the
backup video and screenshots specified in the demo runbook.
