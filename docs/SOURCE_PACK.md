# DIF Studio Source Pack

**Work Order:** `DIF-MVP-ALL-001`
**Revision:** 1.3
**Status:** V1 COMPLETE on `main` `13467ab`; V2 WO-001 planning docs **PROPOSED**; ADR-V2-001 awaits explicit owner acceptance; no V2 implementation authorized.
**Last reconciled:** 2026-11-12

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

External backup/restore remains **NOT RUN** because the Free plan exposes no scheduled backups and no restore target was provisioned. Independent review remains pending. Hosted PR CI `43038342557` and push CI `43038328934` passed at final code/test HEAD `852b970` (baseline, PgTAP 20, E2E 8/8), and PR `43041393787` / push `43041387125` passed at documentation/helper HEAD `e47ecaa`. A temporary owner-authorized Cloudflare quick tunnel was validated for public access; it is ephemeral, has no Cloudflare Access policy, and is not a production deployment. The checkpoint remains **PROPOSED — NOT PROMOTED** with proposed verdict **BLOCKED**; PR #14 remains Draft. No merge, production deployment, paid service, or promotion occurred.

## Current checkpoint after CD06

CD06 implemented the remaining issue-level acceptance gaps on top of CD05: configurable 4/6/8-second scene durations with safe rebuild, scene reorder, location/character/VHS/transition fields, prompt status and attempt counts, deterministic continuity warnings before canon approval, platform target/aspect presets, private thumbnail/crop variants with side-by-side comparison, and a production-ready ZIP with checklist, AI disclosure, hashtags, covers, credit estimates and assembly manifest. It also adds five PgTAP assertions (25/25 total) and responsive screenshots for every studio page at 360/768/1440.

A real logical backup/restore was executed against the hosted project and a local Supabase target: restored counts matched, owner login returned 200, anonymous REST returned 401, and the restored Cloudinary asset hash matched. Hosted PR `43080981120` and push `43080968791` passed at final code/test HEAD `b23d40c` (PgTAP 28 tests; E2E 9 passed in 2.3 minutes, no retry), unit tests are 28/28, and the independent reviewer agent returned **APPROVED** with only LOW residuals. The checkpoint remains **PROPOSED — NOT PROMOTED** with proposed verdict **APPROVED — ready for owner promotion**; no merge or promotion occurred.

## Owner-approved release extension — DIF-REL-001 (2026-11-11)

**Status:** approved scope change, implementation pending evidence; previous V1 auto-generation exclusion is superseded only for text generation. Final checkpoint remains PROPOSED until audited.

- Use a free hosted \*.vercel.app URL; no custom domain. Production Node 24 deployment must use an official SvelteKit Vercel adapter; retain Node adapter for local/Oracle use. Record immutable release SHA and hosted smoke.
- AI generation of episode narratives, two choice consequences (except finale), and 9:16 start/end image plus motion prompts is now NECESSARY when a supported, owner-authorized no-charge text provider is available. Gemini 2.5 Flash-Lite free tier BYOK is the candidate; Google Flow Plus and ChatGPT Plus are not substitutes for API keys. No billing activation; never send API keys to client.
- Generated content must be reviewed by the owner and imported as an editable draft, respecting existing Supabase/RLS and continuity/scene duration guarantees. The manual prompt/import fallback remains functional if provider key/allowance is missing.
- Keep images and video generated manually in Google Flow. No platform posting automation, purchased API access, or domain registration.
- Do not classify Vercel site as live/full production merely because deployment succeeds; require real owner authentication, Cloudinary media smoke, Supabase project evidence, recovery, and post-deploy verification. No automatic merge/promotion.

See GitHub issue #15 (DIF-REL-001) and this branch's Evidence Bundle for acceptance.

## Release decision ADR-DIF-V1-007 — 2026-11-12 (APPROVED SCOPE, PENDING RELEASE VERDICT)

