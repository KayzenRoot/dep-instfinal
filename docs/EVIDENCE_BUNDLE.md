# DIF Studio — Evidence Bundle

- **Work Order:** `DIF-MVP-ALL-001`
- **Correction Delta:** `CD01`
- **Repository:** `KayzenRoot/dep-instfinal`
- **Branch / PR:** `feat/dif-studio-mvp-001` / [Draft PR #14](https://github.com/KayzenRoot/dep-instfinal/pull/14)
- **Audit base SHA:** `d7887cfdee219f5b9e081c89e79d4ae61ee0c8f5`
- **CD01 code SHA validated by hosted CI:** `89bc16c05912a7b50b47ac3cf2cc3e9b2eef5359`
- **Evidence date:** 2026-11-10
- **Checkpoint Delta:** **PROPOSED — NOT PROMOTED**; see `docs/CHECKPOINT_DELTA.md`.

## Correction summary

CD01 explicitly maps camelCase season, character, and lore form values to Supabase snake_case columns. Other Supabase inserts and RPC payloads were reviewed and already use database column/argument names. The complete authenticated acceptance journey now exercises series, season, character/lore, a 120-second episode with 15 scenes, two choices, verified manual voting, canon approval, continuation, and ZIP export.

All 14 exposed table policies and six privileged episode RPCs require the signed, administrator-managed `app_metadata.dif_studio_owner=true` claim. Row policies also bind each row to `auth.uid()`, server routes check the configured owner UID, and the application never uses the service-role key. Hosted PgTAP and direct Supabase Data API checks passed for a second authenticated user without the owner claim.

Cloudinary upload failures remain reconcilable, orphan reconciliation downloads and revalidates the private image before setting it `READY`, and media/export paths scope assets to the authenticated owner. `ManualTextProvider` remains `NOT_CONFIGURED`; manual story editing works. Automatic story generation and its live provider integration are **pending**.

## Verification record

| Check                                                    | Result                                    | Evidence / limit                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                 | PASS                                      | 258 locked packages installed.                                                                                                                                                                                                                                               |
| `npm run check:baseline`                                 | PASS                                      | Prettier, ESLint, Svelte/TypeScript check, 18 unit tests, production build, 11 static policy invariants, and `npm audit --audit-level=high`.                                                                                                                                 |
| Unit tests                                               | PASS · 18/18                              | Six Vitest files. Covers input schemas, manual text fallback, 120-second timeline, Cloudinary upload failure/reconciliation, private-media authorization, and export filtering/inclusion.                                                                                    |
| Anonymous E2E (`npm run test:e2e`)                       | PASS · 5 passed, 3 skipped                | Login/setup, anonymous and CSRF boundaries, private-media anonymous denial, and responsive layout. Skipped cases require local Supabase Auth.                                                                                                                                |
| Local Supabase/PgTAP (`npm run test:db`)                 | BLOCKED locally                           | Local stack failed to start during image pulls (registry rate limit/container disk exhaustion); connection to `127.0.0.1:54322` was refused.                                                                                                                                 |
| Hosted PgTAP/RLS (`npm run test:db`)                     | PASS                                      | PR run `42823819918`, on code SHA `89bc16c`. RLS is forced on all 14 tables; claims, owner scoping, denied unmarked-user reads/writes/RPC, cross-owner spoofing, append-only records, and publication invariants passed.                                                     |
| Direct Supabase Data API                                 | PASS                                      | Same hosted E2E setup used signed owner and second-user access tokens: owner insert succeeded; second user could not read the owner’s series or insert its own row. The service-role key was used only to create disposable local users, never in the app/browser.           |
| Complete authenticated E2E                               | PASS · 8/8                                | PR run `42823819918`, code SHA `89bc16c`. Includes the full CD01 journey, series persistence after logout/login, non-owner and invalid-password rejection, anonymous boundary, CSRF, private-media denial, and responsive login.                                             |
| Cloudinary live upload, delivery, reconciliation, export | NOT RUN · credentials absent              | External calls were mocked at the provider boundary only. Mock tests verify authenticated private delivery, upload failure state, orphan recovery and validation, export inclusion, and omission of unavailable/foreign assets. No live account or credentials were created. |
| Dependency audit                                         | PASS at high threshold · 4 LOW advisories | One transitive `deepmerge` advisory is reported through the Svelte/Vite plugin chain. `npm audit --audit-level=high` exits 0; the forced fix proposes a breaking SvelteKit downgrade and was not applied.                                                                    |
| Backup/restore exercise                                  | NOT RUN                                   | No external Supabase project or backup destination was provisioned.                                                                                                                                                                                                          |

GitHub Actions PR run `42823819918` and push run `42823812245` passed baseline, Supabase startup, PgTAP/RLS, authenticated Data API checks, complete owner E2E, and evidence artifact upload on code SHA `89bc16c05912a7b50b47ac3cf2cc3e9b2eef5359`. Earlier CD01 attempts exposed E2E timing/locator issues; the final run passed 8/8. CI creates synthetic users only in its disposable Supabase stack. Local Supabase remains unavailable in this workspace.

## Cloudinary limits

The provider boundary is mocked because no Cloudinary credentials were supplied and this Work Order forbids creating credentials or activating services. The tests cover owner-scoped media lookup, `READY`/private delivery gates, ambiguous upload failure preservation, missing/transient orphan reconciliation, corrupt-image rejection, and authenticated ZIP export behavior. They do not validate a real account’s signing, upload, deletion, bandwidth, or delivery configuration. Those live checks remain an external gate.

## Security and privacy

- The application uses the Supabase publishable/anon key only. The signed App Metadata claim is not user-editable metadata; the owner UID is also checked by server routes.
- Media bytes stay in Cloudinary. Uploads require rights confirmation, signature plus Sharp decoding, PNG/JPEG/WebP, size/dimension bounds, generated IDs, and authenticated delivery.
- Download and ZIP export require an authenticated owner, a `READY` image record with private/authenticated delivery, and a short-lived Cloudinary URL. Missing or out-of-owner metadata is omitted from export.
- No provider key, user story content, external project, paid service, deployment, or merge was created or used. Spend: **USD $0**.

## Delivery gate

The correction code passed hosted database/RLS and complete owner E2E on the SHA above. The PR remains Draft. Keep **Checkpoint Delta: PROPOSED** and the release incomplete while live Cloudinary verification and independent review remain pending. Proposed verdict: **CORRECTION REQUIRED** until those gates are resolved or explicitly accepted by the owner. No merge, deployment, paid service, account provisioning, or promotion is authorized.
