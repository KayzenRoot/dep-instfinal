# DIF-V2-WO-014 — Release V2: regressão integral, auditoria e deploy validado

**Issue:** #31 · **Branch:** `feat/dif-v2-wo-014` · **Base:** `main` `7c175e5`
**Status:** **BLOCKED** — código/testes/regressão prontos; o deploy validado não pode concluir sem migrations no Supabase hospedado. O Vercel já serve o código V2, mas o projeto hospedado ainda tem apenas o schema V1. O PR #70 mantém ferramentas/docs de release, sem merge/deploy.

## Pré-requisitos atendidos

- WO-001–013 e WO-015–021 **PROMOTED**, com checkpoints reconciliados; OPS 015–021 **PROMOTED** (`c7490e8`).
- `main` `7c175e5` com quality workflow docs-only PASS; o gate SonarCloud separado falhou nesse commit de docs por duplicação pré-existente, sem código novo. Code/test head V2 `f32cc97` com CI `44776291945` PASS; OPS `77d5626` com CI `44787029917` PASS.
- Unit **351 + 3 skipped**, PgTAP **247/247**, policy **36/41**, E2E **19/19**, Sonar/Socket PASS.
- Backup/restore local executado (41/41 contagens, SHA, join 768, QA 5/5).
- Worker/render local e ARM64 benchmark das WOs anteriores aprovados.
- Sem HIGH/CRITICAL conhecido; auditorias independentes finais de WO-021 e OPS **APPROVED WITH RESIDUALS**.

## Bloqueio atual (produção)

- `https://dif-studio.vercel.app/health` → 200; `/login` → 200; `/app`, `/app/series`, `/app/episodes` → 200 com owner real.
- `https://dif-studio.vercel.app/app/style` → **HTTP 500** para o owner; o projeto Supabase hospedado `zottgifcocnjguhmnezx` não tem as tabelas V2 (`GET /rest/v1/style_presets` → PGRST205).
- O workspace não tem Supabase PAT nem database password:
  - `npx supabase projects list` → “Invalid access token”;
  - não existe `C:\Users\csn19\.zcode\dif-secrets\supabase-pat.txt`;
  - não há Vercel CLI autenticado (o deploy Vercel vem da integração Git).
- Sem credencial não é possível aplicar as **29 migrations V2** (`20261112170000`–`20261120132000`) nem executar o smoke de produção. Não há caminho DDL via PostgREST/anon.

## Como desbloquear

1. O owner fornece um PAT Supabase (`sbp_...`) em `C:\Users\csn19\.zcode\dif-secrets\supabase-pat.txt` **ou** roda `npx supabase login`/`link --project-ref zottgifcocnjguhmnezx` **ou** fornece a database password por arquivo privado.
2. Antes de aplicar, gerar backup do schema hospedado (Management API/`pg_dump`) e confirmar que o schema atual é V1.
3. Dry-run (não lê o PAT):
   ```sh
   SUPABASE_PROJECT_REF=zottgifcocnjguhmnezx node scripts/apply-hosted-migrations.mjs
   ```
4. Executar via arquivo de PAT (não coloque o segredo no histórico do shell):
   ```sh
   SUPABASE_PROJECT_REF=zottgifcocnjguhmnezx \
     node scripts/apply-hosted-migrations.mjs --execute \
       --token-file "C:/Users/csn19/.zcode/dif-secrets/supabase-pat.txt" \
       --confirm-project zottgifcocnjguhmnezx
   ```
   O script recusa schema V2 já presente sem ledger, exige confirmação explícita do projeto, grava um ledger privado por migration aplicada, aceita `--resume` apenas com ledger correspondente e compara o conjunto exato de 41 tabelas (não apenas a contagem). `--from` anterior a `20261112170000` exige `--allow-v1` explícito.
5. Smoke: crie `.env.smoke` (ignorado pelo Git) com `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `EXPECTED_SUPABASE_PROJECT_REF=zottgifcocnjguhmnezx`; `npm run release:smoke` usa `--env-file-if-exists=.env.smoke`, valida dono configurado, boundaries anônimos e marcadores V2; depois owner login, `/app/style`, `/app/timeline`, upload R2, download privado, render worker, MP4 1080×1920, backup/rollback.
6. Só depois promover o checkpoint final para **APROVADO**.

Saída atual de `npm run release:smoke` (2026-11-20): health/login/boundaries PASS; **7 tabelas V2 ausentes** (`video_assets`, `video_edit_plans`, `render_jobs`, `cover_revisions`, `choice_end_cards`, `published_posts`, `style_presets`), exit 1. Chave inválida é FAIL explícito (não conta como tabela presente). O script é read-only e impede declarar release completa com schema V1.

## Script de migrations

`scripts/apply-hosted-migrations.mjs`:

- dry-run por padrão; `--execute` explícito;
- exige PAT `sbp_...` (env ou `--token-file`) e confirmação `--confirm-project` do ref;
- recusa schema V2 já presente sem ledger correspondente; aceita `--resume` com ledger por projeto;
- aplica somente migrations a partir de `--from` (default `20261112170000`), em ordem;
- rejeita `--from` anterior ao V2 sem `--allow-v1`;
- não imprime token nem SQL; falha com HTTP/status e trecho normalizado;
- compara o conjunto exato de tabelas (14 V1 + 27 V2 = 41), reportando faltantes/extras.

## Pendências humanas/operacionais

- Aceitação real do owner com episódio Flow 90–150 s, 15 clipes, narração, SFX/música, legendas, CTA/2 escolhas, MP4 revisado (QA humano de som/imagem).
- Configurar/validar envs R2 no Vercel Production e worker isolado autorizado.
- Backup hospedado antes das migrations e ensaio de rollback/roll-forward.
- Cloudinary secret rotation e smoke de mídia privada.

## Riscos

- V2 code em produção sem schema V2 deixa rotas novas em 500 (V1 core continua 200). Não declarar release completa.
- As migrations são majoritariamente aditivas (também incluem grants/constraints), mas devem ser aplicadas com backup, em ordem e com ledger; o script falha fechado.
- Sem Vercel CLI, rollback de alias depende do dashboard/integração Git.
