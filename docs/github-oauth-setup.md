# Grounded GitHub OAuth activation

The application already contains the GitHub OAuth client, authenticated world bootstrap, row-level-security policies, cloud persistence, and local fallback. Complete these external steps to activate cloud accounts on production.

## 1. Create the Supabase project

Create a project at Supabase with the Data API and automatic RLS enabled, but
leave **Automatically expose new tables** disabled. Open the SQL editor and
run:

`supabase/migrations/20260923000000_grounded_worlds.sql`

This creates one private world per authenticated user, explicitly grants only
the required operations to authenticated clients, and grants nothing to the
anonymous role. Row-level security restricts every read, insert, and update to
`auth.uid() = user_id`.

## 2. Register the GitHub OAuth application

In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.

- Application name: `Grounded Jaipur Resilience`
- Homepage URL: `https://grounded-peach.vercel.app`
- Authorization callback URL: copy the exact callback shown in **Supabase → Authentication → Providers → GitHub**. It has the form `https://PROJECT_REF.supabase.co/auth/v1/callback`.
- Device Flow: disabled

Generate a client secret. Put the GitHub Client ID and Client Secret only in the Supabase GitHub provider screen. Do not put the GitHub secret in Vercel, browser code, chat, or Git.

## 3. Configure Supabase redirect URLs

In **Supabase → Authentication → URL Configuration**:

- Site URL: `https://grounded-peach.vercel.app`
- Redirect URL: `https://grounded-peach.vercel.app/**`
- Optional local redirect: `http://localhost:5173/**`

## 4. Add the two publishable Vercel variables

In **Vercel → Grounded → Settings → Environment Variables**, add for Production and Preview:

- `VITE_SUPABASE_URL`: the Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key

These two values are designed to be public in browser applications. Never use a Supabase service-role key in this project.

Redeploy the latest `main` commit. The account panel will automatically switch from the device-local pilot to **Continue with GitHub**.

## Verification checklist

1. Sign in through GitHub and return to Grounded.
2. Confirm a new row exists in `public.grounded_worlds` for the authenticated user.
3. Run one simulation and confirm the row's `state` and `updated_at` change.
4. Open a private/incognito browser, sign in with the same GitHub account, and confirm the same tree/building counts load.
5. Sign in with a second GitHub account and confirm it cannot read the first account's world.
