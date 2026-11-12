# DIF Studio — setup and operations

## Local development

Requirements: Node.js 24+ and npm 11+. Use the lockfile-backed install (`npm ci`), then `npm run dev`. The app runs as a Node SSR service; do not expose it to a public network without HTTPS, an explicitly configured trusted proxy, and owner-only review.

Copy `.env.example` to `.env` and configure a dedicated Supabase project and Cloudinary account only when the owner selects them. Never commit `.env` or share secret values in chat. Without Supabase credentials the app stays on its setup/login surface; there is no local substitute database or offline persistence. Once Supabase is configured, manual story editing works without AI. Missing Cloudinary configuration blocks image upload/private delivery while leaving text editing available.

## Supabase owner setup

1. Create/select a dedicated project explicitly; this Work Order creates none and does not authorize modifying another app's project.
2. Apply `supabase/migrations` using the official Supabase CLI or dashboard SQL editor; verify RLS is enabled on every exposed table.
3. Create the one owner identity through Supabase Auth's official dashboard/admin flow. Disable public signups in Auth settings. In the user's **App Metadata** (not editable User Metadata), set `dif_studio_owner` to boolean `true`; do not set this claim on any other identity. RLS on every exposed table requires this signed Auth claim as well as `owner_id = auth.uid()`, so an authenticated identity without it cannot read or create even its own rows through the Data API. Set the same user's immutable UID with `node scripts/set-owner-uid.mjs <AUTH_USER_UUID>`; the script writes only the UID to `.env`, does not display credentials, and refuses symbolic links or duplicate UID entries.
4. Configure only the project URL and publishable/anon key in the app environment. Do not configure service-role keys in this app.
5. Set approved redirect URLs for the local origin and, when separately authorized, the eventual HTTPS host. After changing App Metadata, refresh/revoke existing sessions so new access tokens contain the signed owner claim. Use Supabase's official recovery flow; revoke sessions after account recovery.
6. Run `supabase start`, then `npm run test:db` and `npm run test:e2e:local` against the local Supabase stack before enabling real data. The E2E wrapper rejects non-local URLs and creates disposable synthetic users with the local admin key; that key is never passed to the app or browser.

## Cloudinary setup

Set the cloud name, API key and API secret in server-only environment variables. Use a dedicated Cloudinary product environment and authenticated image delivery. Verify private delivery and any derived thumbnail/crop access on the chosen plan before importing private story frames. The app does not silently make assets public if authenticated delivery is unavailable.

## Backups and recovery

- Back up Postgres with the official `pg_dump`/Supabase backup mechanism for the selected project and separately export the app's owner metadata manifest.
- Record Cloudinary `asset_id`, `public_id`, resource/delivery type, dimensions, size, version, associations and content hash in the manifest; image bytes remain in Cloudinary.
- Store encrypted backups in an owner-controlled location outside the repository, restrict access, and document retention.
- Restore into a dedicated test project first; apply migrations, restore Postgres, then reconcile every manifest entry against Cloudinary. Verify an episode, its scene references and its images before replacing any live data.
- The supplied Work Order does not provision backup storage or guarantee automatic backups on a free tier.

### Verified logical backup and restore (2026-11-11)

The Free project was backed up without relying on provider snapshots:

1. Export every public table with `select coalesce(json_agg(to_jsonb(t) order by t.id), '[]'::json)` through the Supabase Management API, plus the owner identity metadata (never the password hash) to an owner-controlled file outside the repository.
2. Provision a dedicated restore target with the migrations applied. Insert the owner into `auth.users` with the original UUID and `app_metadata.dif_studio_owner=true`; re-provision the password instead of restoring a hash.
3. Restore public rows in dependency order (series → seasons → characters/lore → episodes → revisions → media metadata → scenes → choices → polls → results → canon → references → jobs) inside a transaction with `session_replication_role = replica` to avoid publication-trigger interference.
4. Verify per-table row counts, owner password login, owner-scoped REST reads, anonymous rejection, and every restored `READY` media `public_id`/SHA-256 against Cloudinary. Reconcile any missing or mismatched object before replacing live data.
5. Store the backup encrypted, restrict access, record retention, and repeat the restore into a disposable target after schema changes.

This procedure was executed against the hosted `dif` project and a local Supabase target on 2026-11-11; the restored counts matched the export, the owner login returned 200, anonymous REST returned 401, and the private Cloudinary image returned 235 bytes with a matching SHA-256. Auth passwords are intentionally re-provisioned, not copied from the backup.

