# DIF-V2-WO-014 — Release V2: regressão integral, auditoria e deploy validado

**Issue:** #31 · **Branch:** `feat/dif-v2-wo-014` · **Base:** `main` `7c175e5`
**Status:** **PENDENTE DEPLOY** — Supabase de produção pronto e validado; o Vercel Production ainda aponta para o projeto antigo. Falta atualizar as envs, republicar e executar a aceitação real do owner.

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

## Pendência atual (Vercel)

- `https://dif-studio.vercel.app` continua configurado com o Supabase antigo; por isso `/app/style` ainda responde 500 em produção.
- É necessário atualizar no Vercel Production: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_OWNER_USER_ID` para o projeto `gzjsjxkxyvgvixvnusrv`, mantendo Cloudinary/R2 existentes, e republicar o deployment.
- O workspace não tem Vercel CLI autenticado (`vercel whoami` sem credenciais; token local inválido) nem PAT. A atualização exige login no dashboard do Vercel no navegador controlado.
- Depois do redeploy: rodar `npm run release:smoke` novamente, validar `/app/style` e `/app/timeline` em produção, upload/download R2, render worker, MP4 1080×1920 e a aceitação do owner.

## Como concluir o deploy

1. Autenticar no dashboard do Vercel no navegador controlado e abrir o projeto `dif-studio`.
2. Em Settings → Environment Variables → Production, substituir as cinco variáveis Supabase pelos valores privados do projeto novo (não colar segredos em chat/ticket).
3. Republicar o deployment de `main` (ou o preview validado) e confirmar `/health` com `supabase:true` e `owner:true`.
4. Rodar o smoke e a aceitação; só então promover o checkpoint final para **APROVADO**.

Saída de `npm run release:smoke` (2026-11-21, `.env.smoke` novo): PASS health; PASS login; PASS 4 boundaries anônimos; PASS schema key preflight; PASS 7 tabelas V2; exit 0. O smoke exige `EXPECTED_SUPABASE_PROJECT_REF` explícito e recusa validar um host diferente.

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

## Pendências humanas/operacionais

- Aceitação real do owner com episódio Flow 90–150 s, 15 clipes, narração, SFX/música, legendas, CTA/2 escolhas, MP4 revisado (QA humano de som/imagem).
- Configurar/validar envs R2 no Vercel Production e worker isolado autorizado.
- Cloudinary secret rotation e smoke de mídia privada.

## Riscos

- Até o redeploy do Vercel, o código V2 continua servido contra o schema V1 antigo e as rotas novas permanecem em 500.
- O projeto novo está vazio; a aceitação deve usar conteúdo novo, não os dados antigos inacessíveis.
- Sem Vercel CLI, rollback de alias depende do dashboard/integração Git.
