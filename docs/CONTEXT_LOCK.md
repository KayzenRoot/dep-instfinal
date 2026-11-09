# Context Lock — DIF-MVP-ALL-001

**Created:** 2026-11-09  
**Repository:** `KayzenRoot/dep-instfinal`  
**Remote:** `https://github.com/KayzenRoot/dep-instfinal.git`  
**Default branch:** `main`  
**Execution branch:** `feat/dif-studio-mvp-001`

## Verified Git state

- Owner-authorized bootstrap commit on `main`: `b4fd54513af749d68bb7bce4c06110cd9981be39`.
- `BASE_SHA`: `b4fd54513af749d68bb7bce4c06110cd9981be39`.
- `HEAD_SHA` at start of implementation: `b4fd54513af749d68bb7bce4c06110cd9981be39`.
- The feature branch was created locally from exactly this SHA.
- Prior to bootstrap the remote was empty (`git ls-remote` returned no refs), and the workspace was empty. There was no prior code, checkpoint, ADR, workflow, branch, or PR to preserve.
- Base working tree was clean before the feature branch was created.

## Base fingerprints (SHA-256)

| File at base | SHA-256 |
|---|---|
| `README.md` | `BB5711B757FDC9B38612F207B5F25CFD485855B424C67AE81AEA4538C2C543DE` |
| `.gitignore` | `599F2C11DEB8C3CA3FB2B948EB5822292C019D502C7F6832E8274CB3219DB629` |

## Canonical sources checked

- User-authorized Work Order: `C:\Users\csn19\Downloads\DIF_Studio_Codex_OneShot.pdf`, 9 pages.
- GitHub issues [#1–#13](https://github.com/KayzenRoot/dep-instfinal/issues), all open when checked.
- Issue #4 title/body mismatch was resolved by its latest 2026-11-09 approved delta and the PDF: PostgreSQL is canonical; no SQLite/local source of truth.
- No existing Checkpoint, Decisions Ledger, ADR, Scope, DoD, migrations, `package.json`, workflows, or other files existed before this branch.

## Stale triggers

Revalidate before any external action if `main` changes; the feature branch is rebased/updated; issue or owner decisions change; the canonical PDF/Source Pack changes; dependencies or security advisories drift; or the GitHub target/permissions change. Never force-push. Record any new base SHA and fingerprints in the Evidence Bundle.
