# Checkpoint Delta — CD05

- **Work Order:** `DIF-MVP-ALL-001`
- **Repository / branch / PR:** `KayzenRoot/dep-instfinal` / `feat/dif-studio-mvp-001` / Draft PR #14
- **CD05 base HEAD revalidated:** `b78609d9f0e3a32773733df6c3303edf994c7b0c`
- **CD05 implementation commit:** `b89240f061d9976a0a7db28003d63d5daf977dfe`
- **Hosted CI for CD05:** NOT RUN YET
- **Status:** **PROPOSED — NOT PROMOTED**
- **Proposed verdict:** **BLOCKED — Work Order not complete**

## CD05 delta

1. Live acceptance was executed against the dedicated Supabase project `dif` (`zottgifcocnjguhmnezx`, us-east-1) and the Cloudinary environment `dt4qdzuus`. The four migrations were applied through the Management API: 14 public tables, 50 policies, 22 functions, and RLS on all 14 tables. The owner `owner@dif.local` was created with `app_metadata.dif_studio_owner=true` (UID `75a301f7-c0ee-4bd9-863e-95d42b7037b0`); password login returned 200 and the owner-scoped REST read returned 200 `[]`.
2. A real 64×64 PNG was uploaded through the application: the record reached `READY` with Cloudinary `asset_id`, version, dimensions, byte size, and SHA-256. Owner delivery returned 200/235 bytes with `private, no-store`; the same route without a session returned 401; the raw unsigned Cloudinary URL returned 401; a signed URL returned 200 before `expires_at` and 401 after expiry.
3. Rejections and failure preservation passed live: invalid bytes returned 415, a 10 MiB + 1 byte upload returned 413, and an upload with a deliberately invalid Cloudinary secret preserved an `ORPHANED` record with `CLOUDINARY_UPLOAD_OUTCOME_UNKNOWN` instead of marking it `READY`.
4. Live reconciliation exposed an error-shape bug: `cloudinary.api.resource` rejects with a nested `{ error: { http_code: 404 } }`, but the route only recognized a top-level `http_code`. The missing object remained `ORPHANED` instead of `FAILED`. Commit `b89240f` handles both shapes and the unit fixture now uses the real nested shape. A rerun produced `FAILED` / `CLOUDINARY_ASSET_NOT_FOUND`; a real object that was `ORPHANED` reconciled to `READY`.
5. A disposable authenticated user without the owner claim read `[]` from `series` and `media_assets` and received 403 (`42501`) on insert; the probe user was deleted. Authenticated ZIP export returned 29 entries, including the private PNG and empty `missing_frames.json`, with 15 contiguous SRT segments.
6. Local `npm test` 23/23, `npm run typecheck` (0 errors/warnings), `npm run lint`, `npm run build`, and `npm run audit:policy` (15 invariants) passed after the fix.
7. Backup/restore remains **NOT RUN**: the Free plan shows no scheduled backups and no external restore target was provisioned. Independent review remains pending. Hosted CI has not yet run on `b89240f`; it is required before promotion.

## Historical CD04 header

- **CD04 base HEAD revalidated:** `34ab6b7c9156de054dfd4969e761d456cc4890c4`
- **CD04 implementation commit:** `3c560489788d0c1efaf16dd26d81b709daad4406`
- **CD04 final code/test HEAD:** `45840f9199783c251c4da8b10bff3fcda14de629`
- **Hosted PR CI:** [run `42898556365`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42898556365) — PASS
- **Hosted push CI:** [run `42898547547`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42898547547) — PASS
- **Status:** **PROPOSED — NOT PROMOTED**
- **Proposed verdict:** **BLOCKED — Work Order not complete**

## CD04 delta

1. `assert_episode_publication_allowed` now rejects publication of every episode numbered above 1 when its immediately preceding episode is absent. The PostgreSQL assertion is shared by `set_episode_status` and direct status-transition triggers. Episode 1 remains publishable without a predecessor.
2. Draft creation, edits, and imports remain available outside sequence. They do not update canon. The UI explains that the immediately preceding episode must be created and published before the continuation can publish.
3. When the predecessor exists and requires a vote, CD03 validation remains unchanged: closed and verified poll, latest verified result with a valid winner, and explicit author approval for that exact result and episode. Out-of-order publication becomes possible only after the missing predecessor is published and its continuity is valid.
4. PgTAP and authenticated E2E cover editable out-of-order drafts, missing-predecessor rejection through RPC and direct PostgreSQL update, publication after valid continuity, the complete episode 1–10 chain, and episode 10 import/publication with no choices or own vote. Other episodes retain two distinct choices.
5. CD01–CD03 owner protection, manual verified voting, explicit append-only canon, hypothetical branches, context/export, and vote-free finale behavior remain covered.

## CD04 validation

- Hosted PR CI `42898556365` and push CI `42898547547`: **PASS** on code/test HEAD `45840f9`. Hosted baseline passed; PgTAP reported **20 tests, PASS**; authenticated Playwright reported **8 passed** with the owner continuity journey completed in 1.6 minutes. No E2E retries were reported.
- The earlier CI attempt at `3c56048` failed because the PgTAP fixture tried to transition an already-`READY` out-of-order episode to `READY` again. The duplicate transition was removed; the complete CI passed at `45840f9`.
- Local `npm run lint`, `npm run typecheck` (0 Svelte errors/warnings), `npm test` (**23/23**), `npm run build`, and `npm run audit:policy` (**15 invariants**) passed. `npm run audit:deps` exited successfully at the configured high threshold and listed four LOW transitive `deepmerge` advisories.
- Local `npm run check:baseline` stops at Windows `format:check`, which reports 13 pre-existing files. The hosted baseline passed. Local PgTAP and authenticated E2E could not run because the Supabase stack was not active at `127.0.0.1:54322`; the hosted database and authenticated E2E passed.

## Gate

CD05 records live Supabase and Cloudinary acceptance, including private delivery, rejection, failure preservation, reconciliation, cross-owner denial, and ZIP export with media. External backup/restore and independent review remain essential pending gates, and hosted CI has not yet run on `b89240f`. The Work Order and release are not complete. Keep PR #14 open and Draft; keep this checkpoint **PROPOSED — NOT PROMOTED** with verdict **BLOCKED**. No merge, deployment, spend, external provisioning, or checkpoint promotion occurred.

CD01–CD04 history remains in `docs/CONTEXT_LOCK.md`; detailed evidence is in `docs/EVIDENCE_BUNDLE.md`.
