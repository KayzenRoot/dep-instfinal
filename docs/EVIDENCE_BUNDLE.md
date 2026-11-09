# DIF Studio — Evidence Bundle

- **Work Order:** `DIF-MVP-ALL-001`
- **Repository:** `KayzenRoot/dep-instfinal`
- **Execution branch:** `feat/dif-studio-mvp-001`
- **Base SHA:** `b4fd54513af749d68bb7bce4c06110cd9981be39`
- **CI-verified source and workflow SHA:** `c84ab7833f5417c77ea49727e97bc0c52edda94f`
- **Evidence date:** 2026-11-09
- **Status:** hosted CI passed on the verified source/workflow SHA above; Draft PR awaits independent review

## Delivery summary

The MVP implementation and operational documentation are prepared on one feature branch. The authorized `main` branch remains the base. No project credentials were available, no external provider or cloud project was configured, and no service was provisioned. The approved checkpoint remains **PROPOSED** until independent review and a separate owner decision.

## Verification record

| Check                                                    | Result                         | Evidence / limitation                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean dependency install (`npm ci`)                      | PASS · exit 0                  | 255 packages installed from `package-lock.json`; npm reported four low-severity advisories.                                                                                                                                                                                                        |
| Baseline (`npm run check:baseline`)                      | PASS · exit 0                  | Prettier, ESLint, Svelte/TypeScript check, 10 unit tests, production build, 10 static policy invariants, and `npm audit --audit-level=high`.                                                                                                                                                       |
| Unit tests                                               | PASS · 10/10                   | Four Vitest files; includes input schemas, manual provider state, 120-second/15-scene timeline, and SRT/CSV formatting.                                                                                                                                                                            |
| Anonymous browser E2E (`npm run test:e2e`)               | PASS · 5 passed, 3 skipped     | Health/setup, anonymous boundary, CSRF, private media redirect, and login layout at 360/768/1440 px. The skipped cases require an initialized local Supabase Auth stack.                                                                                                                           |
| Local database tests (`npm run test:db`)                 | BLOCKED · exit 1               | Local Postgres at `127.0.0.1:54322` refused the connection because the Supabase stack could not start. Docker Desktop became available, but registry pulls for Postgres, Postgres Meta, Edge Runtime and Logflare returned EOF/HTTP 500 errors. PgTAP SQL is present but was not executed locally. |
| Owner/non-owner browser E2E (`npm run test:e2e:local`)   | PASS · 8/8 on GitHub Actions   | Hosted runner started the local Supabase stack and verified owner login, non-owner rejection, invalid-password rejection, series persistence across logout/login, anonymous boundaries, CSRF, media, and responsive layout. Local Docker registry failures still prevent a local run.              |
| GitHub Actions                                           | PASS · exact SHA above         | Both push and PR runs passed `npm ci`, baseline, Supabase startup, PgTAP/RLS tests, authenticated Playwright E2E (8/8), and artifact upload. Actions use Node 24-compatible releases; one informational `ubuntu-latest` migration notice remains.                                                  |
| Backup/restore exercise                                  | NOT RUN                        | Restore steps are documented; no external project or backup location was provisioned.                                                                                                                                                                                                              |
| Live Supabase, Cloudinary, AI, Flow, social integrations | BLOCKED · configuration absent | No external credentials were supplied or used.                                                                                                                                                                                                                                                     |

`npm audit` reports four **LOW-severity affected packages** from one `deepmerge` advisory, transitively included by the current SvelteKit plugin chain. There were no HIGH or CRITICAL findings at verification time. `npm audit fix --force` proposes a breaking downgrade to `@sveltejs/kit@0.0.30`; it was not applied. Recheck advisories during review because dependency data can change.

## Issue evidence map

The table records implementation and evidence honestly; it does not claim external acceptance where a required service could not run.

