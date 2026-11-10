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
