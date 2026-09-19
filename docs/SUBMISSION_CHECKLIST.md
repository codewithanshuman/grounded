# Submission freeze checklist

- [ ] Replace placeholder team/event metadata in the submission portal.
- [ ] Deploy the container to the chosen host and persist `/data`.
- [ ] Set the public HTTPS origin in `ALLOWED_ORIGINS`.
- [ ] Verify `/api/health` and run the Playwright judge path against production.
- [ ] If local site exports are available, commission them and archive their
      source fingerprint; otherwise retain the explicit reference-cohort label.
- [ ] Record the three-minute demo and 45-second fallback.
- [ ] Capture Method, Risk, Strategy and Proof screenshots.
- [ ] Rehearse the answers in `JUDGE_QA.md` without overstating the model.
- [ ] Freeze features 24 hours before judging; accept only verified bug fixes.
- [ ] Run `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm build`.