| Issue   | Implementation                                                                                             | Evidence / remaining validation                                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DIF-001 | Foundation, locked dependencies, Source Pack, CI                                                           | Clean install, lint, typecheck, unit tests, build and audit pass locally and on hosted CI.                                                                      |
| DIF-002 | Supabase owner allowlist, private auth routes, recovery, same-origin mutation checks                       | Hosted E2E passes owner login, invalid-password and non-owner scenarios, plus anonymous, CSRF and private-media boundaries. Local Supabase remains unavailable. |
| DIF-003 | Responsive pt-BR dark-horror login and studio UI                                                           | Login has no horizontal overflow at 360/768/1440 px. Screenshots below. Authenticated workspace visual checks await local/CI Supabase.                          |
| DIF-004 | PostgreSQL schema, 14 forced-RLS tables, composite owner foreign keys, transactional RPCs, backup manifest | Static policy audit and hosted PgTAP/RLS execution pass across the 14 tables. Local Docker is unavailable.                                                      |
| DIF-005 | Structured `TextProvider`; honest manual-only fallback                                                     | Unit tests verify `NOT_CONFIGURED` and two-choice schema validation. No AI provider or billing is configured.                                                   |
| DIF-006 | Series, seasons, characters, lore and continuity screens/actions                                           | Hosted owner E2E creates a series and verifies it persists across logout and a new login; remaining workflows need focused acceptance coverage.                 |
| DIF-007 | Episode authoring, options, revisions and publication guards                                               | Hosted PgTAP validates database integrity and publication guards; input validation unit tests pass. Authenticated episode authoring still needs focused E2E.    |
| DIF-008 | Contiguous eight-second scene timeline and storyboard editor                                               | Unit test verifies 120 seconds gives 15 scenes, and validates the 90–150 second range. Persisted storyboard E2E awaits DB-backed CI.                            |
| DIF-009 | PNG/JPEG/WebP validation, Sharp decode, Cloudinary authenticated upload, owner-checked private proxy       | Static security audit passes. Live upload, deletion/reconciliation and private delivery cannot be tested without a selected Cloudinary account and credentials. |
| DIF-010 | Manual poll/result verification, append-only retification and explicit canon decisions                     | Hosted PgTAP validates database constraints/RPCs; owner-scoped screens are implemented. No real poll or audience data was used.                                 |
| DIF-011 | Authenticated Flow/CapCut ZIP with manifest, prompts, CSV and missing-frame report                         | Export route is implemented; unit tests cover CSV formatting. DB-backed archive and private-frame integration await CI/provider configuration.                  |
| DIF-012 | pt-BR narration, SRT, captions and timeline export                                                         | Unit tests verify ordered SRT cues, UTF-8 content, and CSV escaping. Full authenticated package validation awaits DB-backed E2E.                                |
| DIF-013 | Operations, security policy audit, CI and this Evidence Bundle                                             | Static audit, local baseline, and hosted CI pass. Independent audit and backup/restore remain pending; checkpoint promotion is outside this Work Order.         |

## Browser captures

These are the login/setup surface only, captured with provider credentials blank. They show the required viewport widths and do not represent an authenticated dashboard.

- [360 px](evidence/screenshots/login-360.png)
- [768 px](evidence/screenshots/login-768.png)
- [1440 px](evidence/screenshots/login-1440.png)

CI also uploads browser screenshots and the Playwright report as the `dif-studio-browser-evidence` artifact.

## Security and privacy evidence

- Static policy audit: **10/10 invariants pass**, including all 14 public owner-scoped tables, forced RLS, append-only grants, verified server UID ownership, same-origin mutations, content-decoded media uploads, owner-bound private media, and expiring export links.
- No service-role key is passed to the app/browser. The local E2E wrapper uses a local admin key only to create disposable test users, then supplies the app only the local anon key and exact owner UID.
- No credentials, provider keys, user content, social identifiers, or external-project identifiers were added to the repository.
- Database policy and data-integrity tests under `supabase/tests/rls_and_integrity.sql` passed on the hosted Supabase local stack.
- Only source code, configuration templates, documentation, and login screenshots are included. `.env` and generated build/test directories are ignored.

## Cost and free-tier estimate

**Spend incurred by this Work Order: USD $0.** No provider account, external project, hosting, domain, paid API, or production resource was provisioned. The following are current official plan references checked on 2026-11-09, not a promise of production capacity:

| Service                                        | Current no-cost reference       | Planning limit                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase                                       | Free plan: $0/month             | Two active Free projects; 500 MB database and 5 GB egress per project. Free projects pause after a week of inactivity; automatic backups are not included.     |
| Cloudinary Image/Video API                     | Free plan: $0, no card required | 25 credits/month shared across transformations, managed storage and bandwidth; one credit equals 1,000 transformations, 1 GB storage, or 1 GB image bandwidth. |
| OpenAI / other AI                              | Not configured or called        | No AI spend. Future API cost depends on the owner-selected model and usage; manual editing remains available.                                                  |
| Google Flow, social platforms, hosting, domain | Manual / not provisioned        | No automated calls, posting, hosting or domain cost was incurred or estimated.                                                                                 |

The current private-media proxy fetches an expiring Cloudinary `private_download_url` server-side. Cloudinary documents that these requests are not CDN-cached, so measure Cloudinary bandwidth and the selected Node host's egress before importing many frames. A Free tier is not a backup or uptime guarantee. [Supabase plan limits](https://supabase.com/pricing) · [Supabase Free project behavior](https://supabase.com/docs/guides/platform/billing-on-supabase) · [Cloudinary plan credits](https://cloudinary.com/documentation/billing_and_plans) · [Cloudinary private media delivery](https://cloudinary.com/documentation/control_access_to_media).

## Delivery gate

The change is one Draft PR linking DIF-001 through DIF-013. Hosted CI passed on the recorded source/workflow SHA; keep the PR in draft for independent review. Do not merge, deploy, promote the checkpoint, provision external accounts, or incur provider spend under this Work Order.