- **Scope:** owner authorized full V1 production readiness and later V2 planning, conditional on objective verification of all NECESSARY V1 requirements. PR #14 remains the sole incremental integration path; no speculative new features.
- **Hosting:** single-owner private SvelteKit SSR on free Vercel Hobby at https://dif-studio.vercel.app (no owned domain), Node 24 adapter-vercel; existing Supabase PostgreSQL and Auth retain text/canonical truth, Cloudinary retains binary images, no service-role key in the browser.
- **Narrative AI:** official Gemini API with owner-supplied `GEMINI_API_KEY` stored only in Vercel Production; **Gemini 3.5 Flash-Lite**, structured `responseJsonSchema`, server-side Zod validation, approved-canon context, exactly 90–150 s, 4/6/8 s scene segmentation, two branch options except finale, per-scene English start/end/motion prompts. Generated content requires owner approval before persistence. Manual JSON export/import remains. Live provider acceptance generates 120 s, 15 scenes and two decisions without touching production tables.
- **Vercel ZIP safety:** Functions response budgets prevent combining up to 30 large frames into one download. Preserve full ZIP for READY owner frames with raw cumulative bytes up to **3,000,000**; reject larger full packages with HTTP 413 before streaming. Introduce `?media=lite` ZIP containing every narrative, prompt, caption and a per-frame private download listing. Each original file is obtained via owner-checked /api/media/[assetId]?download=1 as a 180-second signed Cloudinary redirect. Never publish unsigned URLs or expose files to non-owner users.
- **Exit gates:** focused and broad unit tests, lint, format, typecheck, build, policy/dependency audits, hosted PgTAP/RLS and authenticated E2E all PASS on exact HEAD, then independent audit/DoD and checkpoint promotion. Only afterward allow squash merge, deploy resulting main SHA, verify Vercel READY and exact production alias. The original owner-based production smoke is evidence for CD06 flows; later changed AI/ZIP features also require live and automated tests.
- **Known operational limits:** Cloudinary API secret previously shared in chat requires rotation in the provider and Vercel; avoid key copies in artifacts. Google Gemini free quota is finite; never auto-enable paid billing. Supabase owner e-mail recovery must be controlled by owner. AI content is for human review; videos and posts are assembled/published manually using Google Flow and CapCut.

## V1 final release closure — 2026-11-12 (APPROVED)

The owner authorized the final release. GitHub PR #14 was squash-merged normally to `main` at `441888e7ca1a80f038d97a7392a9da406eb88239` (no force-push; `main` has no branch protection configured); issue #15 DIF-REL-001 is CLOSED and all 13 foundational issues are CLOSED. No code was changed in this documentation-only checkpoint closure.

- **GitHub:** exact PR head `0a93b3f68638ddc56f1337578c3ecb4a9928c5f3` passed PR CI 43218862212 and push CI 43218854310. That head contained only documentation reconciliation beyond the separately audited runtime code SHA `8ebf44acf827f0a14ac85bd380785574d378a6e8`. Tests: 45 unit passed (live-only test intentionally skipped in CI), PgTAP/RLS PASS and authenticated Playwright 9/9 PASS; typecheck/lint/build/format and high-severity audits PASS.
- **Production:** automatic Vercel deployment `dpl_FEpLGWcuPCGRU9tN8A1BdWwbB32G` READY on the exact squash SHA, `https://dif-studio.vercel.app` assigned. Independent public-route smoke in `dpl_8eG3Yg75Ffc5KFDxDdeyDtiRD4eh` READY: health/login 200 and anonymous /app 303. The owner-supplied real-account CD06 production acceptance covers authenticated workflows, private image delivery and ZIP. The extended Gemini API 120-second/15-scene structured response was validated with the real Gemini provider using synthetic context, and ZIP lite/3 MB limits were tested.
- **Closure:** release risk LOW/STANDARD with 7 known LOW/MODERATE transient dependencies, no known HIGH/CRITICAL. Videos remain manually assembled and posted; free provider quotas must be monitored; generated content remains owner-reviewed. Rotate the Cloudinary API secret previously shared in chat and arrange owner email recovery. These are operational follow-ups, not claimed automated actions.
- **Checkpoint:** marked COMPLETED for the V1 application code and tested main production release. This documentation-only closure follows the same review/CI/PR workflow and does not modify runtime behavior. Future V2 features require separately approved scope and work orders.

## V2 addendum — DIF Studio V2 (PROPOSED, 2026-11-12)

