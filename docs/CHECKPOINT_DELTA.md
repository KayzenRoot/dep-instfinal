# Checkpoint Delta — CD01

- **Work Order:** `DIF-MVP-ALL-001`
- **Repository / branch / PR:** `KayzenRoot/dep-instfinal` / `feat/dif-studio-mvp-001` / Draft PR #14
- **Audit base SHA:** `d7887cfdee219f5b9e081c89e79d4ae61ee0c8f5`
- **Validated application and test SHA:** `89bc16c05912a7b50b47ac3cf2cc3e9b2eef5359`
- **Hosted PR CI:** `42823819918` — PASS
- **Status:** **PROPOSED — NOT PROMOTED**
- **Proposed verdict:** **CORRECTION REQUIRED**

## Delta

1. Season, character, and lore creation now explicitly maps camelCase form values to snake_case Supabase columns. Other insert/RPC write paths were reviewed.
2. All 14 exposed table policies and six privileged episode RPCs require the administrator-managed signed `app_metadata.dif_studio_owner=true` claim and bind access to `auth.uid()`. Hosted PgTAP and direct Data API tests with a second authenticated user passed.
3. Cloudinary upload errors preserve reconcilable state. Owner-scoped reconciliation re-fetches the authenticated object, validates image bytes and dimensions, and only then marks metadata ready. Private media and ZIP export tests enforce owner and delivery-state checks.
4. The hosted acceptance journey passed series → season → character/lore → 120-second episode → 15 scenes → two choices → verified vote → canonical decision → continuation → ZIP export.
5. Automatic story generation remains pending. `ManualTextProvider` is `NOT_CONFIGURED`; manual editing remains available.

## Gate and limits

Hosted database/RLS and E2E validation passed on the code SHA above. Local Supabase was unavailable in the workspace because Docker image pulls were rate limited and the Postgres layer exhausted container disk. Live Cloudinary signing, upload, deletion, delivery, bandwidth, reconciliation, and export could not be exercised because no external credentials were supplied; provider-boundary mocks cover these paths but do not prove live integration. CI used synthetic test accounts only in its disposable local Supabase stack. No external/provider credentials, paid services, deployment, merge, or promotion were used.

Keep this checkpoint proposed and the version incomplete until the owner resolves the live Cloudinary validation limit and independent review. Full evidence and test output are in `docs/EVIDENCE_BUNDLE.md`; repository/base provenance is in `docs/CONTEXT_LOCK.md`.