## Temporary public access via Cloudflare Tunnel (owner-authorized)

The owner may expose the local production server through a free Cloudflare quick tunnel for private use:

```sh
npm run build
npm run serve:tunnel
```

`scripts/serve-tunnel.mjs` starts `cloudflared tunnel --url http://127.0.0.1:3000`, reads the generated `https://*.trycloudflare.com` URL, and starts `node --env-file=.env build` with `APP_ORIGIN`/`ORIGIN` set to that URL plus `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`. The script prints the public URL and stops both processes together.

Limits and security:

- The URL is **ephemeral** and changes whenever the tunnel restarts. It requires this machine, the server, and `cloudflared` to stay online.
- A quick tunnel has **no Cloudflare Access policy**. The app still enforces owner login, owner-scoped RLS, CSRF checks, private media and `no-store`, but the login surface is reachable from the internet. Use a long unique owner password and keep the URL private.
- In-memory rate limiting is per server process; it is not a distributed edge control.
- For durable public access, create a named Cloudflare Tunnel with a Cloudflare-managed domain, place Cloudflare Access in front of it, and set exact Supabase redirect URLs. That durable setup was not provisioned.
- This is not a production release, merge, or checkpoint promotion; `main` remains untouched.

## Production checklist (future only)

Production hosting is not provisioned by this Work Order. Before a separate deployment authorization, select a Node host, configure TLS and strict trusted-proxy behavior, secure env secrets, set exact Supabase redirect URLs, test owner auth/RLS and Cloudinary authenticated delivery, review backups, and run the release Evidence Bundle. Do not deploy from this branch automatically.


## Current Vercel V1 operations (DIF-REL-001, 2026-11-12)

- **Production:** https://dif-studio.vercel.app, official free `vercel.app` URL, no custom domain. Use Node 24, SvelteKit Vercel adapter for serverless SSR. The Vercel production deployment is reconciled to the merged `main` SHA after passing release gates.
- **Required Vercel Production environment names:** `APP_ORIGIN=https://dif-studio.vercel.app`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_OWNER_USER_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `GEMINI_API_KEY`. Secrets are stored as sensitive/encrypted variables and are never printed, committed or returned to the browser. Redeploy after any variable change.
- **Supabase:** only one owner with a signed `app_metadata.dif_studio_owner=true` claim; registration remains disabled. Apply SQL migrations only to the dedicated DIF project and validate data authorization with PgTAP. Check that the owner can receive password-recovery mail, and revoke sessions after credential recovery.
- **AI acceptance:** verify the selected Gemini model and schema with `RUN_LIVE_AI_TEST=1 npx vitest run src/lib/server/ai-episode.live.test.ts` in an authorized environment that has `GEMINI_API_KEY`. The skipped-by-default test uses synthetic context, prints only request result metadata and verifies 120 s / 15 Flow scenes / two branches. Never run it in ordinary CI with private production secrets or publish response bodies. Do not automatically retry errors in ways that bypass free usage caps.
- **Exports:** use the full ZIP only for frames adding up to 3,000,000 raw bytes. If HTTP 413 is returned, select **ZIP leve**. The lightweight ZIP includes all scripts, production prompts, captions/SRT, platform metadata and a `media/download-originals.md` map. Open each listed `/api/media/[assetId]?download=1` URL while authenticated; the route verifies owner access and redirects to a 180-second signed Cloudinary original. Keep export packages and signed links private. The existing ZIP never renders finished video or posts to TikTok/Instagram.
- **Deployment release:** make branch PR READY only after full CI and independent audit. Squash merge with expected HEAD, deploy the merge commit on `main` to Production, confirm Vercel `READY` on exactly that SHA and verify HTTPS `/health`, `/login`, private route denial, owner login, Gemini generation, editable import, 15 scenes, media downloads and ZIP. Roll back Vercel alias to previous `READY` deployment if new version fails post-deploy; restore database from tested logical backup only if approved and necessary.
- **Security maintenance:** rotate the Cloudinary API secret previously exposed in the chat directly in Cloudinary, update the Vercel sensitive variable, redeploy and retest signed media; never place secret literals in tickets, docs or output. Track moderate/low transitive dependency advisories; no bypass of HIGH/CRITICAL defects. Database backups and ZIP size caps remain required.