**Status:** planning only. V1 remains the canonical production product; no V2 runtime, schema, worker, storage, deploy or spend is authorized by this addendum. ADR-V2-001 is **PROPOSED** and requires explicit owner acceptance before WO-002.

### Scope and backlog

V2 adds a private post-production pipeline on top of V1: import manually exported Flow clips, build a canonical timeline, narrate, subtitle, mix licensed audio, apply color/VHS, direct tension, preview/correct, render vertical MP4 and package manual publication. It preserves the V1 owner-only studio, Supabase Auth/PostgreSQL/RLS, Cloudinary images, Gemini opt-in and manual Flow/posting.

- **28 WOs** (#18–#45), **20 owner-approved improvements**, **6 addenda** inside existing WOs (emotion in WO-007, soundscape in WO-009, tension in WO-010, safe zones in WO-011, Quality Inspector in WO-012, Character Identity Kit in WO-017). No extra WOs.
- Full inventory, requirement→WO→proof matrix, dependency graph and execution order: [V2 execution plan](V2_EXECUTION_PLAN.md).
- Architecture options, costs, risks and required owner acceptance: [ADR-V2-001 PROPOSED](ADR_V2_PROPOSED.md).

### Requirements (PROPOSED)

- Owner-only upload, queue, preview, download and deletion of private video/audio assets; RLS and server-side owner checks on every new table and route.
- No render inside Vercel HTTP functions. A separate FFmpeg/ffprobe CPU worker is required, with lease, heartbeat, timeout, cancel, retry and idempotency.
- Private video storage outside PostgreSQL and outside the V1 Cloudinary image policy; provider and quota are not selected until WO-002 benchmark and a storage contract.
- Master 9:16 1080×1920 H.264/AAC `yuv420p`; 720p fallback only if the benchmark proves it and the owner accepts. No GPU required.
- Narration imported or local TTS only if proven; SRT/ASS by real alignment; licensed music/SFX; ducking/limiter; **simulated stereo spatial** soundscape, never Dolby Atmos.
- Deterministic edit director; Gemini only opt-in, JSON-validated and non-executing. AI never runs shell/SQL/FFmpeg, never canonizes choices and never invents retention metrics.
- Manual publishing kit only (MP4, cover, SRT, description, hashtags, attributions, AI disclosure). No posting automation, Flow/TikTok/Instagram scraping or unofficial access.
- V1 preserved behind a V2 feature flag; additive migrations; published episodes, verified votes, lore and history remain immutable. Rollback to V1 is always possible.

### Data model (PROPOSED — no migration yet)

Proposed owner-scoped entities: `video_assets`, `edit_timelines`, `edit_versions`, `render_jobs`, `render_outputs`, `audio_assets`, `subtitle_tracks`, `sfx_assets`, `series_style_bibles`, `hook_variants`, `cover_assets`, `retention_observations`, `publishing_kits`, `season_production`. All require `owner_id`, RLS `USING`/`WITH CHECK`, foreign keys, indexes, timestamps, append-only revisions where history matters, and no binary blobs. This is a proposal, not an approved schema.

### Security and operations (PROPOSED)

- Worker credentials stay server-side; browser receives only publishable keys and short-lived signed URLs. No service-role key or worker secret in client, logs, artifacts or issues.
- Upload validation covers real container/codec/PTS/VFR, size/duration/dimensions, path traversal, SSRF and malicious media. FFmpeg arguments use an allowlist with no shell interpolation; child processes have timeout and kill.
- Quotas per owner (storage, jobs, concurrent renders), retention policy, orphan reconciliation, backup/restore with per-hash media manifest, and no destructive cleanup without verified backup.
- V2 release is gated by a real benchmark, worker hardening, Vercel production smoke, independent audit and owner authorization. No paid service, GPU, domain or billing activation is implied.

### UI/UX (PROPOSED)

- Editor de timeline com upload, preview, correção, comparação antes/depois, estados vazio/loading/erro/sucesso e ações indisponíveis explicitamente rotuladas.
- Layout responsivo em 360/768/1440, operação por teclado, foco visível, contraste, `prefers-reduced-motion`, safe zones TikTok/Reels e nenhuma promessa de geração/postagem automática.
- A UI V1 permanece intacta; os recursos V2 ficam atrás de feature flag e podem ser desligados sem perder dados.

### Integration contracts (PROPOSED)

- V1 preservada: Supabase Auth/PostgreSQL/RLS, Cloudinary de imagens, Gemini opt-in e Flow/CapCut manual continuam com os contratos atuais.
- V2 UI → Supabase (metadados, timeline, fila, estado de job) → worker isolado → storage privado; o browser nunca recebe `service_role`, segredo do worker ou URL permanente de mídia.
- Contratos versionados: edit plan, manifesto de artefatos com hash, idempotency key, códigos de erro seguros, links assinados curtos, autorização em toda leitura/download e nenhuma execução de shell/SQL/FFmpeg pela IA.
- Migrações aditivas e feature flag; nenhuma alteração destrutiva em tabelas V1, episódios publicados, votos verificados, lore ou histórico.

### Deployment and rollout (PROPOSED)

- **UI/orquestração:** Vercel Hobby com `adapter-vercel`, URL atual, deploy somente do SHA exato de `main` após CI/auditoria; preview de PR não é produção.
- **Worker:** ambiente separado (candidato Oracle ARM64) provisionado apenas após WO-002 e autorização; uma concorrência inicial, segredos server-side, storage privado montado/objeto, sem alterar firewall/Portainer de produção sem autorização específica.
- **Ordem:** migrações aditivas Supabase → feature flag desligada → worker/queue → smoke → habilitação gradual; nunca render de 120 s em função HTTP.
- **Rollout:** preview → smoke do owner (auth, upload privado, render, download, expiração de URL) → produção; V1 permanece operável e o flag V2 pode ser desligado.
- **Rollback:** desligar flag, cancelar/parar jobs, reverter para o SHA anterior de `main`/Vercel, manter artefatos e metadados; nenhuma exclusão destrutiva sem backup verificado.
- **Smoke mínimo:** `/health`, `/login`, owner, API privada, upload, render, download e fronteira anônima; registrar SHA, CI e resultado.

### Definition of Done V2 (PROPOSED)

- WO-001…WO-028 all **APPROVED**, including the six addenda; no HIGH/CRITICAL defect open.
- End-to-end owner flow: script/analysis → storyboard/identity/Flow manual → upload clips → timeline → voice/subtitles/SFX/color/tension → hooks and A/B endings → QA/rescue/render → master MP4 + 30/45/60 cutdowns → covers + Publishing Kit → manual aggregate analysis → Season Factory + Interactive Universe, with rollback and privacy.
- Exact main SHA with green CI; Vercel production READY on that SHA; approved worker operational; smoke of `/health`, `/login`, owner, private API, upload, render and download; real isolated backup/restore; benchmark/quota/license evidence; independent audit; checkpoint promoted only after owner authorization.
- Missing any proof => `PARTIAL` or `BLOCKED`, never “V2 complete”.

### Decisions ledger V2 (all PROPOSED)

| ID         | Decision                                                                                                                             | Status                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| ADR-V2-001 | Vercel UI/orchestration + separate CPU FFmpeg worker + private video storage; no serverless render; US$0 target subject to benchmark | PROPOSED — owner acceptance required |
| ADR-V2-002 | Video storage provider/contract outside Postgres and outside the image Cloudinary policy                                             | PROPOSED — after WO-002              |
| ADR-V2-003 | Job queue with lease/heartbeat/retry/cancel/idempotency; one concurrent worker initially                                             | PROPOSED                             |
| ADR-V2-004 | One director (WO-010), one editor (WO-011), one exporter/QA (WO-012); creative WOs extend these modules                              | PROPOSED                             |
| ADR-V2-005 | V2 feature flag; additive migrations; V1 immutable and rollback-capable                                                              | PROPOSED                             |

### Gate

WO-001 documentation and ADR are complete only after independent audit. **WO-002+ remains BLOCKED** until: (1) WO-001 is APPROVED; (2) the owner explicitly accepts ADR-V2-001; (3) benchmark access/environment is authorized; (4) the live issue graph has no unresolved cycle or dependency. No V2 code, migration, worker, storage, deploy or spend was created by this addendum.
