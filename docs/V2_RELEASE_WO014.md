# DIF-V2-WO-014 — Release V2: regressão integral, auditoria e deploy validado

**Issue:** #31 · **Branch:** `feat/dif-v2-wo-014` · **Base:** `main` `7c175e5`
**Status:** **ACEITAÇÃO TÉCNICA CONCLUÍDA; ACEITAÇÃO REAL BLOQUEADA** — o pipeline completo foi validado em produção, mas uploads de vídeo e narração não são validados no runtime Vercel (sem ffprobe/ffmpeg); o teste usou promoção manual. Corrigir o validador antes da aceitação real do owner.

## Pré-requisitos atendidos

- WO-001–013 e WO-015–021 **PROMOTED**, com checkpoints reconciliados; OPS 015–021 **PROMOTED** (`c7490e8`).
- `main` `7c175e5` com quality workflow docs-only PASS; o gate SonarCloud separado falhou nesse commit de docs por duplicação pré-existente, sem código novo. Code/test head V2 `f32cc97` com CI `44776291945` PASS; OPS `77d5626` com CI `44787029917` PASS.
- Unit **351 + 3 skipped**, PgTAP **247/247**, policy **36/41**, E2E **19/19**, Sonar/Socket PASS.
- Backup/restore local executado (41/41 contagens, SHA, join 768, QA 5/5).
- Worker/render local e ARM64 benchmark das WOs anteriores aprovados.
- Sem HIGH/CRITICAL conhecido; auditorias independentes finais de WO-021 e OPS **APPROVED WITH RESIDUALS**.

## Novo Supabase de produção (21/11/2026)

- O projeto antigo `zottgifcocnjguhmnezx` não está acessível pela conta logada (“You do not have access to this project”). Por direção do owner (“crie nesse projeto logado tudo novo”), foi criado o projeto `dif-studio` (`gzjsjxkxyvgvixvnusrv`, organização BrainBot, us-west-2/Oregon, plano Nano).
- As **38 migrations** do repositório (V1 + 29 V2) foram aplicadas com `npx supabase db push --include-all`; a database password ficou apenas em arquivo privado local.
- Introspecção PostgREST: **41/41 tabelas** esperadas, nenhuma faltante ou extra. Sondas com service role retornam 200; sondas anônimas em `series` e nas 7 tabelas V2 retornam 401/`42501` (RLS sem acesso anônimo).
- O owner `owner@dif.local` foi criado com `app_metadata.dif_studio_owner=true`; as credenciais ficam somente em arquivo privado local.
- Validação local contra o projeto novo: login do owner OK; `/app/style` e `/app/timeline` renderizam (sem 500); criação de série via UI gravou com o `owner_id` correto e a linha de teste foi removida.
- `npm run release:smoke` com `.env.smoke` do projeto novo: PASS em health, login, boundaries anônimos, preflight de chave e nas 7 tabelas V2.
- O projeto está vazio: os dados V1 antigos não foram migrados porque o projeto antigo está inacessível. A direção “tudo novo” foi tratada como recomeço limpo.

## Deploy de produção (21/11/2026)

- Vercel Production atualizado pelo dashboard: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_OWNER_USER_ID` (Production + Preview), `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview) e `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT` (Production); Cloudinary, `GEMINI_API_KEY` e `APP_ORIGIN` foram preservados.
- Redeploy de `main` `7c175e5` concluído; deployment `59dQjeSfTvrFy41EeiLno9bst193` Ready no domínio `dif-studio.vercel.app`.
- `https://dif-studio.vercel.app/health` → 200 (`supabase:true`, `owner:true`); login do owner OK.
- `GET /app/style` → **200** (“Estilo da série”); `GET /app/timeline` → **200**.
- `npm run release:smoke` → PASS em health, login, 4 boundaries anônimos, key preflight e 7 tabelas V2.
- `GET /api/render-jobs/health` → 200: service role configurada; fila vazia e sem worker ativo.
- R2: `POST /api/video/uploads` com corpo vazio → 400 `INVALID_INPUT` (o backend R2 é verificado antes da validação do corpo); `npm run check:r2` → PASS HeadBucket/Put/Get/Delete.
- Cloudinary: `cloudinary.api.ping()` OK; upload privado real via `/api/media/upload` concluído (`?upload=success`, asset `READY`); o asset de teste foi removido do Cloudinary e do banco.
- CI `44899106284` (quality) PASS; SonarCloud, Socket e Vercel Preview PASS.

