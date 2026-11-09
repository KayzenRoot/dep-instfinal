# DIF Studio — setup and operations

## Local development

Requirements: Node.js 24+ and npm 11+. Use the lockfile-backed install (`npm ci`), then `npm run dev`. The app runs as a Node SSR service; do not expose it to a public network without HTTPS, an explicitly configured trusted proxy, and owner-only review.

Copy `.env.example` to `.env` and configure a dedicated Supabase project and Cloudinary account only when the owner selects them. Never commit `.env` or share secret values in chat. Without credentials the app stays in clearly labeled setup/manual mode. There is no local substitute database presented as production persistence.

## Supabase owner setup

1. Create/select a dedicated project explicitly; this Work Order creates none and does not authorize modifying another app's project.
2. Apply `supabase/migrations` using the official Supabase CLI or dashboard SQL editor; verify RLS is enabled on every exposed table.
3. Create the one owner identity through Supabase Auth's official dashboard/admin flow. Disable public signups in Auth settings. Set its immutable UID in server configuration as `SUPABASE_OWNER_USER_ID`.
4. Configure only the project URL and publishable/anon key in the app environment. Do not configure service-role keys in this app.
5. Set approved redirect URLs for the local origin and, when separately authorized, the eventual HTTPS host. Use Supabase's official recovery flow; revoke sessions after account recovery.
6. Run the security tests against a dedicated test project or local Supabase stack before enabling real data.

## Cloudinary setup

Set the cloud name, API key and API secret in server-only environment variables. Use a dedicated Cloudinary product environment and authenticated image delivery. Verify private delivery and any derived thumbnail/crop access on the chosen plan before importing private story frames. The app does not silently make assets public if authenticated delivery is unavailable.

## Backups and recovery

- Back up Postgres with the official `pg_dump`/Supabase backup mechanism for the selected project and separately export the app's owner metadata manifest.
- Record Cloudinary `asset_id`, `public_id`, resource/delivery type, dimensions, size, version, associations and content hash in the manifest; image bytes remain in Cloudinary.
- Store encrypted backups in an owner-controlled location outside the repository, restrict access, and document retention.
- Restore into a dedicated test project first; apply migrations, restore Postgres, then reconcile every manifest entry against Cloudinary. Verify an episode, its scene references and its images before replacing any live data.
- The supplied Work Order does not provision backup storage or guarantee automatic backups on a free tier.

## Production checklist (future only)

Production hosting is not provisioned by this Work Order. Before a separate deployment authorization, select a Node host, configure TLS and strict trusted-proxy behavior, secure env secrets, set exact Supabase redirect URLs, test owner auth/RLS and Cloudinary authenticated delivery, review backups, and run the release Evidence Bundle. Do not deploy from this branch automatically.
