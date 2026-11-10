# Checkpoint Delta — CD04

- **Work Order:** `DIF-MVP-ALL-001`
- **Repository / branch / PR:** `KayzenRoot/dep-instfinal` / `feat/dif-studio-mvp-001` / Draft PR #14
- **CD04 base HEAD revalidated:** `34ab6b7c9156de054dfd4969e761d456cc4890c4`
- **Implementation commit:** `3c560489788d0c1efaf16dd26d81b709daad4406`
- **Final code/test HEAD:** `45840f9199783c251c4da8b10bff3fcda14de629`
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

## Validation

- Hosted PR CI `42898556365` and push CI `42898547547`: **PASS** on code/test HEAD `45840f9`. Hosted baseline passed; PgTAP reported **20 tests, PASS**; authenticated Playwright reported **8 passed** with the owner continuity journey completed in 1.6 minutes. No E2E retries were reported.
- The earlier CI attempt at `3c56048` failed because the PgTAP fixture tried to transition an already-`READY` out-of-order episode to `READY` again. The duplicate transition was removed; the complete CI passed at `45840f9`.
- Local `npm run lint`, `npm run typecheck` (0 Svelte errors/warnings), `npm test` (**23/23**), `npm run build`, and `npm run audit:policy` (**15 invariants**) passed. `npm run audit:deps` exited successfully at the configured high threshold and listed four LOW transitive `deepmerge` advisories.
- Local `npm run check:baseline` stops at Windows `format:check`, which reports 13 pre-existing files. The hosted baseline passed. Local PgTAP and authenticated E2E could not run because the Supabase stack was not active at `127.0.0.1:54322`; the hosted database and authenticated E2E passed.

## Gate

Live Cloudinary acceptance, external backup/restore, and independent review remain essential pending gates. CD04's code and hosted test suite pass, but the Work Order and release are not complete. Keep PR #14 open and Draft; keep this checkpoint **PROPOSED — NOT PROMOTED** with verdict **BLOCKED**. No merge, deployment, spend, external service, or checkpoint promotion occurred.

CD01–CD03 history remains in `docs/CONTEXT_LOCK.md`; detailed evidence and pending Cloudinary acceptance steps remain in `docs/EVIDENCE_BUNDLE.md`.
