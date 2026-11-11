# DIF Studio Source Pack

**Work Order:** `DIF-MVP-ALL-001`
**Revision:** 1.1
**Status:** approved scope; CD05 live Supabase/Cloudinary acceptance and hosted CI recorded on `852b970`; external backup/restore and independent review remain pending
**Last reconciled:** 2026-11-11

## Source hierarchy and context

Follow the approved hierarchy: Checkpoint → approved Decisions Ledger/ADRs → Scope → Definition of Done → Architecture → Requirements → supporting material. At the start of this work the repository had no prior code, checkpoint, ADRs, workflows, or branches. The empty `main` branch was bootstrapped with owner authorization at `b4fd54513af749d68bb7bce4c06110cd9981be39`; implementation is isolated to `feat/dif-studio-mvp-001`.

Canonical inputs are the nine-page `DIF_Studio_Codex_OneShot.pdf` and GitHub issues [#1–#13](https://github.com/KayzenRoot/dep-instfinal/issues). The 2026-11-09 approved architecture delta in those issues resolves the #4 title/body mismatch: use Supabase PostgreSQL, not SQLite or local persistence, as the source of truth. No earlier technical decisions exist in this repository.

## Product overview and scope

DIF Studio is a private, single-owner workspace for writing and producing interactive analog-horror seasons for TikTok and Instagram. The owner plans a 10–15 episode season, writes a 90–150 second narrated episode, breaks it into scenes, imports frames produced manually in Google Flow, records a verified audience choice, reviews the resulting canon update, and exports a manual Flow/CapCut package.

### Required

- Owner-only login, persistent series/season/character/lore/episode/revision/scene/poll/asset metadata, and responsive dark-horror UI.
- Manual prompt and response editing works when AI is unavailable. Supabase Auth/PostgreSQL is required to open the private studio and persist data; without it the app stays in setup/login mode, with no SQLite or in-memory substitute. Cloudinary is required for image upload and private delivery, while story editing remains available when Supabase is configured. AI may only be enabled through an eligible official provider flow or a separately configured BYOK provider; no credentials or external projects were supplied for this work.
- Episode options 1/2, verified manual vote totals, auditable retifications, and author-approved canon updates. No result is inferred or invented.
- Default 8-second storyboard scenes; exactly 120 seconds yields 15 contiguous scenes. Prompts for image/motion are English; narration and interface are pt-BR.
- Secure Cloudinary image upload/delivery with binaries outside Postgres. Original frames are preserved; derived crops use safe zones.
- ZIP/JSON/CSV/Markdown/TXT/SRT and cover metadata for Flow/CapCut and TikTok/Instagram.
- Node SSR setup and free PR CI; operational guides, backup/restore procedures, Evidence Bundle, and proposed Checkpoint Delta.

### Out of scope

Automatic video/image generation, Flow or social scraping/automation, publishing, TTS, public signup, teams/SaaS, analytics, payments, paid API use, creation of external services/projects, and deployment. No other Supabase project may be selected or changed implicitly.

## Approved architecture

1. **Application:** SvelteKit + TypeScript SSR, Tailwind CSS, Zod, Vitest, Playwright, portable Node adapter. Keep a small monolith and server-only integration modules.
2. **Identity:** Supabase Auth email/password using the supported SSR package. Public registration is disabled. Verify identity on the server with `auth.getUser()` and require the exact `SUPABASE_OWNER_USER_ID`; never authorize from editable metadata or `getSession()` alone. Cookies are HttpOnly where managed, Secure on HTTPS, SameSite, and rotated/revoked by Supabase Auth. Recovery uses the official Supabase flow.
3. **Data:** Supabase PostgreSQL with versioned SQL migrations. No SQLite and no Supabase Storage for images. Every exposed table has RLS, owner-scoped `USING` and `WITH CHECK`, foreign keys, indexes, constraints, and timestamps. Browser code gets no service-role key.
4. **Media:** Cloudinary holds image bytes; Postgres holds owner-scoped metadata only. The server validates actual image MIME, size (default maximum 10 MB), dimensions, and ownership before upload. Use authenticated delivery or short-lived signed access; no silent public fallback. Persist upload/orphan state and reconcile failed DB writes.
5. **AI:** `TextProvider` contract with structured Zod validation, timeout/error handling and an honest `NOT_CONFIGURED` state. Manual prompt/response editing is fully functional. No unofficial ChatGPT/Google access, automatic billing, or claim of Plus/API eligibility without a compliant live authorized request.
6. **Continuity:** `DRAFT`, `READY`, `PUBLISHED` episodes; published content is immutable. Canonical changes are explicit, author-reviewed, and history-preserving. A continuation cannot become canonical while a vote is open, missing, or unverified.
7. **Flow/social:** manual work only. Credits are configurable estimates, never live balances. Master is 9:16 1080×1920; feed crops are 4:5 1080×1350 and 3:4 1080×1440. No MP4 rendering or automatic posting.

### Data model

The initial schema comprises `series`, `seasons`, `characters`, `lore_facts`, `episodes`, `episode_revisions`, `scenes`, `choices`, `polls`, `poll_results`, `canonical_decisions`, `media_assets`, `image_references`, and `generation_jobs`. Every row belongs to one owner. Story mutations use transactions where available; result corrections append history rather than overwriting prior decisions.

### Server boundaries

All routes, server actions, exports, upload/download endpoints, and asset access verify the authenticated owner. Validate request bodies and uploaded bytes server-side. Apply same-origin checks to mutations, rate limits to login and expensive operations, non-leaking errors, and private/no-store response headers. Trust no forwarded client IP unless the deployment explicitly configures a trusted proxy.

## User journeys and acceptance

1. A visitor can only see login and a non-sensitive health/setup status. Invalid credentials, non-owner UIDs, expired sessions, and cross-origin mutations fail closed.
2. The owner creates “O Arquivo 17,” a 12-episode season plan, characters and lore, and can close/reopen the saved data after a new session.
3. The owner drafts a 120-second episode, edits its 15 contiguous scenes, prompts, narration, two viable options and platform copy. Saving a draft never changes canon.
4. The owner imports up to 30 PNG/JPEG/WebP frames for 15 scenes; invalid MIME, oversized, malformed and oversized-dimension images are rejected. Private assets require an authorized session.
5. The owner records a verified 1/2 result with source/time/totals, handles ties and retifications under a published rule, reviews consequences, and explicitly approves the next canonical state.
6. Authenticated export produces consistent manifest, named prompts, timeline CSV, narration TXT, valid UTF-8 SRT, captions and available private image files, with missing frames clearly listed.
7. The same manual workflow remains usable when AI credentials are absent. Supabase is still required for login/persistence; Cloudinary is required only for image operations. No failed or mocked integration is reported as live.

Responsive acceptance widths are 360, 768 and 1440 px. Keyboard operation, visible focus, labels, contrast, and `prefers-reduced-motion` are required. Controls must work or state plainly why they are unavailable.

## Issue map

| Issue   | Increment                                   |           Risk | Evidence expected                                                             |
| ------- | ------------------------------------------- | -------------: | ----------------------------------------------------------------------------- |
| DIF-001 | Foundation, Source Pack, scaffold, CI       |       Standard | clean install, dev, lint, typecheck, tests, build                             |
| DIF-002 | Owner-only Supabase Auth                    | High assurance | anonymous/non-owner/session/CSRF/rate-limit checks                            |
| DIF-003 | Responsive horror design system             |       Standard | keyboard, reduced motion, 360/768/1440 checks and screenshots                 |
| DIF-004 | Postgres schema, RLS, persistence, recovery |       Elevated | migrations, CRUD, owner RLS and backup/restore evidence                       |
| DIF-005 | TextProvider and usable manual fallback     | High assurance | structured validation and honest provider status                              |
| DIF-006 | Series bible, seasons, characters and lore  |       Standard | create/edit/reopen and contradiction review                                   |
| DIF-007 | Episode editing, options and revisions      |       Standard | duration/options/revision/canon protections                                   |
| DIF-008 | Scene decomposition and storyboard          |       Standard | exact timeline boundaries and prompt fields                                   |
| DIF-009 | Cloudinary media and frame library          |       Elevated | file validation, ownership, private delivery or explicit external block       |
| DIF-010 | Manual voting and continuity                |       Standard | both branches, tie/no-vote/retification and history                           |
| DIF-011 | Flow package and estimates                  |       Standard | authenticated ZIP/JSON/CSV and incomplete-scene warnings                      |
| DIF-012 | Narration, SRT, captions and edit manifest  |       Standard | monotonic in-range timestamps and UTF-8 exports                               |
| DIF-013 | Final QA, security, operations and evidence |       Elevated | unit/integration/E2E, lint, typecheck, build, CI, backup/restore, final audit |

The #4 issue title says “local persistence”; its body and approved delta explicitly supersede that title with Supabase PostgreSQL. The PDF and latest issue deltas agree on the remaining constraints.

## Security and privacy

- No public signup, multi-user behavior, secrets in source/browser/logs, service-role key in client, or authorization by user-editable metadata. Server routes also verify the configured immutable owner UID; Postgres RLS additionally requires the signed, admin-managed `app_metadata.dif_studio_owner=true` claim and the row UID to match `auth.uid()`.
- RLS applies to every table exposed through PostgREST. Storage for images is Cloudinary only. Private media/export endpoints do not reveal permanent public URLs.
- Images require content-based validation, strict size/dimension limits, generated names, path-safe IDs, ownership checks, and no SVG.
- Login/mutation throttling, same-origin checks, safe error messages, secure headers, and backup handling are part of acceptance.
- The app stores no social viewer identifiers unless strictly needed; vote totals may be entered manually with source and limitation documented.
- Live Supabase/Cloudinary/AI checks remain **BLOCKED — external configuration** until dedicated owner-selected project settings and credentials are supplied. No service was created or modified for this work.

## Test and delivery plan

During implementation run targeted checks only when auth, RLS/migrations, or storage security can regress. At DIF-013 run clean install, lint, typecheck, unit/integration tests, build, Playwright E2E, security/dependency checks, responsive and accessibility checks, and backup/restore. Mocks may test isolated boundaries but do not establish external integration. CI runs on pull requests at no required paid tier.

Deployment documentation may describe a future Node + HTTPS deployment. This Work Order does not authorize creating hosting, Supabase/Cloudinary projects, paying for services, deploying, merging, or promoting the checkpoint.

## Decisions ledger

| ID      | Decision                                                                       | Status                                                 |
| ------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| ADR-001 | SvelteKit SSR + Supabase Auth/Postgres; owner UID allowlist and RLS; no SQLite | Approved in 2026-11-09 deltas                          |
| ADR-002 | Cloudinary binaries with authenticated delivery; Postgres metadata only        | Approved in 2026-11-09 deltas                          |
| ADR-003 | Manual, verified voting and explicit immutable canon revisions                 | Approved in Work Order and issues                      |
| ADR-004 | Provider abstraction; manual operation is the guaranteed fallback              | Approved; live AI eligibility/configuration unverified |
| ADR-005 | One integrated feature branch and one Draft PR; stop before merge/deploy       | Approved                                               |

## Definition of Done

- All DIF-001..013 acceptance criteria are mapped to implementation/evidence; no known HIGH/CRITICAL finding remains.
- Clean install, dev server, lint, typecheck, unit/integration/E2E, build, CI, security, responsive, accessibility and backup/restore evidence is recorded with exit codes.
- Private routes, owner RLS and media authorization are demonstrated locally; external live checks are labeled blocked where configuration is absent.
- README, `.env.example`, SQL migrations, operational/backup instructions and Evidence Bundle match the actual code.
- One branch `feat/dif-studio-mvp-001`, one Draft PR, no merge/deploy/spend. Checkpoint Delta is PROPOSED only.

## Historical bootstrap checkpoint

At the end of CD01, the Checkpoint Delta was **PROPOSED — NOT PROMOTED**. The original authorized bootstrap base is `b4fd54513af749d68bb7bce4c06110cd9981be39`; CD01 began at `d7887cfdee219f5b9e081c89e79d4ae61ee0c8f5`. Hosted PgTAP/RLS, authenticated Data API checks, and the complete E2E passed on code SHA `89bc16c05912a7b50b47ac3cf2cc3e9b2eef5359`. At that historical checkpoint the proposed verdict was **CORRECTION REQUIRED** while live Cloudinary verification and independent review remained pending. The current CD02 state is recorded below and in `docs/CHECKPOINT_DELTA.md` and `docs/EVIDENCE_BUNDLE.md`.

## Current checkpoint after CD02

The CD02 audit base `a7cfc9edce735bd4d0900ca7de2b9e12c434bab4` was revalidated before implementation. Hosted PR and push CI passed against application/test SHA `68b4f867274e296a52c763851537ebf326f5eb8e`, including database/RLS, authenticated owner-boundary Data API checks, and the complete continuation/export browser journey. Manual story generation remains supported through full-context prompt export and validated response import. No eligible configured official AI provider was established, so automatic generation remains pending. The Cloudinary mocks are not live account evidence. The current Checkpoint Delta remains **PROPOSED — NOT PROMOTED** with proposed verdict **BLOCKED** pending the real-account Cloudinary acceptance and independent review. The PR remains Draft; no merge, deployment, paid service, external provisioning, or promotion occurred. The Evidence Bundle documents exact pending external acceptance steps.

## Current checkpoint after CD05

Live acceptance was executed on 2026-11-11 against the dedicated Supabase project `dif` and Cloudinary environment `dt4qdzuus`; credentials stayed in the git-ignored `.env`. Migrations produced 14 tables, 50 policies, 22 functions, and RLS on every table. The owner login, private media upload/delivery, unauthenticated and cross-owner denial, upload rejection, failed-upload preservation, reconciliation, signed-URL expiry, and authenticated ZIP export with private media all passed. Live reconciliation exposed an SDK 404 error-shape mismatch, corrected in commit `b89240f061d9976a0a7db28003d63d5daf977dfe` with unit coverage.

External backup/restore remains **NOT RUN** because the Free plan exposes no scheduled backups and no restore target was provisioned. Independent review remains pending. Hosted PR CI `43038342557` and push CI `43038328934` passed at final code/test HEAD `852b970` (baseline, PgTAP 20, E2E 8/8). A temporary owner-authorized Cloudflare quick tunnel was validated for public access; it is ephemeral, has no Cloudflare Access policy, and is not a production deployment. The checkpoint remains **PROPOSED — NOT PROMOTED** with proposed verdict **BLOCKED**; PR #14 remains Draft. No merge, production deployment, paid service, or promotion occurred.
