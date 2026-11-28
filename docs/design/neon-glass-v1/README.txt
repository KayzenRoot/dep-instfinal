DIF STUDIO / NEON GLASS - VISUAL MASTER CANDIDATE v1
Status: SELECTED as design direction by assistant at owner's request, 2026-11-24.
The nine original PNGs are imported unmodified and read-back verified (commit 9573e4d).
WO-001 integrated into main dfcb1fc (PR #91), WO-002 in 54ff92c and WO-003 in b8691a3;
ADR-001 remains PROPOSED. Screens WO-004 onward are still planned.
EPIC #76; WO-001 #77; baseline main 4ec6f91006ef86d32bd027779cc8ac730b3b394c.
PR #75 is the DIF-V2-WO-014 branch and remains Draft; it is not part of this UX scope.

REFERENCE POLICY
- The nine independently generated PNGs are immutable concept targets, 1672x941, exact SHA256 in manifest.json.
- Primary flagship: 05-editor.png; shared shell and data-card baseline: 02-dashboard.png.
- Each remaining image is the ONLY image reference for its corresponding route.
- IMPORTANT: the nine original PNGs are committed in docs/design/neon-glass-v1/screens/ at commit
  9573e4d and were read back from GitHub with SHA256 and 1672x941 matching this manifest. Do not
  replace, resample, recolor or recompress them.
- WO-001, WO-002 and WO-003 are approved and merged; ADR-001 remains PROPOSED and this document
  does not promote it. Screens WO-004 onward remain planned.
- Do not replace screenshots with a collage. The final artifact requires one PNG per screen.

SCREEN-TO-ROUTE MAPPING (CURRENT APPLICATION)
01-login.png | Login/Owner | /login | sha256:cbb3204c778a23a233bfd30b5e85e0701e7ee3b322174ad00bb1b5f5cc00aa63
02-dashboard.png | Dashboard | /app | sha256:a76788309e36722500ebde206110d52244a7c671a6e084a3adc0d6ae7a08b429
03-series.png | Séries | /app/series | sha256:2fe39536f4cf7f224deb55a3d442341a385a7357ea3ca7242cc7f69cccf488db
04-episodes.png | Episódios | /app/episodes | sha256:1a6b327d1ab6e69e45414834bab2418fc92dacf5476ec135ad11f9ed9dd9e2aa
05-editor.png | Editor profissional | /app/editor + /app/timeline | sha256:546e8a0d1ac48c22a3e16775cad0633d412e9c56adfaa3110ae2a5d8a78824a6
06-style.png | Estilo | /app/style | sha256:663a7b0abf9305f439192dc8acfe86924a79c1421802648458f80acc663b9862
07-media.png | Mídia | /app/library + /app/video + /app/audio + /app/narration | sha256:9f194a49390fb45c7349a13d88904242e1d905f620a685b53b23efe491043355
08-analytics.png | Analytics observacional | /app/retention | sha256:abf0d48510b8994a30733446c2affa0ba1ca2ba482659cafae0e8ebb4b71c35d
09-settings.png | Configurações | /app/settings | sha256:33b333af6f26554c83c24809c62f7fbb4bc6283add3bb0809b845183adde0e1a

DESIGN TOKENS AND MOTION (PROPOSED)
Background #080C18; Surface #11192B; Raised #1C2943; Text #F4F7FF; Muted #A5B3D1.
Accent cyan #00D8F5, violet #8B5CF6, magenta #C53CFF, emerald #22D3A6. Error #F87171.
Border thin translucent; glass surface with modest backdrop blur only when supported, safe opaque fallback.
Card radius 12-20px, focused ring of sufficient contrast; hover translateY(-2 to -4px) for pointer:fine
only. Motion 120-220ms normal; reduced-motion disables transform, glow animation and parallax.
UI is high contrast: protect labels/numbers against bright glass backgrounds and overlaps.

NON-NEGOTIABLE PRODUCT CONTRACTS
- Keep all existing 21+ SvelteKit application navigation routes reachable, including Storyboard, Timeline,
  Director, Votações e cânone, Legendas, Hooks, Captions, Exportar and existing maintenance screens.
  The visual master only displays 8 sidebar links, not an instruction to delete other modules.
- Retain Supabase Auth owner-only and RLS, backend config protections, Cloudinary private images,
  R2 private videos, FFmpeg worker boundaries, versioned plans and human-approved canon.
- No new app accounts, OAuth integrations, teams, 2FA, Slack, Google Drive, social posting, paid services.
- Fictional display name Camila Rocha, numbers, series, retention, team and storage sizes are ONLY
  visual sample data from the generated images, never production fixtures.
- Analytics must rely on actual versioned retention/CSV user imports and must label incomplete metrics.
- Dashboard workers/status only when verifiable; do not claim live workers or exact render ETA otherwise.
- Login image hints at Google/magic link; implement only already approved and tested auth methods.
- Editor screenshot shows rich choice graph/tracks; keep real editing behavior and flag absent tools,
  never simulate operational buttons.
- Tooltips: concise purpose, how-to, constraints, link to real docs; aria-describedby, keyboard/focus,
  hover, touch tap, ESC dismissal, overlap safe, short on mobile. No fake feature promises.

VALIDATION / DEFINITION OF DONE
- 9 png hashes match; screenshot for each screen 1920/1440/768/390 and documented visual differences.
- Real data with empty/loading/error states, keyboard/touch/reduced-motion and WCAG AA.
- No regressions in existing 21+ routes; owner-only auth and media remain private.
- CI: format/lint/typecheck/build/Vitest/PgTAP/Playwright and Sonar/Socket; no HIGH/CRITICAL defects.
- Evidence Bundles include base/head SHA, committed images with SHA256, test logs, screenshots,
  diff, risks, audit verdict in pt-BR and Checkpoint Delta PROPOSED. Promotion only after APPROVED.
- No design merge or production deploy via PR #75. New UX work must obey separate PR and dependency gates.

CANONICAL SOURCE HIERARCHY
Checkpoint > approved ADRs > Scope > DoD > Architecture > Requirements > this PROPOSED UI addendum.
Do NOT overwrite or silently reinterpret V1/V2 decisions in existing Source Pack.
