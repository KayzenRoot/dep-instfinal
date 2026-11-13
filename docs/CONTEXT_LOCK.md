# Context Lock — DIF-MVP-ALL-001

**Created:** 2026-11-09  
**Repository:** `KayzenRoot/dep-instfinal`  
**Remote:** `https://github.com/KayzenRoot/dep-instfinal.git`  
**Default branch:** `main`  
**Execution branch:** `feat/dif-studio-mvp-001`

## Verified Git state

- Owner-authorized bootstrap commit on `main`: `b4fd54513af749d68bb7bce4c06110cd9981be39`.
- `BASE_SHA`: `b4fd54513af749d68bb7bce4c06110cd9981be39`.
- `HEAD_SHA` at start of implementation: `b4fd54513af749d68bb7bce4c06110cd9981be39`.
- `HEAD_SHA` revalidated at start of CD01: `d7887cfdee219f5b9e081c89e79d4ae61ee0c8f5`; the local branch was clean and exactly matched `origin/feat/dif-studio-mvp-001` before edits.
- The feature branch was created locally from exactly this SHA.
- Initial implementation candidate: `4d220f1e2e045298a93c7186380eb5dddf603f0f`.
- The prior source and workflow passed hosted validation at `c84ab7833f5417c77ea49727e97bc0c52edda94f`; this is historical evidence only and does not validate CD01.
- CD01 correction source commits were pushed to the same feature branch. Hosted CI validated code SHA `89bc16c05912a7b50b47ac3cf2cc3e9b2eef5359`; PR run `42823819918` passed baseline, Supabase startup, PgTAP/RLS, authenticated Data API checks, complete owner E2E (8/8), and artifact upload. The current Draft PR #14 still targets `main`.
- Intermediate hosted runs exposed E2E field-state and locator failures; the assertions/waits were corrected, and the full journey passed on `89bc16c`. A separate earlier run also hit runner port `54322` already in use; later hosted run `42823819918` started the disposable stack and passed.
- Local Supabase remained unavailable: registry pulls were rate limited and the Postgres image extraction ran out of container disk. `npm run test:db` could not connect to `127.0.0.1:54322`; hosted PgTAP/RLS is the successful database evidence.
- CD01's final code SHA was `89bc16c` when its hosted checks completed. The CD01 evidence was reconciled at that point; CD02 has its own validated SHA and reconciliation below.
- CD02 revalidated audit base `a7cfc9edce735bd4d0900ca7de2b9e12c434bab4` on `feat/dif-studio-mvp-001` before edits; it matched the branch tip and the worktree was clean. CD02 implementation/test SHA `68b4f867274e296a52c763851537ebf326f5eb8e` passed hosted PR CI `42833608157` and push CI `42833596156`, including baseline, database/RLS, direct authenticated Data API, and complete authenticated E2E checks. Documentation-only reconciliation after this validated code SHA does not alter the tested application.
- Prior to bootstrap the remote was empty (`git ls-remote` returned no refs), and the workspace was empty. There was no prior code, checkpoint, ADR, workflow, branch, or PR to preserve.
- Base working tree was clean before the feature branch was created.

## Base fingerprints (SHA-256)

| File at base | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `README.md`  | `BB5711B757FDC9B38612F207B5F25CFD485855B424C67AE81AEA4538C2C543DE` |
| `.gitignore` | `599F2C11DEB8C3CA3FB2B948EB5822292C019D502C7F6832E8274CB3219DB629` |

## Canonical sources checked

