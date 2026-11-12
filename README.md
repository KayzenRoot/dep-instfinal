# DIF Studio

DIF Studio is a private, single-owner workspace for planning, writing, and packaging interactive analog-horror episodes for TikTok and Instagram. It supports a manual production workflow with Google Flow and CapCut; it does not generate video or publish to social platforms.

## Requirements

- Node.js 24 or newer
- npm 11 or newer
- A dedicated Supabase project for authenticated, persistent use
- A dedicated Cloudinary account for private image upload and delivery

Supabase Auth and PostgreSQL are required to enter the studio and persist story data. There is no SQLite or offline persistence. Manual writing works without an AI provider; missing Cloudinary settings disable image operations but do not block text editing after Supabase is configured. Public signup is disabled.

## Local setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`.
3. Select a dedicated Supabase project, apply `supabase/migrations`, and create the one owner through the official Supabase Auth dashboard/admin flow. Do not reuse another app's project implicitly.
4. Add the project URL and publishable/anon key to `.env`, then run `node scripts/set-owner-uid.mjs <AUTH_USER_UUID>` to set the owner allowlist UID without displaying credentials.
5. Set Cloudinary server-only credentials when private image upload/delivery is available on the selected plan.
6. Start the app with `npm run dev`.

See [operations and recovery](docs/OPERATIONS.md) for migration, private media, and backup guidance. Never commit `.env`, put a service-role key in the app, or expose credentials in logs.

## Validation commands

```sh
npm run check:baseline
npm run test:db
npm run test:e2e
```

`npm run test:e2e` covers setup mode and anonymous boundaries. For owner authentication and persistence, start the local Supabase stack with `supabase start`, then run `npm run test:e2e:local`. This local-only runner creates random synthetic test identities and never sends its local service-role key to the app or browser.

## Product boundaries

- Supabase PostgreSQL is the source of truth; every exposed table is owner-scoped with RLS.
- Cloudinary stores image bytes; PostgreSQL stores metadata and associations.
- AI, Google Flow, voting collection, and social publishing stay manual unless a separately authorized official integration is configured.
- No cloud project, paid service, deployment, merge, or external account was provisioned by this Work Order.

The approved scope, issue map, and acceptance criteria are in [the Source Pack](docs/SOURCE_PACK.md). The current implementation evidence and blocked checks are in [the Evidence Bundle](docs/EVIDENCE_BUNDLE.md).
