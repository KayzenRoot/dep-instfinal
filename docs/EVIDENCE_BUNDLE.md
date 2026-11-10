# DIF Studio — Evidence Bundle

- **Work Order:** `DIF-MVP-ALL-001`
- **Correction Delta:** `CD02`
- **Repository:** `KayzenRoot/dep-instfinal`
- **Branch / PR:** `feat/dif-studio-mvp-001` / [Draft PR #14](https://github.com/KayzenRoot/dep-instfinal/pull/14)
- **CD02 audit base SHA:** `a7cfc9edce735bd4d0900ca7de2b9e12c434bab4`
- **CD02 code/test SHA:** `68b4f867274e296a52c763851537ebf326f5eb8e`
- **Hosted PR CI:** [run `42833608157`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42833608157) — PASS
- **Hosted push CI:** [run `42833596156`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42833596156) — PASS
- **Evidence date:** 2026-11-10
- **Checkpoint Delta:** **PROPOSED — NOT PROMOTED**; see `docs/CHECKPOINT_DELTA.md`.

## CD02 result

The next-episode preparation now loads the owner’s series and season bible, all characters and lore statuses, and every earlier published episode’s story, scenes, choices, consequences, poll revisions, and canonical decisions. A previous decision is applied only when the poll and latest result are verified, the result has a winner, and the owner’s latest decision points to that exact result. Open polls, pending results, missing approvals, and stale decisions remain non-canonical.

Choice 1 and choice 2 can each be exported as a separate hypothetical continuation context marked `HYPOTHETICAL_NOT_CANON`. These previews do not modify the approved context. The owner can export the complete context and a strict JSON response template, paste a manual response, validate story fields, two distinct choices, and estimated duration, then save the response atomically as a draft revision. The episode ZIP includes the canonical context, continuation prompt, social copy, captions, scenes, and available owner-authorized media.

No official AI provider was both confirmed eligible and configured for this repository. Provider credentials are absent, no private ChatGPT or Google Flow sessions/endpoints were used, and no billing was enabled. `ManualTextProvider` remains `NOT_CONFIGURED`; the manual prompt export and validated response import are functional. Automatic AI generation is **pending**.

CD01 owner-only protections remain in place: all 14 exposed tables have forced owner-scoped RLS with the signed App Metadata claim; server routes verify the configured owner UID. The hosted Data API check still verifies that a different authenticated user cannot read or create owner data.

## Verification record

| Check                                    | Result                                    | Evidence / limit                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check:baseline`                 | PASS                                      | Prettier, ESLint, Svelte/TypeScript check, 23 unit tests, production build, 15 static policy invariants, and `npm audit --audit-level=high`.                                                                                                                                                                                                                                                                                               |
| Unit tests                               | PASS · 23/23                              | Seven Vitest files; includes approved/pending/stale canon rules, distinct hypothetical branches, duration validation, manual provider fallback, and mocked Cloudinary authorization/upload failure/reconciliation/export.                                                                                                                                                                                                                  |
| Local anonymous E2E (`npm run test:e2e`) | PASS · 5 passed, 3 skipped                | Login/setup, responsive layout, anonymous/private media and CSRF boundaries. Authenticated cases require the local Supabase stack.                                                                                                                                                                                                                                                                                                         |
| Local database/RLS                       | BLOCKED locally                           | `npx supabase test db` could not connect to `127.0.0.1:54322` because the local stack was not running. Docker had 1.1 GB free; no external project or service was provisioned.                                                                                                                                                                                                                                                             |
| Hosted PgTAP/RLS                         | PASS                                      | PR run `42833608157`, code SHA `68b4f86`. Includes atomic narrative import, import rollback on invalid choices, owner-only RPC grant, latest pending result invalidating the prior winner, and rejection of canonization for that pending result.                                                                                                                                                                                          |
| Direct Supabase Data API                 | PASS                                      | The hosted E2E runner created disposable synthetic owner and non-owner users. Owner write succeeded; a different authenticated user could not read owner rows or insert. No service-role key is present in the app or browser.                                                                                                                                                                                                             |
| Full authenticated E2E                   | PASS · 8/8                                | PR run `42833608157`, code SHA `68b4f86`. Covers series → season → character/lore → 120-second episode → 15 scenes → two choices → open vote/premature canon rejection → verified vote → canonical approval → continuation → ZIP export. It also proves branch 1/2 contexts differ, prior character/rule/event data remain available, imported output is estimated/validated, and ZIP entries contain canonical context and platform copy. |
| Cloudinary live acceptance               | NOT RUN · credentials absent              | Provider-boundary mocks pass; real-account acceptance remains external and is listed below. No credentials or account were created.                                                                                                                                                                                                                                                                                                        |
| Dependency audit                         | PASS at high threshold · 4 LOW advisories | `deepmerge` is a transitive advisory through the Svelte/Vite plugin chain. `npm audit --audit-level=high` exits 0. `npm audit fix --force` proposes a breaking SvelteKit downgrade and was not applied.                                                                                                                                                                                                                                    |
| Backup/restore                           | NOT RUN                                   | No external Supabase project or backup destination was provisioned.                                                                                                                                                                                                                                                                                                                                                                        |

Both hosted workflows passed on CD02 code SHA `68b4f867274e296a52c763851537ebf326f5eb8e`: baseline, Supabase startup, PgTAP/RLS, authenticated Data API checks, the 8/8 authenticated browser journey, and artifact upload. CI uses synthetic accounts only in its disposable local Supabase stack.

## Cloudinary acceptance pending a real account

No real Cloudinary credentials were available or used. The current mocks prove the application’s decision paths, but they do not prove account-side configuration. With an owner-selected account and authorized credentials, the acceptance run must:

1. Upload valid PNG/JPEG/WebP bytes through the owner session; verify server-side signature, decoded MIME/dimensions/size, authenticated/private delivery, and a `READY` metadata record only after remote verification. Confirm the stored/exported metadata contains no public delivery fallback.
2. Attempt the same upload anonymously and as a different authenticated identity; verify neither can obtain a signed upload or private delivery URL.
3. Force a rejection and a timeout after Cloudinary may have accepted the upload; verify the app preserves an `ORPHANED`/reconcilable record and does not mark it `READY` or silently make the object public.
4. Reconcile an existing valid private object and a missing, transiently unavailable, corrupt, or mismatched remote object. Verify only the valid owner object becomes `READY`; unresolved or invalid cases remain unavailable and visible as reconciliation failures.
5. Exercise a successful remote upload followed by database-finalization failure, then run reconciliation and verify the orphan is recovered without duplicate public objects or cross-owner attachment.
6. Export a ZIP as the owner and verify only that owner’s `READY` private image bytes are included; missing, foreign, failed, or non-private references are omitted and represented in `missing_frames.json`. Repeat the export without Cloudinary configuration and confirm story data still exports without a public media URL.
7. Verify the real signed-delivery expiry, cache headers, and response behavior at and after the configured expiration.

The existing mocked tests cover owner-scoped lookup, private `READY` delivery, upload failure preservation, orphan recovery and byte validation, and ZIP media inclusion/omission. They are not evidence of the real-account checks above.

## Security, AI, and delivery limits

- Supabase owner authorization uses the configured owner UID plus the administrator-managed `app_metadata.dif_studio_owner=true` claim; user-editable metadata is not trusted.
- Media binaries remain in Cloudinary; story, vote, and continuity context are read through owner-filtered Supabase queries.
- No AI/API key, provider project, Cloudinary credential, external account, paid service, merge, deployment, or checkpoint promotion was created or used. Spend: **USD $0**.
- The release remains incomplete while Cloudinary real-account acceptance and independent review are pending. Automatic AI generation is not represented as active; the no-credential manual path is the supported workflow.

## Proposed verdict

**BLOCKED.** CD02 code, database/RLS, authenticated Data API, and authenticated E2E checks passed. Live Cloudinary account acceptance and independent review remain essential gates, and the current task explicitly prohibits creating credentials, provisioning a service, or activating billing. Keep PR #14 Draft and the checkpoint **PROPOSED — NOT PROMOTED**. No merge, deployment, spend, or promotion is authorized.
