# Submission freeze checklist

Current status is deliberately evidence-based. A checked item must have a
retained artifact, live verification, or automated result.

- [ ] Replace placeholder team/event metadata in the submission portal.
- [x] Publish and smoke-test the read-only browser-engine demo over public HTTPS.
- [ ] Push commit to `https://github.com/anshumanbahekar/grounded`.
- [ ] Import the GitHub repository into Vercel and verify the generated URL.
- [ ] If deploying the stateful server build, persist `/data`, configure
      `ALLOWED_ORIGINS`, and verify `/api/health` separately.
- [ ] If local site exports are available, commission them and archive their
      source fingerprint; otherwise retain the explicit reference-cohort label.
- [ ] Send the prepared Jaipur outreach from a real team mailbox and retain the
      sent-message record.
- [ ] Obtain a named reply before using `ACKNOWLEDGED`, `REVIEWED`, or
      `PARTNER` language.
- [ ] Run `pnpm validate:partner` before processing any operational exports.
- [ ] Record the three-minute demo and 45-second fallback.
- [ ] Capture Method, Risk, Strategy and Proof screenshots.
- [ ] Rehearse the answers in `JUDGE_QA.md` without overstating the model.
- [ ] Freeze features 24 hours before judging; accept only verified bug fixes.
- [ ] Run `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and
      `pnpm build:static` on the final commit.
