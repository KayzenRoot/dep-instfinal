# DIF Studio — Evidence Bundle

## V2 WO-006 — FFmpeg composition, transitions and VHS 9:16 (2026-11-13)

- **Work Order:** `DIF-V2-WO-006` · issue #23 · epic #17
- **Base:** `main` `b1081e9` (checkpoint WO-003/004/005 promoted)
- **Branch:** `feat/dif-v2-wo-006`
- **Status:** implementation, real FFmpeg composition, ffprobe integration, PgTAP and real-worker E2E **PASS**; hosted CI `43426225313` **PASS** (9m45s); independent audit **pending**. No VPS deployment.

| Check       | Result     | Evidence                                                                                                               |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Composition | PASS       | deterministic allowlisted FFmpeg graph: trim/scale/crop/fps/concat/xfade/VHS; H.264 High/yuv420p/faststart             |
| Integration | PASS       | 15×8s 180x320 → 120s 1080x1920 H.264, 39.6 MB, ffprobe duration ±1s, SHA-256                                           |
| Worker      | PASS local | `render-job.ts` revalidates plan/context, verifies assets, renders and completes manifest; `WORKER_STUB=0` + kill tree |
| E2E         | PASS local | real 15-clip upload → approved plan → real worker READY → second job canceled; 4.2m                                    |
| Database    | PASS       | worker read grants migration; PgTAP **82/82**; policy 23 invariants/20 tables                                          |
| Unit/build  | PASS       | 99 passed + 1 skipped; lint/typecheck/build                                                                            |
| Limits      | —          | video-only; R2 worker path untested live; VFR/rotation fixtures, preview rendition and VPS smoke pending               |

**Verdict:** WO-006 implementation is locally green; hosted CI and independent audit pending. READY now means a validated 1080x1920 H.264 artifact. Audio/captions/preview remain WO-007/008/009/011. No deploy, merge or checkpoint promotion.

## V2 WO-005 — Render job engine, worker stub and recovery (2026-11-13) — PROMOTED

