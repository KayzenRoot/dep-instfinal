# DIF-V2-WO-014 — Release V2: regressão integral, auditoria e deploy validado

**Issue:** #31 · **Branch:** `feat/dif-v2-wo-014` · **Base:** `main` `8518a69`
**Status:** **ACEITAÇÃO TÉCNICA COMPLETA; ACEITAÇÃO REAL E OPERAÇÃO 24/7 PENDENTES** — mídia, quota, Gemini, Cloudinary e workers contínuos foram corrigidos e validados; falta o episódio real do owner e hospedar os workers em um host sempre ativo.

## Pré-requisitos atendidos

- WO-001–013 e WO-015–021 **PROMOTED**, com checkpoints reconciliados; OPS 015–021 **PROMOTED** (`c7490e8`).
- `main` `7c175e5` com quality workflow docs-only PASS; o gate SonarCloud separado falhou nesse commit de docs por duplicação pré-existente, sem código novo. Code/test head V2 `f32cc97` com CI `44776291945` PASS; OPS `77d5626` com CI `44787029917` PASS.
- Unit **358 + 3 skipped**, PgTAP **250/250**, policy **36/41**, E2E **19/19**, Sonar/Socket PASS; PRs #71–#74 PASS.
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
- **Resolvido em 23/11:** `VIDEO_PROBE_DRIVER=none` e a ausência de ffprobe/ffmpeg no Vercel agora são tratados por um validador assíncrono: vídeos ficam `QUARANTINED` e narrações `PENDING` até o worker publicar `READY`/`REJECTED`. O teste original usou promoção manual; a correção foi implantada e validada em produção.
- **Resolvido em 23/11:** quota de 15 cenas validada na criação e na edição (PR #71); 120 s/6 s é rejeitado e a mensagem cita o limite (PR #74).
- **Resolvido em 23/11:** o Gemini direto respondeu 503/404; o fallback para o AI Gateway (PR #73) gerou um pacote de 20 cenas em produção (`responseJson` com 29.075 caracteres).
- **Resolvido em 23/11:** o primeiro upload de narração passou a usar `plan_version >= 1`; a direção pode ser salva antes ou depois do take.
- **OPERACIONAL:** workers de mídia e render rodando localmente em modo contínuo; processaram o clipe `41f503e0…` e o render `768f5d3c…` até READY. Para 24/7, precisam de um host sempre ativo.

## Validador de mídia assíncrono (23/11/2026)

- Migrations `20261123190000_v2_media_validator.sql` e `20261123191000_v2_media_validator_trigger.sql` aplicadas no Supabase hospedado: estados `PENDING`/`VALIDATING`, claim RPCs exclusivas do service role, retry limitado e trigger que permite apenas a transição de validação, mantendo identidade e linhas publicadas imutáveis.
- `scripts/media-validator.ts` + `npm run media:validate`: baixa o objeto privado do R2, roda ffprobe/ffmpeg, valida container/codec/duração/dimensões/9:16/FPS (vídeo) ou duração/formato/canais/loudness/clipping (narração) e publica `READY` ou `REJECTED`.
- O web tier grava vídeos em `QUARANTINED` e, quando `VIDEO_PROBE_DRIVER=none`, narrações em `PENDING`; a UI mostra “aguardando validação do worker” e só permite selecionar/aprovar takes `READY`.
- Validação em produção após o deploy de `3eb3fe6`: take `8f76610c-1962-45fd-8c59-ee836e2dba8f` passou de `PENDING` para `READY` (90.000 ms) e clipe `b363c009-c448-4aca-a044-c9cf5c4e0704` passou de `QUARANTINED` para `READY` (6.000 ms, 1080×1920) usando o worker real.
- CI `45250357305` PASS (unit, PgTAP, E2E, Sonar, Socket); PgTAP **250/250**.

## Cloudinary rotation (23/11/2026)

- Nova chave `dif-prod-2026-11-23` (API key `568819519236599`) com papel **Master Admin**; a chave antiga `dif` foi desativada.
- Vercel Production/Preview e `.env` local atualizados; `api.ping()` e um upload autenticado real passaram em produção (`?upload=success`), e o asset de teste foi removido do Cloudinary e do banco.
- O secret novo ficou apenas em `C:\Users\csn19\.zcode\dif-secrets\cloudinary-prod-2026-11-23.txt`; os valores antigos foram preservados em `cloudinary-old-before-rotation.txt`.
- Residual: o secret novo apareceu uma vez em um snapshot local de ferramenta; se este transcript for compartilhado, rotacione novamente.

## Workers contínuos (23/11/2026)

- `media-prod-local` e `render-prod-local` rodando localmente com `WORKER_MAX_JOBS=0`, processando novos uploads e renders automaticamente.
- O worker de mídia promoveu o clipe `41f503e0-a057-4ca3-9353-542c0bc63047` para READY; o worker de render concluiu o job `768f5d3c-e562-4dac-b2ee-1ea7253565d2` (90 s, 1080×1920, READY).
- Para operação 24/7, rode `npm run media:validate` e `scripts/render-worker.mjs` em um host sempre ativo com `.env`/`r2.env`; sem workers, uploads e renders ficam fail-closed na fila.

### Serviço persistente nesta máquina (23/11/2026)

- `scripts/workers-service.mjs`: supervisor que mantém os dois workers vivos, reinicia cada filho com backoff, grava logs em `C:\Users\csn19\.zcode\dif-secrets\worker-logs` e evita instância duplicada por lockfile.
- Como o shell não tem elevação para registrar tarefa/serviço, a inicialização usa o Startup do Windows: `...\Startup\dif-workers.vbs` → `run-workers.cmd` (loop que reinicia o supervisor).
- Validado: supervisor + mídia + render ativos; ao derrubar o worker de mídia, o supervisor o reiniciou em cerca de 1 s.
- O Startup roda apenas no logon do usuário. Para 24/7 antes do login/reboot, é preciso elevar e registrar uma tarefa/serviço do Windows.

## Pendências para encerrar WO-014

- Repetir a aceitação real do owner com 15 clipes reais, narração, SFX/música, legendas, CTA/2 escolhas e MP4 revisado em produção, sem workarounds.
- Para 24/7 sem login, elevar e registrar uma tarefa/serviço do Windows; o Startup atual cobre apenas o logon.
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

- Os workers rodam nesta máquina e iniciam no logon; se ela desligar ou o usuário fizer logoff, uploads ficam `QUARANTINED`/`PENDING` e renders ficam na fila.
- O secret novo do Cloudinary apareceu uma vez em snapshot local; se o transcript for compartilhado, rotacione novamente.
- O banco novo está vazio; a aceitação deve usar conteúdo novo, não os dados antigos inacessíveis.
- Sem Vercel CLI autenticado, rollback de alias depende do dashboard/integração Git.
