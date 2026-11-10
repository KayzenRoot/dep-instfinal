# Checkpoint Delta — CD03

- **Work Order:** `DIF-MVP-ALL-001`
- **Repository / branch / PR:** `KayzenRoot/dep-instfinal` / `feat/dif-studio-mvp-001` / Draft PR #14
- **Audit base SHA revalidated:** `546353727d69b930f016b1faffa99d0e16bf6115`
- **Implementation SHA:** `49665849f97fcb6f25064dcddff33dbe41decb13`
- **Final code/test HEAD:** `1766b158c8a4e1054e6cb6c2a0c7a3aa79515d92`
- **Hosted PR CI:** [`42881078808`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42881078808) — PASS
- **Hosted push CI:** [`42881066718`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42881066718) — PASS
- **Status:** **PROPOSED — NOT PROMOTED**
- **Proposed verdict:** **BLOCKED — Work Order not complete**

## CD03 delta

1. Added a PostgreSQL publication gate shared by the `set_episode_status` RPC and direct status transitions. If the immediately preceding episode exists and requires voting, continuation publication requires its poll to be closed and verified, its latest result to be verified with a valid winner, and the latest author-approved canonical decision to reference that exact result and episode. Database locking serializes this validation with result updates.
2. Added clear user-facing messages for an open or unverified vote, a missing or invalid result, and a missing or stale canonical approval. A failed gate leaves the continuation in its existing draft/ready state; conditional branches remain `HYPOTHETICAL_NOT_CANON` and do not become canon automatically.
3. Derived finale status from `planned_episode_count` in PostgreSQL, rejected episode numbers beyond the plan, and locked the season plan after episode creation. The final planned episode can be imported and published with zero choices and cannot open a poll; all other episodes still require exactly two distinct choices.
4. Preserved CD01 owner-boundary protections and CD02 manual prompt/response import, verified-continuity context, separate hypothetical branches, and ZIP export behavior.
5. Added PgTAP and E2E checks for premature publication, unverified and stale latest results, the matching approved decision, different branch contexts, and a finale imported/published without voting choices. Direct `INSERT`/`UPDATE` bypass attempts are covered by database tests.

## Validation

- Hosted `npm run check:baseline`: **PASS** in PR run `42881078808` and push run `42881066718` at `1766b158`.
- Hosted `npm run test:db`: **PASS** in both runs, including CD03 publication and finale constraints.
- Hosted authenticated E2E: **PASS · 8/8, no retries** in both runs. The journey verifies pending publication, a revised result invalidating an older decision, publication after the matching approval, distinct hypothetical branches, episode 10 as the planned finale, finale publication without a poll, and rejection of finale poll creation.
- Local `npm test`: **PASS · 23/23**; `npm run lint`, `npm run typecheck` (0 Svelte errors/warnings), `npm run build`, and `npm run audit:policy` (15 invariants across 14 tables): **PASS**.
- Local `npm audit --audit-level=high`: **UNAVAILABLE on the latest run**; npm registry request ended with `socket hang up`. A prior successful audit found four LOW transitive `deepmerge` advisories. `npm audit fix --force` proposes a breaking SvelteKit downgrade and was not applied. The hosted baseline passed the configured high threshold on the final code/test SHA.
- Local `npm run check:baseline`: **PARTIAL**; Windows `format:check` reports 13 files. Lint, typecheck, unit tests, build, and policy checks pass individually; the hosted baseline passes.
- Local Supabase PgTAP/authenticated E2E: **BLOCKED locally** because Supabase was unavailable at `127.0.0.1:54322`; hosted PgTAP and 8/8 authenticated E2E are the successful evidence.

## Gate

The CD03 code, database, and authenticated browser checks pass at `1766b158c8a4e1054e6cb6c2a0c7a3aa79515d92`. Live Cloudinary acceptance, external backup/restore, and independent review remain essential pending gates. No account, service, credential, or billing was created. Keep PR #14 open and Draft, keep this checkpoint **PROPOSED — NOT PROMOTED**, and do not represent the Work Order or release as complete. No merge, deployment, spend, external provisioning, or promotion occurred.

CD01 and CD02 implementation/history remain in `docs/CONTEXT_LOCK.md`; full evidence and the enumerated Cloudinary acceptance steps remain in `docs/EVIDENCE_BUNDLE.md`.
