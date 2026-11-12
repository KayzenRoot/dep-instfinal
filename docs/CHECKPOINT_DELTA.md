# Checkpoint Delta — CD06

## DIF-REL-001 / CD07 proposed checkpoint delta (2026-11-12)

- **Status:** PROPOSED — NOT PROMOTED pending full CI and independent audit of the final branch SHA.
- **Objective:** close V1 with approved Gemini narrative generation and robust Flow/CapCut ZIP workflow within Vercel Hobby response limits.
- **Source of truth:** Work Order DIF-MVP-ALL-001, issue #15 DIF-REL-001, Source Pack ADR-DIF-V1-007, latest Evidence Bundle. CD06 historical checkpoints remain below.
- **Delivered:** SvelteKit Vercel production URL, owner-only Supabase Auth/RLS, Cloudinary private media, Gemini 3.5 Flash-Lite validated server-side JSON 120 s + 15 scenes + 2 options + social/Flow prompts; full ZIP with conservative 3 MB media ceiling; lite ZIP with individual owner-checked Cloudinary 180-second original downloads.
- **Live AI acceptance:** `dpl_AQwvQM1XkN1Q6Jh8J1QoJLpV21SW` READY, real Gemini 3.5 Flash-Lite HTTP200 and schema/Zod validated; synthetic storyline, no production data persisted. Real CD06 owner journey validated previously; later extension remains subject to HEAD-wide CI and audit.
- **Risk register:** Cloudinary secret shared in chat (rotation required); Supabase owner recovery email requires safe ownership; short-lived signed links and free quota; Vercel ZIP cap and live model transient errors. No known HIGH/CRITICAL from previous audit; verify latest HEAD.
- **Stop:** do not mark completed, merge or advance V2 until all Definition of Done gates pass. After independent APPROVED and deployment verification, update this section and canonical checkpoint accordingly.

---


- **Work Order:** `DIF-MVP-ALL-001`
- **Repository / branch / PR:** `KayzenRoot/dep-instfinal` / `feat/dif-studio-mvp-001` / Draft PR #14
- **CD06 base HEAD revalidated:** `d5e43f258101af8388d030554c6ca9c0084d7309`
- **CD06 implementation commit:** `218f18f74e7720105d136c2fa3f0546ba789e9fd`
- **CD06 final code/test HEAD:** `b23d40c71272d17707120ee76e624dd422775859`
- **CD06 hosted CI:** [PR `43080981120`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43080981120) and [push `43080968791`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43080968791) — PASS (PgTAP 28 tests; E2E 9 passed in 2.3 minutes, no retry)
- **CD06 independent review:** **APPROVED** by a separate reviewer agent; no HIGH/CRITICAL findings remain
- **Status:** **PROPOSED — NOT PROMOTED**
- **Proposed verdict:** **APPROVED — ready for owner promotion**

## CD06 delta

1. Scene production: episodes now store `scene_duration_ms` (4/6/8 s), scenes store `location`, `character_notes`, `vhs_effects`, `transition`, `prompt_status` (TODO/READY/GENERATED/APPROVED) and `generation_attempts`. `set_episode_scene_duration` rebuilds only an empty draft timeline and rejects any content/frames/references; `save_scene_production` saves owner-scoped direction only for unpublished scenes.
2. Ordering: `swap_scene_order` swaps adjacent scenes through the now-deferrable unique constraint and recalculates the fixed-duration timeline. PgTAP validates ids and timings; live RPC returned 204.
3. Continuity: deterministic warnings flag DECEASED/MISSING/ARCHIVED characters and SUPERSEDED/ARCHIVED lore titles found in the episode text. Canon approval is blocked until the owner confirms the review when warnings exist; `canonical_decisions.continuity_review` stores the reviewed warnings, timestamp, and owner.
4. Platform/production: episode metadata now carries target platforms, aspect preset, per-channel covers/hashtags, AI disclosure, effects/assembly notes, credit model and per-clip estimate. The UI exposes them; the ZIP adds `production/assembly-manifest.md`, `production/checklist.md`, `social/hashtags.txt`, and `social/ai-disclosure.txt`, and the manifest includes the production block and honest warnings.
5. Library: signed server-side derived variants `thumb`, `4x5`, and `3x4` are streamed only through the owner route; the library shows side-by-side comparison and a proportion warning. Live variants returned 123/144/146 bytes with `private, no-store`; invalid variant returned 400.
6. Backup/restore: all 14 public tables and the owner UUID were exported logically and restored into a dedicated local Supabase target with the same owner UID. Counts matched, owner login returned 200, anonymous REST returned 401, and the restored READY Cloudinary asset returned 235 bytes with a matching SHA-256.
7. Tests: unit 28/28, typecheck 0 errors/warnings, lint pass, PgTAP 28/28 local and hosted (8 new CD06 assertions), responsive screenshots at 360/768/1440 for index and detail pages, and hosted E2E 9/9 in 2.3 minutes with no retry. Local Windows E2E was slow and flaky while reusing a stale dev server; the hosted workflow is the authoritative E2E evidence. A separate reviewer agent returned **APPROVED** after the HIGH/MEDIUM corrections in `08a4567`; only three LOW residuals remain documented in the Evidence Bundle.