- User-authorized Work Order: `C:\Users\csn19\Downloads\DIF_Studio_Codex_OneShot.pdf`, 9 pages.
- GitHub issues [#1–#13](https://github.com/KayzenRoot/dep-instfinal/issues), all open when checked.
- Issue #4 title/body mismatch was resolved by its latest 2026-11-09 approved delta and the PDF: PostgreSQL is canonical; no SQLite/local source of truth.
- No existing Checkpoint, Decisions Ledger, ADR, Scope, DoD, migrations, `package.json`, workflows, or other files existed before this branch.

## Stale triggers

Revalidate before any external action if `main` changes; the feature branch is rebased/updated; issue or owner decisions change; the canonical PDF/Source Pack changes; dependencies or security advisories drift; or the GitHub target/permissions change. Never force-push. Record any new base SHA and fingerprints in the Evidence Bundle.

## Correction Delta CD01

- Audit base: `d7887cfdee219f5b9e081c89e79d4ae61ee0c8f5`.
- Earlier correction commit: `4b92fdee08e339090fbce5e9abcfe70059a042a1`.
- Hosted-validated code HEAD: `89bc16c05912a7b50b47ac3cf2cc3e9b2eef5359`.
- Corrected forms now map camelCase inputs explicitly to snake_case Supabase columns for seasons, characters, and lore. Other write paths were reviewed for the same mismatch.
- All 14 exposed table policies and privileged episode RPCs require signed `app_metadata.dif_studio_owner=true` in addition to matching `auth.uid()`. App routes still check the configured owner UID. Operations require the claim to be administered in Supabase App Metadata and never user-editable User Metadata.
- Cloudinary orphan reconciliation and synthetic external-boundary tests were added. Real Cloudinary validation remains blocked until the owner supplies a selected account/credentials.
- The full E2E acceptance test covers series through ZIP export; hosted PgTAP/RLS and authenticated owner E2E passed on `89bc16c`. Local anonymous E2E passes, while local database/Auth setup is blocked by Docker registry/disk failures.
- Cloudinary live verification remains blocked by absent credentials, as required by the no-credentials/no-paid-services scope. Provider-boundary mocks cover media authorization, upload failure, orphan reconciliation, and export; they are not live integration evidence.
- `ManualTextProvider` remains `NOT_CONFIGURED`. Automatic story generation is pending; the manual editing fallback remains supported.
- At the end of CD01, `docs/CHECKPOINT_DELTA.md`, the Evidence Bundle, and Source Pack recorded the checkpoint as **PROPOSED — NOT PROMOTED** and the proposed verdict as **CORRECTION REQUIRED**, pending live Cloudinary verification and independent review. CD02 supersedes that proposal below.

## Correction Delta CD02

- Audit base revalidated before changes: `a7cfc9edce735bd4d0900ca7de2b9e12c434bab4`; validated application/test SHA: `68b4f867274e296a52c763851537ebf326f5eb8e`.
- Hosted PR CI [`42833608157`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42833608157) and push CI [`42833596156`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42833596156) passed on the implementation SHA. The authenticated browser suite completed the full owner journey and verified hypothetical branches, pending-vote gating, prior facts, and exported context.
- The continuation builder uses only an exact verified poll result referenced by the latest author-approved canonical decision. A pending/open vote or a stale decision is never treated as canon. The owner-filtered context retains the approved series/season bible, characters, lore, prior published episodes, events, scene notes, choices and consequences.
- DIF-005/DIF-007 use the permitted manual provider path: private context-complete prompt export and validated response import. No eligible official provider was confirmed and configured; automatic AI generation remains pending. No private ChatGPT/Google Flow session or paid service was used.
- Local baseline passed. Local anonymous E2E passed with authenticated cases skipped because no local Supabase stack was available; local PgTAP could not connect at `127.0.0.1:54322`. Hosted CI passed database/RLS, direct Data API owner isolation, and 8/8 authenticated E2E. The CI database/Auth users were disposable synthetic accounts.
- Cloudinary boundary mocks passed, but a real account and credentials were unavailable and intentionally not created. `docs/EVIDENCE_BUNDLE.md` records the exact private upload/delivery, rejection/timeout, orphan reconciliation, finalization failure, ZIP media inclusion/omission, and expiry/cache acceptance steps still required against an owner-authorized account.
- Automatic checkpoint promotion remains prohibited. CD02 checkpoint is **PROPOSED — NOT PROMOTED**; proposed verdict is **BLOCKED** pending Cloudinary live acceptance and independent review. PR #14 must remain Draft; no merge, deployment, spend, external provisioning, or promotion occurred.

## Correction Delta CD03

- Revalidated CD03 audit base `546353727d69b930f016b1faffa99d0e16bf6115` before edits, along with the approved Source Pack rev 1.1 and canonical decisions: manual verified voting, explicit append-only author approval for canon, one integrated branch/Draft PR, and no merge or deployment. The user-authorized CD03 requirement adds a vote-free season finale while retaining two distinct choices for other episodes.
- CD03 source/test commits on the same feature branch: `134053b437492f3a5e8e5ac16dd845c11efd3995`, `ec47a56fe0aa983a4409b55491922defcac86c17`, `49665849f97fcb6f25064dcddff33dbe41decb13`, `f05da38f3d7722964ebed53e289f16d3d42deb0f`, `9537cc49cd2bbc2470211b87062aaab527c105f1`, `da5aaa011bf13b378922357911dda74ee198750f`, `92ff6428c318b6fc21c7611ce9d7db5c5227fb45`, and E2E reliability commits `0ea69457d1c99fbb374209b296fda5a0844f579e`, `04e29692e1787893dcdb71975025fa72ff94c89d`, `1766b158c8a4e1054e6cb6c2a0c7a3aa79515d92`.
- The database publication guard runs for both `set_episode_status` and direct table transitions. A continuation is blocked until its existing immediately preceding episode has a closed, verified poll, a latest verified result with a valid winner, and an owner-approved canonical decision tied to that exact latest result. Hypothetical branches remain `HYPOTHETICAL_NOT_CANON`; they do not update canon automatically.
- Season finale status is derived from the season plan; the plan is locked once episodes exist. The final planned episode accepts zero voting options, may be published without a poll, and rejects poll creation. Every other episode still requires two distinct options. The UI reports the specific pending publication validation.
- Hosted PR CI [`42881078808`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42881078808) and push CI [`42881066718`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42881066718) passed at code/test SHA `1766b158`. Both passed baseline, Supabase startup, PgTAP/RLS, and the authenticated Playwright suite (8/8 on the first attempt, no retries). E2E covers premature publication, pending/unverified and stale results, corrected approval, distinct branches, the approved immediate predecessor, episode 10 verified as the planned finale, and finale import/publication without a poll. The earlier retry exposed browser hydration resetting the finale number to the default; the test now waits for network idle before editing and verifies the stored prompt context.
- Local lint, typecheck, 23 unit tests, production build, and 15 security policy invariants passed individually. The local full baseline stops at `format:check` for 13 files in the Windows workspace; hosted baseline passes. Local Supabase was unavailable at `127.0.0.1:54322`, so PgTAP/authenticated E2E evidence comes from hosted CI. The latest local dependency audit could not reach npm registry (`socket hang up`); hosted baseline passed the configured high threshold. A prior successful audit reported four LOW transitive `deepmerge` advisories; the forced fix proposes an incompatible SvelteKit downgrade.
- Cloudinary live acceptance, real backup/restore, and independent review remain not run/pending. No service, account, credentials, billing, merge, deployment, or checkpoint promotion was created or performed. PR #14 remains open, unmerged, and Draft; the Checkpoint Delta remains **PROPOSED — NOT PROMOTED** with proposed verdict **BLOCKED**. CD03 is not a completed release.

## Correction Delta CD04

- Before implementation, revalidated the requested base `34ab6b7c9156de054dfd4969e761d456cc4890c4` as the clean local and remote tip of `feat/dif-studio-mvp-001`, and verified PR #14 was open, unmerged, and Draft. Rechecked Source Pack rev 1.1, the proposed/blocked CD03 Checkpoint Delta, and canonical decisions: PostgreSQL is authoritative; all nonfinal episodes have two distinct choices; voting is manually closed and verified; canon requires explicit append-only author approval; conditional branches remain hypothetical; seasons target 10–15 episodes; work stays on the integrated branch and Draft PR with no merge or deploy.
- The user-authorized CD04 change adds an existence requirement for the immediately preceding episode to `assert_episode_publication_allowed`. The guard still runs in `set_episode_status` and direct PostgreSQL status transitions. If the predecessor exists, CD03's latest verified vote, valid winner, and exact approved-canon checks remain intact. Draft creation/edit/import remains available out of sequence and does not alter canon. The owner receives a clear missing-predecessor message.
- The additive migration is `20261110190000_cd04_require_previous_episode.sql`. Test fixtures now maintain a valid complete sequence before publishing episodes 11 and 12. PgTAP includes missing-predecessor rejection through the RPC and direct update, editable out-of-order draft without poll/canon, and publication after validated continuity; the finale remains choice-free and vote-free. Authenticated E2E keeps the 10-episode plan, tests an out-of-order draft and blocked publication, fills the missing chain with verified votes and approved canon, publishes the continuation, and imports/publishes finale 10 without its own choices or poll.
- CD04 commits on the same feature branch: implementation `3c560489788d0c1efaf16dd26d81b709daad4406`; test-fixture and 10-episode E2E correction `45840f9199783c251c4da8b10bff3fcda14de629`. The first CI attempt exposed a duplicate `READY` transition in the new fixture; it was removed before the final commit.
- Hosted PR CI [`42898556365`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42898556365) and push CI [`42898547547`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42898547547) passed on final code/test HEAD `45840f9`: full baseline, PgTAP (20 tests), and authenticated E2E (8/8; 10-episode continuity journey included). No retries were reported.
- Local lint, typecheck (0 Svelte errors/warnings), unit tests (23/23), build, and 15 policy invariants passed. Local dependency audit exited 0 at its configured high threshold with four LOW transitive `deepmerge` advisories. Local `check:baseline` stops at Windows `format:check` for 13 existing files. The local Supabase test command could not connect to `127.0.0.1:54322`; hosted PgTAP and authenticated E2E supply the successful evidence.
- Final PR readback after the application/test push: #14 remained `OPEN`, `isDraft=true`, `mergedAt=null`, targeting `main`. Evidence Bundle and Checkpoint Delta are updated for CD04; status remains **PROPOSED — NOT PROMOTED**, proposed verdict **BLOCKED**. Live Cloudinary acceptance, external backup/restore, and independent review remain pending. No merge, deployment, spend, service provisioning, credential use, or checkpoint promotion occurred.

## Correction Delta CD05

- Revalidated CD05 base `b78609d9f0e3a32773733df6c3303edf994c7b0c` as the clean branch tip before live acceptance. The dedicated Supabase project `dif` (`zottgifcocnjguhmnezx`, us-east-1) and the Cloudinary environment `dt4qdzuus` were selected from the owner's authenticated sessions. No new project, plan, or paid service was created.
- The four committed migrations were applied in order through the Supabase Management API: 14 public tables, 50 policies, 22 functions, and RLS enabled on all 14 tables. The owner `owner@dif.local` was created with `app_metadata.dif_studio_owner=true` (UID `75a301f7-c0ee-4bd9-863e-95d42b7037b0`). Password-grant login returned 200; the owner REST read returned 200 `[]`; `scripts/set-owner-uid.mjs` wrote the UID to the git-ignored `.env`.
- Cloudinary credentials and generated owner credentials were stored only in the git-ignored `.env` and an external local secrets directory. No secret, key, or password is committed or recorded in the evidence documents.
- Live media acceptance passed: a real 64×64 PNG reached `READY` with Cloudinary `asset_id`, version, dimensions, byte size, and SHA-256; owner delivery returned 200/235 bytes with `private, no-store`; the unauthenticated route returned 401; the unsigned raw URL returned 401; a signed URL returned 200 before expiry and 401 after expiry; invalid bytes returned 415; a 10 MiB + 1 byte upload returned 413; an invalid Cloudinary secret preserved `ORPHANED` / `CLOUDINARY_UPLOAD_OUTCOME_UNKNOWN`.
- Live reconciliation exposed an SDK error-shape mismatch: the real 404 is nested under `error.http_code`. Commit `b89240f061d9976a0a7db28003d63d5daf977dfe` recognizes both nested and top-level shapes and updates the unit fixture. A real object reconciled to `READY`; a missing object reconciled to `FAILED` / `CLOUDINARY_ASSET_NOT_FOUND`. Local unit tests 23/23, typecheck 0/0, lint, build, and 15 policy invariants passed.
- A disposable authenticated non-owner user read `[]` and received 403 (`42501`) on insert, then was deleted. Authenticated ZIP export returned 29 entries including the private PNG and empty `missing_frames.json`, with 15 contiguous SRT segments.
- External backup/restore remains **NOT RUN**: the Free plan shows no scheduled backups and no external restore target was provisioned. Independent review remains pending. Hosted PR CI `43038342557` and push CI `43038328934` passed at final code/test HEAD `852b970` (baseline, PgTAP 20, E2E 8/8), and PR `43041393787` / push `43041387125` passed again at documentation/helper HEAD `e47ecaa`; the earlier `388577e` attempts failed only on Ubuntu mirror DNS during the Playwright apt step, fixed by pinning `ubuntu-24.04` and installing Chromium without apt. A temporary owner-authorized Cloudflare quick tunnel was validated for public access; it is ephemeral, has no Cloudflare Access policy, and is not a production deployment. The live acceptance fixture remains owner-scoped test data. No merge, production deployment, spend, new service provisioning, credential commit, or checkpoint promotion occurred.

## Correction Delta CD06

- Revalidated CD06 base `d5e43f258101af8388d030554c6ca9c0084d7309` as the clean branch tip before edits. Implementation commit `218f18f74e7720105d136c2fa3f0546ba789e9fd` adds the issue-closing production workflow without changing the approved stack.
- Three additive migrations: `20261111120000_cd06_production_metadata.sql` (episode scene duration, scene direction/prompt metadata, continuity review, deferrable scene unique constraint, `swap_scene_order`), `20261111121000_cd06_scene_actions.sql` (`set_episode_scene_duration`, `save_scene_production`), and `20261111122000_cd06_fix_episode_scene_duration.sql` (the content-save RPC now honors the configured scene duration instead of hardcoding 8 s).
- Continuity review is deterministic and advisory: DECEASED/MISSING/ARCHIVED characters and SUPERSEDED/ARCHIVED lore titles found in the episode text produce warnings; canon approval requires an explicit review when warnings exist and stores the reviewed warnings in `canonical_decisions.continuity_review`.
- The library now serves server-generated private variants (`thumb`, `4x5`, `3x4`), compares two frames side by side, and warns about a non-matching aspect. The export adds platform targets/preset, per-channel covers/hashtags, AI disclosure, effects/assembly notes, credit estimate, production checklist, and assembly manifest.
- Local validation passed: unit 27/27, typecheck 0 errors/warnings, lint, build, and PgTAP 25/25 on the minimal local stack. The Windows E2E suite was slow and flaky while reusing a stale dev server; the hosted E2E is the authoritative run.
- Backup/restore was executed live: all 14 public tables and the owner UUID were exported, restored into a dedicated local Supabase target with the same owner UID, and verified by matching counts, owner login 200, anonymous REST 401, and a 235-byte Cloudinary image with matching SHA-256. Auth passwords were re-provisioned, not copied from the backup.
- Hosted PR `43080981120` and push `43080968791` passed at final code/test HEAD `b23d40c` (PgTAP 28 tests; E2E 9 passed in 2.3 minutes, no retry). The independent reviewer agent first returned CORRECTION REQUIRED (HIGH: narrative import hardcoded 8 s and could truncate content); commit `08a4567` fixed the HIGH and MEDIUM findings and the follow-up audit returned **APPROVED** with no HIGH/CRITICAL findings. Three LOW residuals are documented in the Evidence Bundle. The checkpoint remains **PROPOSED — NOT PROMOTED** with proposed verdict **APPROVED — ready for owner promotion**. No merge, production deployment, paid service, credential commit, or promotion occurred.

## V2 Context Lock — WO-001 (#18)

- **Base revalidated:** `main` `13467ab009e0eaaee1be6ba2e35678228cfbdf32` after squash merge of PR #16 (`docs(v1): finalize verified production checkpoint`), 2026-11-12. Branch for this WO: `docs/dif-v2-wo-001`.
- **V1 gate:** PR #16 was Draft/mergeable CLEAN with CI `43220790406` PASS and Vercel preview success; an independent agent audit recorded outside GitHub (GitHub shows only a Copilot `COMMENTED` review) returned **APPROVED**, with net diff only `docs/SOURCE_PACK.md`, `docs/CHECKPOINT_DELTA.md`, `docs/EVIDENCE_BUNDLE.md`. Squash-merged normally at `13467ab` (no force-push; `main` has no branch protection configured). Post-merge smoke: `/health` 200, `/login` 200, anonymous `/app` 303. The exact Vercel deployment SHA is not independently verifiable without a Vercel credential; the production alias responds as documented.
- **Critical source fingerprints at base (SHA-256, canonical LF blob via `git show 13467ab:<path> | sha256sum`):**
  - `docs/CHECKPOINT_DELTA.md` `806d3c4c248aad501c9ee2ed5f0b46168cea4ce9e210d1369b8c7c7285b97fa3`
  - `docs/SOURCE_PACK.md` `87f6487c1915369ad80699d7f18750295762fc95a398aeb5a0d9053b8dabd316`
  - `docs/CONTEXT_LOCK.md` `29a65b759588b775b57ea1dbe948c88afcc6fecf595c63e7c889f21b52a09e45`
  - `docs/EVIDENCE_BUNDLE.md` `885b82cee9d566cbbc0c2969a32667d75838b5a7137bfefed9396cbe830663ad`
  - `docs/OPERATIONS.md` `ac5819a3dc6450f2243387347b144487fc09554701718f658f54d8361aa12f91`
  - `README.md` `8f63c4278b81d60a36590f46d01d727713854679d8af736ebe328d9d6e1ea687`
  - `package.json` `c0852118f82eefcaeb409281f758be22ed51aaa0785da74edb4469a4a7e9f394`
  - `.github/workflows/ci.yml` `5a164edb4338d313492ed87a1188543c844855d6e1d3d609328215854803d389`
- **Issue inventory:** epic #17 is OPEN and `PLANNED / PROPOSED`; all 28 WOs #18–#45 are OPEN with no approval labels and PLANNED/UNAPPROVED status. No ADR V2 is accepted. No V2 runtime branch, migration, table, worker, storage or deployment exists; the only V2 branch is the documentation branch `docs/dif-v2-wo-001`.
- **Tools/capacity:** Node `26.4.0`, npm `11.17.0`, Supabase CLI `2.113.0`; `ffmpeg`/`ffprobe` are absent from the local PATH; Oracle ARM64 VPS access, CPU/RAM/disk, FFmpeg build and firewall/Portainer constraints are unverified. WO-002 cannot run until the environment is authorized and measured.
- **Dependency graph:** documented in `docs/V2_EXECUTION_PLAN.md`; key edges: WO-024 depends on WO-025; WO-013 is final hardening, not a prerequisite of WO-023; WO-014 is terminal; WO-026 requires WO-019 and WO-025. The proposed graph has no cycle; live issue bodies prevail if they change.
- **Budget:** incremental spend target **US$ 0**; no paid API, GPU, domain, storage or billing activation. Vercel Hobby, Supabase Free and the existing Oracle VPS are candidates, not guarantees.
- **Gate:** WO-001 documentation is **APPROVED** at `ae1f44d`; ADR-V2-001 is **ACCEPTED** by the owner (2026-11-12); WO-002 benchmark is authorized. WO-003+ remains **BLOCKED** until WO-002 returns GO and the preceding WO is APPROVED. Stale triggers: any change to main, PR #16 closure evidence, issue dependencies/scope, ADR, V1 contracts, provider quotas or tool capacity requires rebase/revalidation before execution.

## V2 Context Lock — WO-002 (#19)

- **Base revalidated:** `main` `01405cbb641e7814cbd964157d0814ba4e23d7c7` after squash merge of WO-001/PR #46 (`docs(v2): complete WO-001 execution plan and accepted ADR`), 2026-11-12. Branch for this WO: `bench/dif-v2-wo-002`.
- **Critical source fingerprints at base (SHA-256, canonical LF blob via `git show 01405cb:<path> | sha256sum`):**
  - `docs/CHECKPOINT_DELTA.md` `bc84b4ff868e321c9fbd50051d952c6a2590bd6efc0b125e1977b822412b69c7`
  - `docs/SOURCE_PACK.md` `0f3cf03ca5d3570a68d6e55825e25fc4af4434e33178866f43394b6d80b30536`
  - `docs/CONTEXT_LOCK.md` `5755f22886ff6a159d631fb163c2c28f231e1d34be4eef1fabaa38a7efe8b538`
  - `docs/EVIDENCE_BUNDLE.md` `bcb8d045955c2885b5e982dfdc8f4a5bfc6065aa9c3b8b6714914a42fd5d1de7`
  - `docs/OPERATIONS.md` `ac5819a3dc6450f2243387347b144487fc09554701718f658f54d8361aa12f91`
  - `README.md` `8f63c4278b81d60a36590f46d01d727713854679d8af736ebe328d9d6e1ea687`
  - `package.json` `c0852118f82eefcaeb409281f758be22ed51aaa0785da74edb4469a4a7e9f394`
  - `.github/workflows/ci.yml` `5a164edb4338d313492ed87a1188543c844855d6e1d3d609328215854803d389`
- **Issue inventory:** WO-001/#18 is **CLOSED**; WO-002/#19 is **OPEN** pending issue closure, with evidence **APPROVED** on 2026-11-12; WO-003+ #20–#45 remain OPEN/UNAPPROVED and **BLOCKED**; epic #17 remains OPEN `PLANNED / PROPOSED`. ADR-V2-001 is **ACCEPTED**; ADR-V2-002–005 remain **PROPOSED**. No V2 runtime branch, migration, table, worker, storage or deployment exists.
- **Environment measured:** Oracle VPS ARM64 (aarch64), Neoverse-N1, 2 vCPU, 11,924 MB RAM, no swap, 177 GB free; kernel `7.0.0-1015-oracle`; FFmpeg/ffprobe 7.0.2-static aarch64 (GPLv3, libx264/AAC); no sudo, system package, daemon or new port. The static binary and all benchmark data were removed after evidence collection.
- **Benchmark result:** 3 × 1080×1920 in 69.65–70.53 s (mean 70.02 s, RTF 0.58, 1.72× realtime), max RSS 364,572 KB, 188–191% process CPU, 103,939,130 B output; 720×1280 in 46.55 s / 31,557,798 B. `ffprobe`: 120.000000 s, exact 9:16, H.264 30 fps + AAC 48 kHz stereo, clean full decode. Failure tests: timeout rc 124 / 0 orphans, corrupt input rc 183, simulated low disk rc 153, recovery PASS, CPU saturation 7.17× slowdown / 0.83× recovery.
- **Decision:** **GO CONDITIONAL** for one FFmpeg worker on this VPS with concurrency **1**, `nice`/`ionice`, 10 min timeout, 2 GB temp reserve and 720p fallback. US$ 0 incremental compute (estimate; no billing check). The benchmark measured raw capacity; worker guards were not exercised and are a WO-003+ requirement. Storage/egress is outside this measurement and remains pending ADR-V2-002.
- **Gate:** WO-002 evidence is **APPROVED** (2026-11-12); WO-003+ remains **BLOCKED** until ADR-V2-002/storage is approved and the owner authorizes the next increment. Checkpoint V2 remains **PROPOSED — NOT PROMOTED**; no merge, production deploy, worker, schema, production change or spend occurred; the automatic PR preview is not production. Stale triggers: any change to main, WO-001 approval, ADR, V1 contracts, provider quotas, VPS capacity/services or benchmark evidence requires revalidation before WO-003.

## V2 Context Lock — WO-003 (#20) — historical, superseded by promotion

- **Base revalidated:** `main` `b0f78064a2a5902acc98c20efc92648ec540b7e9` after WO-002/PR #47 squash merge, 2026-11-12. Branch: `feat/dif-v2-wo-003`.
- **Critical source fingerprints at base (SHA-256, canonical LF blob via `git show b0f7806:<path> | sha256sum`):**
  - `docs/CHECKPOINT_DELTA.md` `730421dd22184148700f9c4d6d48670a165a3ceb0f532d6e6f66d93c729928fa`
  - `docs/SOURCE_PACK.md` `927475206879348478b2b091e2dc2c4e9f9a5372b5068748cbf56bb7879968df`
  - `docs/CONTEXT_LOCK.md` `0397e9755fd05bf763a1a65f751be4c9a99653e29ef12a6ecedbda83d447f573`
  - `docs/EVIDENCE_BUNDLE.md` `517a1f12cc27fbc726b34ec1eb05bbd02af2d09ade4b008f2a7468ebce05f4ba`
  - `docs/OPERATIONS.md` `ac5819a3dc6450f2243387347b144487fc09554701718f658f54d8361aa12f91`
  - `README.md` `8f63c4278b81d60a36590f46d01d727713854679d8af736ebe328d9d6e1ea687`
  - `package.json` `c0852118f82eefcaeb409281f758be22ed51aaa0785da74edb4469a4a7e9f394`
  - `.github/workflows/ci.yml` `5a164edb4338d313492ed87a1188543c844855d6e1d3d609328215854803d389`
- **Issue inventory:** WO-001/#18 and WO-002/#19 are **CLOSED**; WO-003/#20 is **OPEN** in execution; WO-004+ #21–#45 remain OPEN/UNAPPROVED and **BLOCKED**; epic #17 remains OPEN `PLANNED / PROPOSED`. ADR-V2-001 and ADR-V2-002 are **ACCEPTED**; ADR-V2-003–005 remain **PROPOSED**.
- **Storage decision:** Cloudflare R2 private bucket `dif-studio-video-private` created on 2026-11-12; public access not enabled. Bucket-scoped token `-2` and CORS are configured; live upload/read PASS. The first token exposed in local output was revoked. Lifecycle is pending because the token gets `AccessDenied` on lifecycle APIs; no credential is in Git/logs.
- **Delivered locally:** additive `video_upload_sessions`/`video_assets` migrations plus server-mediated asset and session boundaries (owner reads; service role writes; READY via service role; tombstone/GC in WO-005); R2/in-memory storage adapter; ffprobe/fixture probe with VFR detection; multipart upload, idempotent completion/recovery, quarantine, SHA-256, signed download and list/resume routes; `/app/video` UI.
- **Tests:** PgTAP **42/42**; policy audit **20 invariants/16 tables**; unit **81 + 1 skip**; lint/typecheck/build PASS; hosted E2E **10/10**, including the 15-clip batch with reload; live R2 E2E **15/15 PASS**.
- **Gate:** first independent audit returned **BLOCKED** at `fb6a3c8`; re-audit at `3a6a22f` returned **CORRECTION REQUIRED**; M4/M9/M11/M12, session-key H1 and M4 recovery B1 corrected; final independent audit **APPROVED** at `c07af6e`. M2 quota pagination/check-then-act is non-blocking for single-owner and tracked for WO-013/WO-005. WO-004+ remains **BLOCKED** until the owner formally approves/merges WO-003. Checkpoint V2 remains **PROPOSED — NOT PROMOTED**; no production deploy, paid service or spend occurred. Stale triggers: any change to main, WO-002 approval, ADR-V2-002, R2 bucket/token/CORS, migration or test evidence requires revalidation before WO-004.

## V2 Context Lock — WO-004 (#21) — historical, superseded by promotion

- **Base revalidated:** `feat/dif-v2-wo-003` `4d1aa3c` (WO-003 audit APPROVED, merge pending). Branch: `feat/dif-v2-wo-004` (stacked; Draft PR #49).
- **Critical sources read:** `docs/CHECKPOINT_DELTA.md`, `docs/SOURCE_PACK.md`, `docs/EVIDENCE_BUNDLE.md`, `docs/V2_EXECUTION_PLAN.md`, `docs/ADR_V2_PROPOSED.md`, `docs/ADR_V2_002_STORAGE.md`, `supabase/migrations/*`, `src/lib/domain/timeline.ts`, video asset tables/RPCs, owner-only route patterns.
- **Issue inventory:** WO-001/#18 and WO-002/#19 **CLOSED**; WO-003/#20 **OPEN** (audit APPROVED, merge pending); WO-004/#21 **IN PROGRESS** (Draft PR #49); WO-005+ #22–#45 **BLOCKED**; epic #17 OPEN `PLANNED / PROPOSED`.
- **Delivered locally:** additive `video_edit_plans`/`video_edit_plan_versions`; owner read RLS; server-only service-role save/restore/status RPCs with `FOR UPDATE`, `expected_version` conflict (P0001 → HTTP 409), published-episode rejection and server-computed hash; Zod/domain plan contract (4/6/8 s, trims, crossfade, tracks, CTA, captions, canonical SHA-256); `/app/timeline` editor and nav.
- **Tests:** PgTAP **58/58**; unit **93 + 1 skip**; policy **22 invariants/18 tables**; lint/typecheck/build PASS; hosted CI `43376699502` PASS (5m57s) with E2E **11/11** (3.2m).
- **Gate (historical):** final independent audit APPROVED at `637aaa9`; squash-merged at `c6be101`. The current checkpoint is PROMOTED; see the promotion section below.

## V2 Context Lock — WO-005 (#22) — historical, superseded by promotion

- **Base revalidated:** `feat/dif-v2-wo-004` `0860fd3` (WO-004 audit APPROVED, unmerged). Branch: `feat/dif-v2-wo-005` (stacked).
- **Critical sources read:** WO-002 benchmark, WO-003 R2/storage, WO-004 edit-plan versions, ADR/SOURCE_PACK, owner-only RLS/RPC patterns, `docs/OPERATIONS.md`.
- **Issue inventory:** WO-001/#18 and WO-002/#19 **CLOSED**; WO-003/#20 and WO-004/#21 **audit APPROVED, Draft/unmerged**; WO-005/#22 **IN PROGRESS**; WO-006+ #23–#45 **BLOCKED**.
- **Delivered locally:** `render_jobs`/`render_job_events`; owner SELECT, service-only RPCs; single active job; advisory lock + `SKIP LOCKED`; lease/heartbeat/retry/cancel/reconcile; enqueue idempotency and backpressure; Node ARM64 stub worker; `/api/render-jobs`; timeline render panel.
- **Tests:** PgTAP **81/81**; unit **95 + 1 skip**; policy **23 invariants/20 tables**; timeline+worker E2E PASS; hosted CI `43383787230` PASS (6m25s); final independent audit **APPROVED** at `6ca4523`; lint/typecheck/build PASS.
- **Gate (historical):** final independent audit **APPROVED** at `6ca4523`; squash-merged at `dc405d8`. Residuals N1-N15 are WO-006 obligations. No VPS deployment/container/firewall/key.

## V2 checkpoint promotion — 2026-11-13

- **Owner decision:** explicit authorization to merge the stacked WO-003/WO-004/WO-005 PRs and promote the V2 checkpoint.
- **Merged to `main`:** WO-003 `ac55d27`, WO-004 `c6be101`, WO-005 `dc405d8`; issues #20/#21/#22 closed.
- **Audits:** APPROVED at `c07af6e`, `637aaa9`, `6ca4523`; CI green before each squash merge.
- **Checkpoint status:** **PROMOTED** on 2026-11-13. The checkpoint covers private R2 ingest, canonical timeline versions and render queue/stub worker.
- **Residuals:** R2 lifecycle/GC, M2 quota hardening, real FFmpeg/VPS worker and least-privilege worker credential remain tracked; WO-006+ still requires its own implementation, CI, evidence and audit.
- **No new external service** was purchased or provisioned by this promotion. The Vercel production deployment associated with `main` is the owner-authorized deployment of the merged code.

## V2 Context Lock — WO-006 (#23)

- **Base revalidated:** `main` `b1081e9` (checkpoint WO-003/004/005 promoted). Branch: `feat/dif-v2-wo-006`.
- **Issue inventory:** WO-001–005 **MERGED/CLOSED**; WO-006/#23 **IN PROGRESS**; WO-007+ #24–#45 **BLOCKED**.
- **Delivered locally:** allowlisted FFmpeg composition (trim/scale/crop/fps/concat/xfade/VHS), H.264 High 1080x1920 faststart, ffprobe validation, real `render-job.ts` with plan/context revalidation and asset hash checks, worker real mode/kill tree, worker read grants.
- **Tests:** 103 + 1 unit (120s cuts + multi-crossfade; `settb`), PgTAP 83/83 (stub rejected), policy 23/20, E2E real worker local.
- **Gate:** B1–B5/NEW-1/B4-R/N1/N2/N6/N7 corrections applied; final audit **APPROVED** at `6aee143`; squash-merged at `239f3ba`; checkpoint promoted. No VPS deployment/container/firewall/key, no merge/promotion. WO-007+ blocked. Residuals: R2 worker live path, VFR/rotation fixtures, preview rendition, process-group Linux smoke, WO-005 queue hardening. Residuals: R2 worker live path, VFR/rotation fixtures, preview rendition, process-group Linux smoke, WO-005 queue hardening.

## V2 checkpoint promotion — WO-006 (2026-11-13)

- **Owner decision:** continued merge/promotion authorization; PR #53 squash-merged at `239f3ba`; issue #23 closed.
- **Audit:** final independent audit **APPROVED** at `6aee143` after B1–B5/NEW-1/B4-R closure.
- **Scope:** FFmpeg cuts/crossfade/VHS composition, 1080x1920 H.264 real artifacts, real worker with hash/plan validation, READY artifact guard and worker grants.
- **Residuals:** VPS/R2 live smoke, VFR/rotation fixtures, audio/captions/preview, 720p/disk limits and least-privilege worker role remain tracked for later WOs.
- **Next:** WO-007 (#24) narration; WO-008+ remain gated by their own approvals.

## V2 Context Lock — WO-007 (#24)

- **Base revalidated:** `main` `c0f3cfd` (checkpoint WO-006 promoted). Branch: `feat/dif-v2-wo-007`.
- **Issue inventory:** WO-001–006 **MERGED/CLOSED/PROMOTED**; WO-007/#24 **IN PROGRESS**; WO-008+ #25–#45 **BLOCKED**.
- **Delivered locally:** private narration takes (WAV/MP3/M4A) with SHA/loudness/true peak, versioned `VoiceDirectionPlan` by episode revision + narration text hash, deterministic heuristic direction, snapshot restore, owner-only RLS with service-only writes, approval guard requiring a READY take, render-job narration pin/mux (AAC 48 kHz stereo), and optional offline Piper TTS with per-segment regeneration and honest capability metadata.
- **Tests:** PgTAP **108/108**, policy **25 invariants/22 tables**, unit **116 + 2 skipped**, typecheck/lint/build PASS, real FFmpeg mux integration PASS, real Piper TTS opt-in PASS, 232-word synthetic TTS **110.730 ms / −2,0 dBFS / −18,5 LUFS / 10,6 MB**, hosted CI `43527026122` **SUCCESS** with E2E **12/12** (timeline narrada READY em 43,4s), owner-boundary narration 401 and responsive layout PASS.
- **Gate:** owner auditory acceptance of two styles, ARM64 TTS benchmark and independent audit. Hosted CI is green. No merge, deploy, VPS change or promotion. WO-008+ stays blocked.

### Fingerprints no base `c0f3cfd`

| Fonte canônica                       | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `docs/CHECKPOINT_DELTA.md`           | `405be0dac58d39279c480fbfd4a263077498f87b5fd8186d48e990427f910762` |
| `docs/SOURCE_PACK.md`                | `ccac8b33f2d83c578f2a0ca3549f03d0c791980acfbedd3f1b06c5ca2257dd1c` |
| `docs/ADR_V2_PROPOSED.md`            | `923b16392dacd1160ec9ea853ace44adad8e2d6e4749c348d0732eb8a8b5a1c1` |
| `docs/ADR_V2_002_STORAGE.md`         | `9e39af92e6ea71ad234900c6e7d5d9a2290cc32c393177ad45db9b472510966e` |
| `docs/V2_EXECUTION_PLAN.md`          | `365902f19bd6504e511d39141eaa86fd6220abc8c39a6858b419831fcb74da06` |
| `docs/CONTEXT_LOCK.md`               | `60252ee953006886080385007b1b4468732edab4c78fa55aff9b85d27f3b557c` |
| `src/lib/schemas/video-edit-plan.ts` | `48616e3593ea1373e3de61a9aca10a49999549e4d8e91120272eb67e5ad47832` |
| `src/lib/schemas/render-jobs.ts`     | `92a477efdc5a4091415aa6c655c9808db2a3c2809d52fb450f76595eba160481` |