## Aceitação técnica em produção (23/11/2026)

- Série/temporada e dois episódios de teste; o episódio 2 tem 90 s/15 cenas, plano v1 aprovado, take de 90 s e legendas v1 aprovadas.
- 15 clipes 1080×1920/6 s enviados pela UI; o worker real local (`WORKER_STUB=0`) renderizou o job `1bba4c9e-d495-43f4-b815-ff9ba113d958`: MP4 H.264/AAC 1080×1920, 90.000 s, 4.275.149 bytes, legendas queimadas; QA WARN 14 PASS/3 WARN/0 BLOCKED/1 NOT_TESTED; avisos reconhecidos e download owner-only 200.
- Evidência: `docs/evidence/wo-014/browser-acceptance-2026-11-23.txt`.
- **Bloqueio HIGH:** `VIDEO_PROBE_DRIVER=none` e ausência de ffprobe/ffmpeg no Vercel deixam todo upload de vídeo em `QUARANTINED` e fazem o upload de narração falhar com HTTP 422 `NARRATION_AUDIO_INVALID`. O teste só avançou com promoção manual dos 15 assets e inserção manual do take; isso não é um fluxo de produção.
- **HIGH/MEDIUM:** 120 s com cenas de 6 s gera 20 cenas, mas o limite é 15 clipes/episódio; a criação permite um episódio impossível de concluir.
- **MEDIUM:** geração Gemini retorna HTTP 503 para `gemini-3.5-flash-lite`; a importação manual funciona.
- **MEDIUM:** upload de narração antes de salvar a direção usa `planVersion=0`, violando o check 1..10000.
- **OPERACIONAL:** nenhum worker está implantado em produção; o job de teste usou worker local.

## Pendências para encerrar WO-014

- Corrigir a validação de mídia em produção (HIGH): empacotar ffprobe/ffmpeg no runtime ou implementar validador assíncrono no worker; ativar `VIDEO_PROBE_DRIVER=ffprobe` somente com o binário disponível.
- Corrigir a incompatibilidade 20 cenas × 15 clipes (validar na criação ou ajustar a quota).
- Corrigir `planVersion=0` no primeiro upload de narração.
- Diagnosticar o 503 do Gemini (chave/modelo/fallback) se a geração automática for necessária.
- Repetir a aceitação real do owner com 15 clipes reais, narração, SFX/música, legendas, CTA/2 escolhas e MP4 revisado em produção, sem workarounds.
- Subir o worker de render autorizado em produção.
- Cloudinary secret rotation.
- Depois da aceitação, promover o checkpoint final e fechar a issue #31.

## Script de migrations

`scripts/apply-hosted-migrations.mjs`:

- dry-run por padrão; `--execute` explícito;
- exige PAT `sbp_...` (env ou `--token-file`) e confirmação `--confirm-project` do ref;
- recusa schema V2 já presente sem ledger correspondente; aceita `--resume` com ledger por projeto;
- aplica somente migrations a partir de `--from` (default `20261112170000`), em ordem;
- rejeita `--from` anterior ao V2 sem `--allow-v1`;
- não imprime token nem SQL; falha com HTTP/status e trecho normalizado;
- compara o conjunto exato de tabelas (14 V1 + 27 V2 = 41), reportando faltantes/extras.

O caminho alternativo usado neste release foi `npx supabase db push --include-all` com a database password privada, porque o PAT do owner não estava disponível. O script permanece como caminho auditável para os próximos projetos.

## Riscos

- Enquanto a validação de mídia não for corrigida, uploads reais ficam em quarentena e a narração não pode ser importada; a aceitação real não é possível sem workaround.
- O banco novo está vazio; a aceitação deve usar conteúdo novo, não os dados antigos inacessíveis.
- O worker de render não está ativo em produção; jobs ficam na fila até o worker autorizado subir.
- Sem Vercel CLI autenticado, rollback de alias depende do dashboard/integração Git.
