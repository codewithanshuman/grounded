# GitHub and Vercel release runbook

Repository: https://github.com/anshumanbahekar/grounded

## Push the verified source to GitHub

This checkout now uses GitHub as `origin`; the earlier Sites source remote is
preserved as `sites`:

```bash
git push origin main
```

On a fresh checkout, clone GitHub normally:

```bash
git clone https://github.com/anshumanbahekar/grounded.git
```

Do not force-push. If GitHub already contains unrelated commits, stop and
inspect `git log --oneline --all --decorate --graph` before merging histories.

## Import into Vercel

1. In Vercel, choose **Add New → Project** and import `anshumanbahekar/grounded`.
2. Keep the project root as the repository root.
3. Vercel will read `vercel.json`; do not override its build command or output
   directory.
4. Deploy, then run the production judge path at the generated HTTPS URL.

Current verified production alias:
https://grounded-peach.vercel.app

CLI alternative using the repository's pnpm toolchain:

```bash
pnpm dlx vercel@latest login
pnpm dlx vercel@latest link
pnpm dlx vercel@latest --prod
```

The Vercel deployment is the read-only browser-engine showcase. Private
facility exports must be commissioned locally or on the authenticated server
build; the public static site deliberately refuses telemetry uploads.