## Historical CD05 header

- **CD05 base HEAD revalidated:** `b78609d9f0e3a32773733df6c3303edf994c7b0c`
- **CD05 reconciliation fix:** `b89240f061d9976a0a7db28003d63d5daf977dfe`
- **CD05 final code/test HEAD:** `852b970c03f38233b6e02e6af308dbd01bef5b72`
- **CD05 documentation/helper HEAD:** `e47ecaa6a4207fbbc66519bde10121026e1eadcb` — hosted CI PASS ([PR `43041393787`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43041393787), [push `43041387125`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43041387125))
- **Hosted PR CI:** [run `43038342557`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43038342557) — PASS
- **Hosted push CI:** [run `43038328934`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43038328934) — PASS
- **Status:** **PROPOSED — NOT PROMOTED**
- **Proposed verdict:** **BLOCKED — Work Order not complete**

## CD05 delta

1. Live acceptance was executed against the dedicated Supabase project `dif` (`zottgifcocnjguhmnezx`, us-east-1) and the Cloudinary environment `dt4qdzuus`. The four migrations were applied through the Management API: 14 public tables, 50 policies, 22 functions, and RLS on all 14 tables. The owner `owner@dif.local` was created with `app_metadata.dif_studio_owner=true` (UID `75a301f7-c0ee-4bd9-863e-95d42b7037b0`); password login returned 200 and the owner-scoped REST read returned 200 `[]`.
2. A real 64×64 PNG was uploaded through the application: the record reached `READY` with Cloudinary `asset_id`, version, dimensions, byte size, and SHA-256. Owner delivery returned 200/235 bytes with `private, no-store`; the same route without a session returned 401; the raw unsigned Cloudinary URL returned 401; a signed URL returned 200 before `expires_at` and 401 after expiry.
3. Rejections and failure preservation passed live: invalid bytes returned 415, a 10 MiB + 1 byte upload returned 413, and an upload with a deliberately invalid Cloudinary secret preserved an `ORPHANED` record with `CLOUDINARY_UPLOAD_OUTCOME_UNKNOWN` instead of marking it `READY`.
4. Live reconciliation exposed an error-shape bug: `cloudinary.api.resource` rejects with a nested `{ error: { http_code: 404 } }`, but the route only recognized a top-level `http_code`. The missing object remained `ORPHANED` instead of `FAILED`. Commit `b89240f` handles both shapes and the unit fixture now uses the real nested shape. A rerun produced `FAILED` / `CLOUDINARY_ASSET_NOT_FOUND`; a real object that was `ORPHANED` reconciled to `READY`.
5. A disposable authenticated user without the owner claim read `[]` from `series` and `media_assets` and received 403 (`42501`) on insert; the probe user was deleted. Authenticated ZIP export returned 29 entries, including the private PNG and empty `missing_frames.json`, with 15 contiguous SRT segments.
6. Local `npm test` 23/23, `npm run typecheck` (0 errors/warnings), `npm run lint`, `npm run build`, and `npm run audit:policy` (15 invariants) passed after the fix. Hosted PR CI `43038342557` and push CI `43038328934` passed at final code/test HEAD `852b970`: baseline, PgTAP (20 tests), and authenticated E2E (8 passed in 1.9 minutes). The earlier attempts at `388577e` failed only because the runner could not resolve the Ubuntu package mirrors during the Playwright `--with-deps` step; the workflow was stabilized by pinning `ubuntu-24.04` and installing Chromium without the apt dependency.
7. Backup/restore remains **NOT RUN**: the Free plan shows no scheduled backups and no external restore target was provisioned. Independent review remains pending.
8. A temporary owner-authorized Cloudflare quick tunnel was validated for public access: health/login 200, anonymous app redirect, anonymous media 401, owner media 200 with `private, no-store`, and authenticated ZIP export 200. The URL is ephemeral, has no Cloudflare Access policy, and requires the local machine and server to stay online. It is not a production release.

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

CD06 closes the functional gaps for issues #3, #6, #8, #9, #11, and #12 and records a real logical backup/restore for #4/#13: restored counts matched, owner login returned 200, anonymous REST returned 401, and the restored Cloudinary asset hash matched. Hosted PR `43080981120` and push `43080968791` passed at final code/test HEAD `b23d40c` (PgTAP 28 tests; E2E 9 passed in 2.3 minutes, no retry); unit tests are 28/28. The independent reviewer agent returned **APPROVED** with no HIGH/CRITICAL findings; three LOW residuals are documented. The temporary Cloudflare quick tunnel remains an owner-authorized private exposure, not a production deployment. Keep PR #14 open and Draft; keep this checkpoint **PROPOSED — NOT PROMOTED** with proposed verdict **APPROVED — ready for owner promotion**. No merge, production deployment, paid spend, new external project, or checkpoint promotion occurred.

CD01–CD05 history remains in `docs/CONTEXT_LOCK.md`; detailed evidence is in `docs/EVIDENCE_BUNDLE.md`.