- **Work Order:** `DIF-V2-WO-005` · issue #22 · epic #17
- **Merged:** `main` `dc405d8` (squash of PR #50), 2026-11-13
- **Status:** implementation, PgTAP, unit, policy and timeline+worker E2E **PASS**; hosted CI `43383787230` **PASS** (6m25s); final independent audit **APPROVED** at `6ca4523`. Checkpoint promoted by the owner. No VPS deployment, container or firewall.

| Check          | Result     | Evidence                                                                                                                               |
| -------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Database/state | PASS       | `20261113100000_v2_wo005_render_jobs.sql`; PgTAP **81/81**; one active job, advisory lock/SKIP LOCKED, lease, retry, cancel, reconcile |
| Worker         | PASS stub  | `scripts/render-worker.mjs` claims/starts/heartbeats/completes; SIGTERM abort; `WORKER_STUB=1` only                                    |
| API/UI         | PASS local | `/api/render-jobs` enqueue/list/status/cancel; timeline render panel and polling                                                       |
| Unit/policy    | PASS       | 95 + 1 skipped; policy 23 invariants/20 tables; lint/typecheck/build                                                                   |
| E2E            | PASS local | approve -> enqueue -> worker READY -> second job cancel; timeline also covers 409/stale/rebuild                                        |
| Safety         | PASS       | owner-only SELECT, service-only RPCs, sanitized events, no worker HTTP port, no secret in client                                       |

**Verdict:** WO-005 implementation is locally green pending hosted CI and independent audit. Real FFmpeg execution, process termination/temp cleanup and least-privilege VPS credential remain WO-006/WO-013. Merge of stacked WO-003/WO-004/WO-005 requires explicit owner authorization.

## V2 WO-004 — Timeline canônica, alinhamento e versões (2026-11-13) — PROMOTED

- **Work Order:** `DIF-V2-WO-004` · issue #21 · epic #17
- **Merged:** `main` `c6be101` (squash of PR #51), 2026-11-13
- **Status:** implementation, unit/PgTAP/E2E and hosted CI **PASS**; final independent audit **APPROVED** at `637aaa9`; checkpoint promoted by the owner.

| Check                  | Result           | Evidence                                                                                                                                                                                   |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope                  | PASS (code/docs) | Additive edit-plan migration; domain/schema; server RPC wrappers; `/app/timeline`; tests; no canon/episode mutation                                                                        |
| Database/RLS           | PASS             | `20261113090000_v2_wo004_edit_plans.sql` + `20261113091000_v2_wo004_edit_plan_server_rpc.sql`; PgTAP **58/58**; owner read-only tables and server-only RPCs                                |
| Domain/schema          | PASS 12          | 120/15×8, 90/150 partial, reorder, trim, crossfade, foreign/double-booked assets, canonical hash                                                                                           |
| Unit/format/typecheck  | PASS             | 93 passed + 1 skipped; lint 0; typecheck 0/0; build adapter-node PASS                                                                                                                      |
| Policy audit           | PASS             | 22 invariants across 18 tables, including edit plans owner-only/versioned/append-only and server-only writes                                                                               |
| E2E                    | PASS             | hosted CI `43376699502`: 15 clips/reorder/save, HTTP 409 stale restore, approve, restore v1→v3, revision append, stale warning, rejected approval, rebuild v4 in 15.3s; suite 11/11 (3.2m) |
| Optimistic concurrency | PASS             | P0001/409 for stale expected_version (no 40001 retry storm); NULL rejected; restore appends v2; history preserved                                                                          |
| Safety                 | PASS             | no merge, production deploy, paid service, secret or checkpoint promotion                                                                                                                  |

**Verdict:** WO-004 implementation and evidence are **PASS** pending independent audit. `video_edit_plans` stays separate from episode/canon writes; published episodes reject saves; versions are immutable. Merge of stacked WO-003/WO-004 requires explicit owner authorization. WO-005+ remains blocked until both approvals.

## V2 WO-003 — Private Flow clip ingest + Cloudflare R2 (2026-11-12) — PROMOTED

- **Work Order:** `DIF-V2-WO-003` · issue #20 · epic #17
- **Base:** `main` `b0f78064a2a5902acc98c20efc92648ec540b7e9` (WO-002 merge)
- **Branch:** `feat/dif-v2-wo-003`
- **Merged:** `main` `ac55d27` (squash of PR #48), 2026-11-13
- **Status:** final independent audit **APPROVED** at `c07af6e`; H1/H2, M4/M9/M11/M12, session-key and M4 recovery findings are closed. Local tests and live R2 acceptance **PASS** (15 clips); lifecycle automation, real ffprobe worker validation and orphan GC remain tracked for later WOs. Checkpoint promoted by the owner.

| Check                   | Result                             | Evidence                                                                                                                                                                                   |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope                   | PASS (code/docs only)              | Additive migrations, R2/in-memory storage adapter, ffprobe/fixture probe, upload/complete/list/download routes, `/app/video`, schemas, unit/PgTAP/E2E tests; no production deploy or spend |
| Database/RLS            | PASS                               | `20261112170000_v2_wo003_video_storage.sql` + `20261112200000_v2_wo003_asset_boundary.sql` + `20261112210000_v2_wo003_session_boundary.sql`; `supabase test db` **42/42**                  |
| Unit tests              | PASS                               | probe 15, storage 4, schemas 6, service 11; full suite **81 passed + 1 skipped**                                                                                                           |
| Policy audit            | PASS                               | `npm run audit:policy`: 20 invariants across 16 tables                                                                                                                                     |
| Lint/typecheck/build    | PASS                               | `npm run lint`; `npm run typecheck` 0/0; `npm run build`                                                                                                                                   |
| E2E 15 clips + reload   | PASS                               | Hosted CI run `43332950992` on `7f2cc69`: PgTAP 42/42 and full E2E **10/10 (2.6m)**; video spec 16.2s with READY assertion and reload                                                      |
| R2 bucket               | PASS (manual)                      | `dif-studio-video-private` created; public access not enabled                                                                                                                              |
| R2 token/CORS/lifecycle | TOKEN/CORS PASS; lifecycle PENDING | Bucket-scoped token `-2` lacks lifecycle permission (`AccessDenied`); CORS configured; first token exposed in local output was revoked; no secret committed                                |
| Live R2 upload/read     | PASS                               | `check:r2` PASS; 15-clip E2E live PASS (2.2m), reload and anonymous 401; 15 objects cleaned, 30 multipart aborted                                                                          |
| Independent audit       | **APPROVED at `c07af6e`**          | Final audit: no blocking findings; H1/H2, session-key H1 and M4 recovery B1 closed; M2 quota residual non-blocking for single-owner and tracked for WO-013/WO-005                          |
| Safety                  | PASS                               | No production deploy, paid service, credential in Git/logs, or checkpoint promotion                                                                                                        |

**Verdict:** WO-003 implementation, RLS, local tests and live R2 upload/read are **PASS**; final independent audit **APPROVED** at `c07af6e`. Lifecycle automation, worker ffprobe and orphan GC remain WO-005 items, and M2 quota hardening is tracked for WO-013/WO-005. WO-004+ is unblocked by the owner-approved promotion; the checkpoint is **PROMOTED**.

## V2 WO-002 — Oracle ARM64 benchmark (2026-11-12)

- **Work Order:** `DIF-V2-WO-002` · issue #19 · epic #17
- **Base:** `main` `01405cbb641e7814cbd964157d0814ba4e23d7c7` (after WO-001/PR #46 squash merge)
- **Benchmark evidence commit:** `95cbc53b9da9d0b4349e450e9cbd32b714fe2c42` (branch head before this docs-only SHA record)
- **Branch:** `bench/dif-v2-wo-002`
- **Status:** benchmark **GO CONDITIONAL**; evidence **APPROVED** by independent audit (2026-11-12), non-blocking corrections applied; checkpoint V2 **PROPOSED — NOT PROMOTED**; WO-003+ remains **BLOCKED** until ADR-V2-002/storage and owner authorization.

| Check                      | Result | Evidence                                                                                                                                                                            |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment inventory      | PASS   | Oracle ARM64, Neoverse-N1, 2 vCPU, 11,924 MB RAM, no swap, 177 GB free; FFmpeg/ffprobe 7.0.2-static aarch64 (GPLv3, libx264/AAC); `logs/inventory.txt`                              |
| 3 × 1080×1920 renders      | PASS   | 69.65–70.53 s (mean 70.02 s), RTF 0.58, 1.72× realtime, max RSS 364,572 KB, 188–191% process CPU (2 vCPU), 103,939,130 B output; `logs/summary.csv`, `runs/run1..3/`                |
| 720×1280 comparison        | PASS   | 46.55 s, RTF 0.39, 214,264 KB, 31,557,798 B; `runs/run720/`                                                                                                                         |
| ffprobe/decoder validation | PASS   | 120.000000 s, exact 9:16, H.264 30 fps + AAC 48 kHz stereo, `decode_rc=0`, zero decoder stderr; four `validation.txt` files                                                         |
| Determinism                | PASS   | All three 1080p outputs share SHA-256 `1f0b31a4…ee6f73a`; 720p `f4c624dc…5de28c`                                                                                                    |
| Disk/I/O                   | PASS   | `dd` write 112 MB/s before, 111 MB/s after; 177 GB free before/after; benchmark used 747 MB, removed; aggregate 180.0 MiB read / 592.5 MiB written; O_DIRECT unsupported on this FS |
| Failure handling           | PASS   | timeout rc 124 / 0 orphans; corrupt input rc 183 (“moov atom not found”); simulated low disk (`ulimit -f`) rc 153, 2 MiB partial, no real disk fill; recovery 10.000 s PASS         |
| CPU saturation             | PASS   | 2× `yes`: 6 s baseline → 43 s loaded (7.17×), 5 s recovered (0.83×); load 0.43 after ~3 min 19 s; concurrency must remain 1                                                         |
| Service health             | PASS   | `nginx`, `docker`, `containerd`, `code-server@ubuntu` active; `9router` running/healthy; local latency max 7 ms (20128) / 5 ms (36401) under load; no residual ffmpeg/yes           |
| Scope/safety               | PASS   | Synthetic inputs only; no production data, secret, sudo, daemon, new port, paid service, GPU, schema, worker, production deploy or spend (automatic PR preview only); `cleanup.txt` |
| Evidence package           | PASS   | `docs/V2_BENCHMARK_WO002.md`, `scripts/v2-bench/benchmark.sh`, `docs/evidence/wo-002/` (tar SHA-256 `8c2a524b…c50543`, `SHA256SUMS` verifies)                                       |
| CI                         | PASS   | PR #47 `quality` 4m43s (`check:baseline`, `test:db`, `test:e2e:local`); 45 tests + 1 skip, 9 E2E; SonarCloud/Socket/Vercel PASS                                                     |
| Independent audit          | PASS   | **APPROVED** 2026-11-12; no HIGH/CRITICAL; M1–M3/LOW corrections applied; WO-003+ still blocked                                                                                     |

**Verdict:** benchmark **GO CONDITIONAL** for a single-concurrency FFmpeg worker on the existing Oracle ARM64 VPS. Quantitative basis: 120 s 9:16 in ~70 s (RTF 0.58), 365 MB peak RSS, 177 GB free, ~94% of 2 vCPU and US$ 0 incremental compute (estimate; no billing API checked). The VPS does not support concurrency >1 or guaranteed interactive latency during a render. No checkpoint promotion, merge, production deploy, worker, schema change or spend occurred; the automatic PR preview is not production.

**Audit findings (non-blocking, 2026-11-12):** M1 — the main render exercised only `nice`, not `ionice`, 10-minute timeout, 2 GB quota or memory limit; those are WO-003+ requirements and are documented as such. M2 — the harness `cleanup()` no longer deletes its own size log; it prints the size before removal. M3 — `ps -o pcpu` is a cumulative average, so the CSV column is now `final_pcpu_avg_pct`, not a peak. LOW corrections: `vmstat` provenance and the ~3 min 19 s rest period are explicit; the timeout rerun is documented; the tar scope and missing FFmpeg binary hash are stated; the `.gitignore` exception is restricted to `docs/evidence/wo-002/**/*.log`; `V2_EXECUTION_PLAN.md` status is updated; the deploy wording distinguishes the automatic PR preview from production; probes/`dd` commands are documented; CI evidence is included. M1 remains a WO-003+ implementation/test obligation.

## V2 WO-001 — V1 gate closure + V2 planning/ADR (2026-11-12)

- **Work Order:** `DIF-V2-WO-001` · issue #18 · epic #17
- **Base:** `main` `13467ab009e0eaaee1be6ba2e35678228cfbdf32` (after PR #16 squash merge)
- **Branch:** `docs/dif-v2-wo-001`
- **Status:** documentation **APPROVED** by independent re-audit at `ae1f44d`; **ADR-V2-001 ACCEPTED** by the owner (2026-11-12); **WO-002 benchmark authorized**; WO-003+ remains BLOCKED until benchmark GO.

| Check                | Result            | Evidence                                                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 gate PR #16       | PASS              | Draft/mergeable CLEAN, CI `43220790406` PASS, Vercel preview success; independent agent audit recorded outside GitHub (GitHub shows only Copilot `COMMENTED`) returned **APPROVED**, net diff only in the three V1 docs. Squash-merged normally at `13467ab` (no force-push; `main` has no branch protection). |
| Post-merge V1 smoke  | PASS              | `/health` 200, `/login` 200, anonymous `/app` 303. Exact Vercel deployment SHA not independently verifiable without a Vercel credential; the production alias responds as documented.                                                                                                                          |
| WO-001 scope         | PASS (docs only)  | `docs/ADR_V2_PROPOSED.md`, `docs/V2_EXECUTION_PLAN.md`, Source Pack V2 addendum, V2 Context Lock, this Evidence Bundle section, Checkpoint Delta. No code, schema, migration, worker, storage or secret; no production deployment (the PR's Vercel preview is automatic and is not production).                |
| ADR V2               | ACCEPTED          | Architecture options A–E, worker/storage/queue contract, costs/risks/rollback; owner accepted ADR-V2-001 on 2026-11-12. No runtime implementation yet.                                                                                                                                                         |
| Inventory/graph      | PASS              | 28 WOs #18–#45, 20 improvements with 1:1 ownership, 6 addenda, explicit vs proposed edges, cycle check, key constraints (WO-024→WO-025; WO-013 final; WO-014 terminal; WO-026 needs WO-019+WO-025).                                                                                                            |
| Context Lock         | PASS              | Base SHA, critical-source SHA-256 fingerprints, issue states, tool capacity (`ffmpeg`/`ffprobe` absent, Oracle VPS unverified), budget, stale triggers.                                                                                                                                                        |
| V2 implementation    | WO-002 AUTHORIZED | Epic #17 remains PLANNED/PROPOSED; all 28 WOs are OPEN/UNAPPROVED; ADR-V2-001 is **ACCEPTED**; WO-002 benchmark is authorized. WO-003+ remains blocked until benchmark GO.                                                                                                                                     |
| Tests                | PASS (docs)       | Prettier/format and docs-only diff; hosted CI `43240827515` PASS no head de correção `ae1f44d`. Runtime tests are not applicable because no runtime file changed.                                                                                                                                              |
| Independent re-audit | PASS              | First audit: CORRECTION REQUIRED (3 MEDIUM/3 LOW, no HIGH/CRITICAL). Corrections applied; re-audit returned **APPROVED**, confirming only six `docs/` files changed.                                                                                                                                           |

**Verdict:** WO-001 documentation is **APPROVED** and ADR-V2-001 is **ACCEPTED**. **WO-002 benchmark is authorized**; WO-003+ must not start until WO-002 returns GO and the preceding WO is APPROVED. No checkpoint promotion, merge, production deploy, spend, migration or external provisioning occurred; the PR's Vercel preview is not production.

## FINAL V1 RELEASE — operational closure (2026-11-12)

**Verdict: APPROVED / COMPLETED** for V1 private single-owner release. User authorization and independent audit were recorded before the guarded squash merge.

- **Repo:** `KayzenRoot/dep-instfinal`; initial full MVP PR #14 `MERGED`; exact original PR head `0a93b3f68638ddc56f1337578c3ecb4a9928c5f3`; squash merge/main commit `441888e7ca1a80f038d97a7392a9da406eb88239`.
- **Full GitHub checks:** PR `43218862212` and push `43218854310` PASS on the exact PR head. Baseline PASS, 45 unit pass plus skipped opt-in live API test, Supabase PgTAP/RLS PASS, authenticated Playwright 9/9 PASS, lint, typecheck (zero errors), build, security policy and high severity audit PASS.
- **Vercel main production:** `dpl_FEpLGWcuPCGRU9tN8A1BdWwbB32G` READY and alias `https://dif-studio.vercel.app` confirms `441888e7ca1a80f038d97a7392a9da406eb88239` (not merely an unmerged branch). Separate external smoke `dpl_8eG3Yg75Ffc5KFDxDdeyDtiRD4eh` READY: `/health` and `/login` returned HTTP 200; anonymous `/app` returned HTTP 303 redirect to login.
- **Gemini:** real single-call 120-second, 15-scene and two choice synthetic story generation PASS, `dpl_AQwvQM1XkN1Q6Jh8J1QoJLpV21SW` READY; Gemini 3.5 Flash-Lite HTTP200, completed JSON parsed and passed runtime validation, with video/image Flow prompts and TikTok/Instagram metadata. The owner must review the material before saving/publishing.
- **Owner/Cloudinary:** separate CD06 owner-supplied production acceptance screenshots documented real login, story creation, private READY upload, signed variants and ZIP, continuation/vote and anonymous denial. The V1 code extension limits full ZIP media to 3MB and adds a lite ZIP with individual authenticated, short-lived signed originals; unit and security regressions passed. No unsanctioned user credentials were accessed in this review.
- **Issue #15:** `CLOSED`. All initial 13 module issues also closed.
- **Operational risks:** known 4 LOW/3 MODERATE transitive advisories, no HIGH/CRITICAL; rotate the Cloudinary API secret previously shared in chat; set recoverable owner email; observe Gemini and hosting free quota limits. No force-push, bypass, paid service, web posting or secret literals in this document. These follow-ups do not represent automated code changes.
- **After closure:** only a documentation checkpoint patch is proposed in a dedicated branch/PR, without runtime code changes. It is subject to CI and merge review.

---

## Independent V1 release audit and checkpoint promotion — 2026-11-12

**Decision: APPROVED FOR SQUASH MERGE AND MAIN DEPLOY** at tested code SHA `8ebf44acf827f0a14ac85bd380785574d378a6e8`. No HIGH/CRITICAL defects known. This approval covers this tested code and review of the release delta; the subsequent documentation-only checkpoint commits do not alter runtime code and remain subject to their own CI checks.

- GitHub Actions PR 43217394260 and push 43217385062 (both SUCCESS, code SHA `8ebf44acf827f0a14ac85bd380785574d378a6e8`): Prettier, lint, Svelte typecheck (0 errors), 45 unit tests PASS (1 live-only skipped), build, 15 owner/security invariants, high-severity dependency audit, Supabase PgTAP/RLS PASS, authenticated Playwright 9/9 PASS.
- Vercel production `dpl_262PubRkM9ci81aJe58FTqqTRP9u` READY at code SHA `8ebf44acf827f0a14ac85bd380785574d378a6e8`, alias `https://dif-studio.vercel.app`. Public external smoke from Vercel build `dpl_Gb1gbdrdroSs7pZPR7MQFHtmW7sJ` READY: `/health` and `/login` HTTP200, anonymous `/app` redirects HTTP303.
- Live Gemini: `dpl_AQwvQM1XkN1Q6Jh8J1QoJLpV21SW` READY. One full 120-second episode generated with actual Gemini 3.5 Flash-Lite (HTTP 200) and 15 Flow scenes, two distinct vote consequences and pt-BR narration confirmed by Zod. No real owner data was written. The unit suite also tests provider errors and OIDC.
- Original CD06 real owner smoke in production tested login, story CRUD, canon/vote, 15-scene flow, signed Cloudinary private upload/delivery, anonymous rejection and ZIP; screenshots reported success. New large-frame fallback is covered by latest unit tests and public application smoke; new UI path still warrants ordinary owner operational observation.
- ZIP mitigation: cumulative verified image bytes capped at 3 MB for embedded full ZIP; `media=lite` includes scripts/prompts/SRT and owner-only short-lived originals by signed Cloudinary redirect. All new tests PASS, unauthorized boundary preserved.
- Residual risks accepted as operational follow-ups: rotate Cloudinary API secret previously shared in private chat; owner email recovery via Supabase administrator if `owner@dif.local` cannot receive mail; high output limits/cost and rate quota for Gemini; seven low/moderate transitive dependency advisories with no high/critical; user should manually review generated narration for quality and timing.
- No external paid services were enabled or secret literals committed. Latest production already serves the tested branch build. Git main deployment is required after squash merge to align repository truth and Vercel production with the final merge SHA.

**Checkpoint promoted for code readiness: APPROVED (release candidate).** Final operational version completion requires main deployment `READY` at merge SHA and immediate public route smoke. The current release Work Order cannot advance to V2 until that evidence is verified.

## DIF-REL-001 / CD07 — release evidence (2026-11-12; verified and approved for release)

**Work orders:** DIF-MVP-ALL-001 and DIF-REL-001 (#15). **Branch / PR:** feat/dif-studio-mvp-001 / #14. The content below supersedes older historical `BLOCKED` statements only for the described gates. Historical CD01–CD06 evidence is preserved later in this file.

### Independently observed proof

- Base tested before V1 release extension: `116ef12157df6fa8ccbddba83bfa830c5a53b7ef` (GitHub actions runs `43100856029` and `43100849986`, baseline, PgTAP/RLS, authenticated Playwright 9/9 PASS). Production `https://dif-studio.vercel.app` at this SHA was `READY`, exact alias confirmed.
- Independent owner smoke (reported in the owner-supplied production acceptance screenshots) exercised real owner SSR login, season/characters/lore, episodes 1 and 2, 120 s/15 scenes, 1/2 verified votes and approval of canon, scene edits/reorder, Cloudinary private image/signatures, ZIP media/download and unauthorized/CSRF protections. This was on CD06-era production; author report includes SHA requirement `b23d40c` or newer, met by prior Vercel deployment. The report explicitly notes a 235-byte test frame and large ZIP risk.
- **Live Gemini V1 generation PASS:** Vercel deployment `dpl_AQwvQM1XkN1Q6Jh8J1QoJLpV21SW` `READY`, code `c814e05b7618d43b5599400ae84ec084542a3393`. Opt-in test `src/lib/server/ai-episode.live.test.ts` requested a single real Gemini 3.5 Flash-Lite episode with synthetic context, using the sensitive Production API key; HTTP 200, finish STOP, 20,833 characters and ~5,437 output tokens. JSON structurally parsed; Zod confirmed exactly **120 seconds**, **15 scenes**, **two distinct choices**, individual English start/end/motion prompts and TikTok/Instagram metadata; one live test PASS. No real owner database record or secret was logged or changed.
- **Prevented invalid AI releases:** earlier live experiments returned 503 transient, unsupported structured-schema 400, and short narration; validation rejected all and did not insert them. A revised compatible `responseJsonSchema`, explicit ~290-word narration target and strict Zod verification produced the PASS above. Live test is disabled in ordinary CI to avoid automatic API expense.
- **Large-media mitigation implemented:** `src/lib/domain/export-size.ts` counts raw READY attachment byte sizes (including repeated positions) with 3,000,000-byte budget, rejecting oversize full ZIPs before output. `?media=lite` retains all scripts/Flow prompts/SRT and supplies relative owner-authorized signed-original download paths, avoiding the Vercel response size cap. `/api/media/[assetId]?download=1` only signs a 180-second Cloudinary original for the authenticated owner, with no-store and no-referrer. Tests include heavy frame fallback, invalid mode, signed direct redirect and no nonowner access. Full small ZIP behavior is preserved.
- **Dependencies:** previous 7 transitive advisories (4 LOW, 3 MODERATE), no known HIGH/CRITICAL in high-threshold audit; revalidate on release SHA.
- **No forced upgrades, paid services, secret publication or auto-merge.** Cloudinary credential previously shared in chat must be rotated and verified in Vercel. Owner recovery address remains an operations follow-up; do not claim recovery delivery was tested.

### Final release gates

- [x] Latest code SHA: Prettier, lint, typecheck, 45 unit tests plus live-only skip, build, policy/dependency audit PASS on 8ebf44ac.
- [x] Exact same code SHA: hosted PgTAP/RLS + owner-synthetic E2E 9/9 PASS.
- [x] Independent audit of diff, security/privacy and data correctness: APPROVED for release, no HIGH/CRITICAL.
- [x] Checkpoint promoted to APPROVED for code release; [ ] pending squash merge PR #14, main deployment, post-deploy smoke and issue #15 closure.

---

- **Work Order:** `DIF-MVP-ALL-001`
- **Correction Delta:** `CD06`
- **Repository:** `KayzenRoot/dep-instfinal`
- **Branch / PR:** `feat/dif-studio-mvp-001` / [Draft PR #14](https://github.com/KayzenRoot/dep-instfinal/pull/14)
- **CD06 base HEAD:** `d5e43f258101af8388d030554c6ca9c0084d7309`
- **CD06 implementation commit:** `218f18f74e7720105d136c2fa3f0546ba789e9fd`
- **CD06 final code/test HEAD:** `b23d40c71272d17707120ee76e624dd422775859`
- **CD06 hosted CI:** [PR `43080981120`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43080981120) and [push `43080968791`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43080968791) — PASS (PgTAP 28 tests; E2E 9 passed in 2.3 minutes, no retry)
- **CD06 independent review:** **APPROVED** by a separate reviewer agent; no HIGH/CRITICAL findings remain; three LOW residuals documented below
- **CD06 evidence date:** 2026-11-11
- **CD05 reconciliation fix:** `b89240f061d9976a0a7db28003d63d5daf977dfe`
- **CD05 final code/test HEAD:** `852b970c03f38233b6e02e6af308dbd01bef5b72`
- **CD05 documentation/helper HEAD:** `e47ecaa6a4207fbbc66519bde10121026e1eadcb` — hosted CI PASS ([PR `43041393787`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43041393787), [push `43041387125`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43041387125))
- **Hosted PR CI (CD05):** [run `43038342557`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43038342557) — PASS
- **Hosted push CI (CD05):** [run `43038328934`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/43038328934) — PASS
- **CD05 live acceptance date:** 2026-11-11
- **CD04 audit base SHA:** `34ab6b7c9156de054dfd4969e761d456cc4890c4`
- **CD04 implementation commit:** `3c560489788d0c1efaf16dd26d81b709daad4406`
- **CD04 final code/test HEAD:** `45840f9199783c251c4da8b10bff3fcda14de629`
- **Hosted PR CI (CD04):** [run `42898556365`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42898556365) — PASS
- **Hosted push CI (CD04):** [run `42898547547`](https://github.com/KayzenRoot/dep-instfinal/actions/runs/42898547547) — PASS
- **Checkpoint Delta:** V2 WO-003/004/005 checkpoint **PROMOTED** on 2026-11-13; see `docs/CHECKPOINT_DELTA.md`.

## CD06 — issue-closing production workflow

CD06 closes the acceptance gaps identified in issues #3, #6, #8, #9, #11, and #12, and adds the missing backup/restore evidence for #4/#13.

| Area               | Implementation                                                                                                                                                                                                               | Verification                                                                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene duration     | `episodes.scene_duration_ms` supports 4/6/8 s. `set_episode_scene_duration` rebuilds an empty draft timeline and rejects any episode with scene content, frames, or references.                                              | PgTAP rebuilds 96 s at 6 s and 4 s without gaps; live RPC rebuilt 120 s at 6 s (20 scenes, last end 120000) and rejected a non-empty timeline with `23514`.                                                                                                                                       |
| Scene direction    | New columns `location`, `character_notes`, `vhs_effects`, `transition`, `prompt_status`, `generation_attempts`; `save_scene_production` enforces owner, unpublished status, status enum, and attempt bounds.                 | PgTAP persists all fields and rejects `INVALID`; live RPC returned 204 and the REST read matched.                                                                                                                                                                                                 |
| Reorder            | `swap_scene_order` uses the deferrable unique constraint and recalculates fixed-duration timestamps.                                                                                                                         | PgTAP swaps adjacent scenes and verifies ids/timings; live RPC returned 204 and swapped scene ids.                                                                                                                                                                                                |
| Platform presets   | Episode metadata accepts TikTok/Reels/Stories/Feed targets and a 9:16/4:5/3:4 preset; UI exposes the selector and safe-zone preview.                                                                                         | Code + E2E selector; library preview renders 9:16, 4:5, and 3:4.                                                                                                                                                                                                                                  |
| Library preview    | Signed server-side derived variants (`variant=thumb`, `variant=4x5`, `variant=3x4`), side-by-side comparison, crop warning.                                                                                                  | Live: thumb 123 bytes, 4:5 144 bytes, 3:4 146 bytes, all `private, no-store`; invalid variant 400. Live 30-frame acceptance: 15 scenes received 30 authenticated frames, the ZIP contained 30 `media/` entries and `missing_frames.json` was empty; fixtures were removed after evidence capture. |
| Continuity review  | Deterministic warnings for DECEASED/MISSING/ARCHIVED characters and SUPERSEDED/ARCHIVED lore titles; canon approval requires explicit review when warnings exist and stores `continuity_review`.                             | Unit tests cover deceased, active, superseded and deduplication; canon insert stores the reviewed warnings.                                                                                                                                                                                       |
| Production package | ZIP now includes `production/assembly-manifest.md`, `production/checklist.md`, `social/hashtags.txt`, `social/ai-disclosure.txt`, per-channel covers/hashtags, credit estimate, scene status/attempts, and updated warnings. | Live export: 33 entries; manifest production block present; warnings `SCENE_PROMPTS_NOT_APPROVED`, `TARGET_PLATFORMS_EMPTY`, `AI_DISCLOSURE_EMPTY`.                                                                                                                                               |
| Backup/restore     | Logical export of all 14 public tables and the owner UUID; restore into a dedicated local Supabase target with the same owner UID and public rows in dependency order.                                                       | Counts matched (series 1, season 1, episode 1, media 4, scenes 15, choices 2); owner login 200; anonymous REST 401; Cloudinary private image 235 bytes with matching SHA-256.                                                                                                                     |
| Tests              | New unit tests, 8 new PgTAP assertions, responsive screenshots at 360/768/1440 for index and detail pages, E2E metadata/checklist assertions.                                                                                | Unit 28/28; typecheck 0 errors/warnings; lint pass; PgTAP 28/28 local and hosted; hosted E2E 9 passed in 2.3 minutes with no retry.                                                                                                                                                               |

### CD06 limits

- The local Windows E2E run is materially slower than CI and was flaky while reusing a stale dev server; the authoritative E2E evidence is the hosted workflow, which passed 9/9 in 2.3 minutes at `b23d40c` with no retry.
- The production credit estimate is deliberately manual and never queries a live Google Flow balance.
- The continuity review is advisory and deterministic; it does not read images or infer plot logic. The owner still approves or rejects canon.
- External independent review is recorded separately in `docs/CHECKPOINT_DELTA.md`; no checkpoint promotion or merge occurred.

### CD06 independent review

A separate reviewer agent audited the CD06 diff, migrations, RPCs, media route, continuity gate, export and tests. The first pass returned **CORRECTION REQUIRED** with one HIGH finding (the narrative import still used 8-second scenes and could truncate content-bearing scenes). Commit `08a4567` fixed the HIGH and the MEDIUM findings: revisioned scene production/reorder, strict continuity loading, a database trigger requiring the continuity review, prompt approval validation, preset-aware previews, normalized continuity matching, legacy metadata guards, null validation and bounded scene text. The follow-up audit returned **APPROVED** with no HIGH/CRITICAL findings.

Residual LOW findings accepted for this MVP: (1) a direct scene update can still set `APPROVED` after prompts are cleared, but the export warns; (2) the RPC null checks for some text parameters rely on NOT NULL constraints rather than explicit validation; (3) the continuity trigger has no dedicated PgTAP negative test, though the action and schema path are covered. The owner still needs to give the final acceptance before any checkpoint promotion.

## CD05 — live external acceptance

Live acceptance was executed against the dedicated Supabase project `dif` (`zottgifcocnjguhmnezx`, us-east-1) and the Cloudinary product environment `dt4qdzuus`. Credentials were read from the authenticated dashboards and written only to the local, git-ignored `.env`; no secret is committed or included in this document.

| Check                      | Result | Evidence                                                                                                                                                                                                                                                                      |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase migrations        | PASS   | Four migrations applied in order through the Management API. `information_schema` reports 14 public tables, 50 policies, 22 functions, and RLS enabled on 14/14 tables.                                                                                                       |
| Owner provisioning         | PASS   | Owner `owner@dif.local` created with `app_metadata.dif_studio_owner=true`, UID `75a301f7-c0ee-4bd9-863e-95d42b7037b0`. Password-grant login returned 200; REST read returned 200 `[]`; owner UID written to `.env`. Generated credentials were stored outside the repository. |
| Cloudinary live upload     | PASS   | The app's authenticated upload route stored a 64×64 PNG: `media_assets.upload_status=READY`, `public_id=dif-studio/1b315c6e-…`, 235 bytes, SHA-256 recorded, Cloudinary `asset_id`/`version` populated.                                                                       |
| Private delivery           | PASS   | Owner request to `/api/media/<id>` returned 200 with 235 bytes, `content-type: image/png`, `cache-control: private, no-store`, and CSP `default-src 'none'; sandbox`.                                                                                                         |
| Unauthorized delivery      | PASS   | Same route without a session returned 401. The raw unsigned Cloudinary URL returned 401.                                                                                                                                                                                      |
| Signed URL expiry          | PASS   | A `private_download_url` with `expires_at=now+2s` returned 200 immediately and 401 after 3.5 seconds.                                                                                                                                                                         |
| Upload rejection           | PASS   | Invalid bytes returned 415; a 10 MiB + 1 byte upload returned 413. Both were rejected before any Cloudinary call.                                                                                                                                                             |
| Failed-upload preservation | PASS   | With a deliberately invalid Cloudinary secret, the app redirected to `?upload=failed` and preserved the record as `ORPHANED` with `CLOUDINARY_UPLOAD_OUTCOME_UNKNOWN`; the object was not marked `READY`.                                                                     |
| Orphan reconciliation      | PASS   | A real authenticated object inserted as `ORPHANED` reconciled to `READY` with metadata. A missing public ID reconciled to `FAILED` / `CLOUDINARY_ASSET_NOT_FOUND`.                                                                                                            |
| Cross-owner isolation      | PASS   | A disposable authenticated user without the owner claim read `[]` from `series` and `media_assets` and received 403 (`42501`, RLS) on insert; the probe user was deleted.                                                                                                     |
| ZIP export with media      | PASS   | Authenticated export returned `application/zip`, filename `dif-episode-01.zip`, 29 entries, including `media/scene-01-start.png` (235 bytes) and empty `missing_frames.json`; the SRT contained 15 contiguous 8-second segments.                                              |

### Live acceptance finding

The live missing-object reconciliation exposed a real SDK error-shape mismatch: `cloudinary.api.resource` rejects with `{ error: { http_code: 404 } }`, while the route only inspected a top-level `http_code`. The missing object was therefore left `ORPHANED` with `CLOUDINARY_RECONCILIATION_FAILED` instead of `FAILED` / `CLOUDINARY_ASSET_NOT_FOUND`. Commit `b89240f061d9976a0a7db28003d63d5daf977dfe` handles both shapes; the unit fixture now uses the real nested shape. The live rerun produced `FAILED` / `CLOUDINARY_ASSET_NOT_FOUND`.

### CD05 validation and limits

- Local `npm test` 23/23, `npm run typecheck` 0 errors/0 warnings, `npm run lint`, `npm run build`, and `npm run audit:policy` (15 invariants) passed after the fix.
- The live acceptance fixture (`Aceitação DIF`, episode 1, 15 scenes, two choices) and its media records were created in the dedicated project; they are owner-scoped test data.
- Backup/restore remains **NOT RUN**: the Free plan shows no scheduled backups, and no external restore target was provisioned. Independent review remains pending.
- The first CD05 hosted attempts at `388577e` failed before the application tests because the runner could not resolve the Ubuntu package mirrors while installing Playwright system dependencies (`Temporary failure resolving '*.ubuntu.com'`). The workflow was stabilized by pinning `ubuntu-24.04` and installing Chromium without the apt-based dependency step. Both hosted runs then passed at `852b970`: baseline, PgTAP (20 tests), and authenticated E2E (8 passed in 1.9 minutes).
- Temporary owner-authorized public access was validated through a free Cloudflare quick tunnel: `/health` 200, `/login` 200, anonymous `/app` 303 to `/login`, anonymous media 401, owner media 200/235 bytes with `private, no-store`, and authenticated export 200/11,404-byte ZIP. The quick-tunnel URL is ephemeral, has no Cloudflare Access policy, and requires the local machine and server to stay online. It is not a production release or checkpoint promotion.
- The acceptance exercised real private media, rejection, failure preservation, reconciliation, cross-owner denial, and export. Step 5 of the prior pending list was represented by the synthetic `ORPHANED` record; a genuine DB-finalization failure mid-upload was not induced. Step 6 did not include foreign or failed media references.

## CD04 result

PostgreSQL now rejects publication for every episode above number 1 if the immediate predecessor is missing. This assertion is shared by the `set_episode_status` RPC and direct status transitions. Creating, editing, and importing an out-of-sequence draft remain allowed; no poll result or hypothesis becomes canon automatically. The UI tells the owner to create and publish the immediately preceding episode first.

Once that predecessor exists, all CD03 checks still apply when it requires a vote: the poll is closed and verified, the latest result is verified with a valid winner, and the latest explicit author-approved canonical decision refers to that exact result and episode. The 10-episode E2E journey publishes the previously blocked continuation only after the missing episode is published with verified voting and approved canon. Episode 10 still imports and publishes with no choices or own poll; every other episode requires two distinct choices.

CD01/CD02 owner isolation, manual prompt/import and context/export coverage, and CD03 latest-result/canon and hypothetical branch behavior remain in scope and pass in the hosted suite.

## CD04 verification record

| Check                                                          | Result                       | Evidence / limit                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted baseline                                                | PASS                         | PR run `42898556365` and push run `42898547547` passed `npm run check:baseline` on code/test HEAD `45840f9`.                                                                                                                                                    |
| Hosted PgTAP/RLS                                               | PASS · 20 tests              | `npm run test:db` passed on both hosted runs. Covers RPC and direct-write rejection when the predecessor is missing, draft editability without canon changes, valid sequential publication, and the vote-free season finale.                                    |
| Hosted authenticated E2E                                       | PASS · 8/8                   | Both hosted runs passed. The owner journey covers an out-of-order editable draft, missing-predecessor publication block, publication after valid continuity, sequential episodes 1–10, distinct hypothetical branches, and finale 10 without choices or a poll. |
| Local lint and typecheck                                       | PASS                         | `npm run lint`; `npm run typecheck` with 0 Svelte errors and warnings.                                                                                                                                                                                          |
| Local unit tests                                               | PASS · 23/23                 | Seven Vitest files.                                                                                                                                                                                                                                             |
| Local production build                                         | PASS                         | `npm run build`.                                                                                                                                                                                                                                                |
| Local security policy                                          | PASS · 15 invariants         | `npm run audit:policy`, covering 14 owner-scoped public tables and policy invariants.                                                                                                                                                                           |
| Dependency audit                                               | PASS at high threshold       | Local `npm run audit:deps` exited 0 and reported four LOW transitive `deepmerge` advisories. No breaking forced fix was applied.                                                                                                                                |
| Local full baseline                                            | PARTIAL · format gate failed | `npm run check:baseline` stops at Windows `format:check`, reporting 13 existing workspace files. The hosted baseline passed.                                                                                                                                    |
| Local PgTAP/authenticated E2E                                  | BLOCKED locally              | Local Supabase was not active at `127.0.0.1:54322`. Hosted PgTAP and authenticated E2E passed.                                                                                                                                                                  |
| Cloudinary live acceptance, backup/restore, independent review | NOT RUN / PENDING            | Essential external gates remain pending; no service, account, credential, or backup destination was created.                                                                                                                                                    |

The first CD04 CI run at `3c56048` exposed a repeated `READY` transition in the new out-of-order test fixture. The fixture was corrected at `45840f9`; both complete hosted workflows passed on that final code/test HEAD.

## CD03 historical result

Publication continuity is enforced in PostgreSQL and in `set_episode_status`. If the immediately preceding episode exists and requires a vote, the next episode remains unpublished until that poll is closed and verified, the latest verified result has a valid winner, and the owner's latest canonical decision approves that exact result and episode. Direct status writes receive the same database guard. The user sees which vote, result, or approval is still pending.

Conditional branches stay drafts and are marked `HYPOTHETICAL_NOT_CANON`; neither a pending vote nor a revised result is adopted as canon automatically. The finale is derived from the season plan, and that plan cannot change after episodes are created. The final planned episode can be imported and published with zero voting choices and cannot open a poll. Every other episode still requires two distinct options.

CD03 adds PgTAP and authenticated E2E coverage for premature publication, an unverified latest result, a stale canonical decision, the approved latest decision, distinct branch contexts, and a vote-free final episode. CD01 owner isolation and CD02 manual prompt/import, continuity context, and export paths remain covered.

## CD03 historical verification record

| Check                                                          | Result                       | Evidence / limit                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted baseline                                                | PASS                         | PR run `42881078808` and push run `42881066718`; `check:baseline` passed on HEAD `1766b158`.                                                                                                                                                                                    |
| Hosted PgTAP/RLS                                               | PASS                         | Both hosted runs passed `npm run test:db`, including database transition protection, latest-result/canon checks, season-finale exception, and direct table-write rejection.                                                                                                     |
| Hosted authenticated E2E                                       | PASS · 8/8, no retries       | Both hosted runs passed on the first attempt; episode 10 context is asserted as the planned finale, then imported and published without voting choices or a poll.                                                                                                               |
| Local unit tests                                               | PASS · 23/23                 | Seven Vitest files.                                                                                                                                                                                                                                                             |
| Local lint and typecheck                                       | PASS                         | `npm run lint`; `npm run typecheck` with 0 Svelte errors and warnings.                                                                                                                                                                                                          |
| Local production build                                         | PASS                         | `npm run build`.                                                                                                                                                                                                                                                                |
| Security policy and dependency audit                           | PASS remotely; local partial | 15 policy invariants across 14 tables; hosted baseline passed the configured `npm audit --audit-level=high` gate. The latest local audit could not reach npm registry (socket hang up); four LOW transitive `deepmerge` advisories were reported by the prior successful audit. |
| Local full baseline                                            | PARTIAL · format gate failed | Windows `format:check` reported 13 files; lint, typecheck, 23 unit tests, build, and policy checks were run separately. Hosted baseline passed on the final code/test SHA.                                                                                                      |
| Local PgTAP/authenticated E2E                                  | BLOCKED locally              | Local Supabase was unavailable at `127.0.0.1:54322`; the hosted database and authenticated browser checks passed.                                                                                                                                                               |
| Cloudinary live acceptance, backup/restore, independent review | NOT RUN / PENDING            | These essential external gates require an owner-selected service/account and review. No external service or credentials were created.                                                                                                                                           |

## CD02 historical result

The next-episode preparation now loads the owner’s series and season bible, all characters and lore statuses, and every earlier published episode’s story, scenes, choices, consequences, poll revisions, and canonical decisions. A previous decision is applied only when the poll and latest result are verified, the result has a winner, and the owner’s latest decision points to that exact result. Open polls, pending results, missing approvals, and stale decisions remain non-canonical.

Choice 1 and choice 2 can each be exported as a separate hypothetical continuation context marked `HYPOTHETICAL_NOT_CANON`. These previews do not modify the approved context. The owner can export the complete context and a strict JSON response template, paste a manual response, validate story fields, two distinct choices, and estimated duration, then save the response atomically as a draft revision. The episode ZIP includes the canonical context, continuation prompt, social copy, captions, scenes, and available owner-authorized media.

No official AI provider was both confirmed eligible and configured for this repository. Provider credentials are absent, no private ChatGPT or Google Flow sessions/endpoints were used, and no billing was enabled. `ManualTextProvider` remains `NOT_CONFIGURED`; the manual prompt export and validated response import are functional. Automatic AI generation is **pending**.

CD01 owner-only protections remain in place: all 14 exposed tables have forced owner-scoped RLS with the signed App Metadata claim; server routes verify the configured owner UID. The hosted Data API check still verifies that a different authenticated user cannot read or create owner data.

## CD02 historical verification record

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

Both hosted CD02 workflows passed on code SHA `68b4f867274e296a52c763851537ebf326f5eb8e`: baseline, Supabase startup, PgTAP/RLS, authenticated Data API checks, the 8/8 authenticated browser journey, and artifact upload. This is historical CD02 evidence; CD03 results are recorded above. CI uses synthetic accounts only in its disposable local Supabase stack.

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

**BLOCKED — Work Order not complete.** CD04 code, database/RLS, and authenticated E2E checks passed on `45840f9199783c251c4da8b10bff3fcda14de629`. Live Cloudinary account acceptance, external backup/restore, and independent review remain essential gates. Keep PR #14 Draft and the checkpoint **PROPOSED — NOT PROMOTED**. No merge, deployment, spend, external provisioning, or promotion occurred.
