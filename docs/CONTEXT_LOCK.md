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
