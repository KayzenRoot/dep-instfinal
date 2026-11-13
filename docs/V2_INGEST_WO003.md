# DIF-V2-WO-003 — Ingestão segura de clipes Flow e storage privado

**Work Order:** `DIF-V2-WO-003` · issue #20 · epic #17
**Base:** `main` `b0f78064a2a5902acc98c20efc92648ec540b7e9` (WO-002 merge, 2026-11-12)
**Branch:** `feat/dif-v2-wo-003`
**Status:** implementação, testes locais e **aceitação live do R2 PASS** (15 clipes); M4/M9/M11/M12, a falha de chave de sessão e a recuperação M4 foram corrigidos. **Auditoria independente final: APPROVED em `c07af6e`**. Lifecycle automático do R2 está bloqueado pelo escopo do token (AccessDenied), a cota M2 tem paginação/check-then-act residual (não bloqueante no escopo single-owner; hardening em WO-013/WO-005) e a validação ffprobe real permanece no worker/WO-005. Checkpoint V2 permanece **PROPOSED — NOT PROMOTED** até aprovação/merge do owner.

## 1. Objetivo

Permitir upload em lote de clipes gerados manualmente no Flow, associados a episódio e cena, com armazenamento privado Cloudflare R2, quarentena, validação e acesso owner-only. Nenhum vídeo entra no PostgreSQL; nenhuma imagem Cloudinary é reutilizada para vídeo.

## 2. Decisão de storage

ADR-V2-002 **ACCEPTED** pelo owner em 2026-11-12: **Cloudflare R2 privado**. Bucket `dif-studio-video-private` criado no dashboard; acesso público desabilitado. Token R2 escopado e CORS configurados; lifecycle pendente.

## 3. Entregue no código

### 3.1 Banco e RLS

Migration `supabase/migrations/20261112170000_v2_wo003_video_storage.sql`:

- `video_upload_sessions`: owner, episódio/cena, asset draft, idempotency key, upload multipart R2, chave de quarentena, parte/tamanho, status, expiração.
- `video_assets`: owner, episódio/cena, versão, provider `r2`, bucket/chave, poster, SHA-256, bytes, duração, dimensões, codec/container, status (`UPLOADING`, `QUARANTINED`, `VALIDATING`, `READY`, `REJECTED`, `DELETED`), retenção e tombstone.
- RLS owner-only `SELECT/INSERT/UPDATE/DELETE` com claim `dif_studio_owner=true`; anon revogado; `READY` exige SHA-256, bytes, duração, dimensões, codec, container e `validated_at`.
- Migration `20261112200000_v2_wo003_asset_boundary.sql`: `authenticated` só pode inserir assets em `QUARANTINED`; UPDATE e DELETE foram revogados. A promoção para `READY` usa exclusivamente o service role server-side, via `createSupabaseAdminClient()`. O trigger `guard_video_asset_insert` bloqueia `READY` forjado pelo Data API; o tombstone/GC automático fica para WO-005.
- Migration `20261112210000_v2_wo003_session_boundary.sql`: `authenticated` perde INSERT/UPDATE/DELETE em `video_upload_sessions` e mantém apenas SELECT. Sessões e partes são criadas/atualizadas pelo service role. Um check constraint amarra `quarantine_key` a `quarantine/<owner>/<session>/source`, e um trigger torna owner, IDs, chave, tamanho e hash imutáveis. O servidor também re-deriva a chave e rejeita sessão adulterada.
- FKs compostas para `episodes`/`scenes`; unique de versão por owner/episódio/cena; índices de status/episódio.

### 3.2 Storage e validação

- `src/lib/server/video-storage.ts`: interface `VideoStorage`; `R2VideoStorage` (S3-compatible, multipart, presign, copy, hash streaming, download temporário, signed GET); `InMemoryVideoStorage` para testes.
- `src/lib/server/video-probe.ts`: interface `VideoProbe`; `FfprobeVideoProbe` (execFile, timeout, sem shell); `FixtureVideoProbe`; validação de magic bytes MP4, H.264, 9:16, duração 4/6/8 s com tolerância ±500 ms, dimensões, rotação, frame rate e detecção VFR (`avg_frame_rate` vs `r_frame_rate`, densidade por `nb_frames`).
- `src/lib/server/video-assets.ts`: criação idempotente de sessão, quotas (200 MiB/clipe, 2 GiB/episódio, 10 GB/owner, bloqueio em 95%), partes, conclusão, SHA-256, quarentena, probe opcional, cópia para chave final, transições e listagem. A conclusão recupera um `CompleteMultipartUpload` já efetivado (fallback `statObject`) e um asset já criado quando a atualização da sessão falhou, sem duplicar o clipe.
- Nenhuma chave R2 vem do cliente; chaves são montadas a partir de UUIDs autorizados. Nenhuma URL permanente é devolvida ao browser.

### 3.3 Rotas e UI

- `POST /api/video/uploads` — inicia sessão multipart.
- `GET /api/video/uploads?episodeId=` e `GET /api/video/uploads/{sessionId}` — lista/retoma sessões.
- `POST /api/video/uploads/{sessionId}/complete` — conclui e valida.
- `GET /api/video/assets?episodeId=` — lista assets owner-scoped.
- `GET /api/video/{assetId}` — 302 para URL R2 assinada de 60 s, `private, no-store`, 404 para não-owner/não-READY.
- `/app/video` — seleção de episódio, múltiplos clipes, associação a cenas, reordenação antes do envio, progresso, retomada, erros e prévia protegida.
- Dev-only: `/api/video/dev-upload/...` e `/api/video/dev-object/...` habilitados apenas com `VIDEO_STORAGE_DRIVER=memory` em `import.meta.env.DEV`.

### 3.4 Configuração

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `VIDEO_STORAGE_DRIVER` (`r2`/`memory`), `VIDEO_PROBE_DRIVER` (`none`/`ffprobe`/`fixture`), `MAX_VIDEO_MB`, `VIDEO_PART_SIZE_MB`. `SUPABASE_SERVICE_ROLE_KEY` é server-only, necessário para criar/atualizar sessões de upload e para promover asset validado a `READY`; sem ele, uploads retornam 503 e nenhum `READY` é forjado. Segredos somente server-side; `.env.example` atualizado.

## 4. Testes executados

| Verificação              | Resultado                            | Evidência                                                                                    |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| PgTAP/RLS local          | **PASS 42/42**                       | `supabase test db`; 16 tabelas owner-scoped, incluindo as duas novas                         |
| Unit — probe             | **PASS 15**                          | magic bytes, duração, 9:16, codec, container, rotação, VFR/ffprobe                           |
| Unit — storage           | **PASS 4**                           | multipart, hash, copy, prefix, presign R2 sem vazar segredo                                  |
| Unit — schemas           | **PASS 6**                           | nome/idempotência/tamanho/partes                                                             |
| Unit — service           | **PASS 11**                          | partes/resume, hash, chave adulterada, falhas injetadas no M4, expiração, download não-READY |
| Unit total               | **PASS 81 + 1 skip**                 | `npm test`                                                                                   |
| Lint                     | **PASS**                             | `npm run lint`                                                                               |
| Typecheck                | **PASS 0 erros/0 warnings**          | `npm run typecheck`                                                                          |
| Build                    | **PASS**                             | `npm run build` (adapter-node local)                                                         |
| Policy audit             | **PASS 20 invariantes / 16 tabelas** | `npm run audit:policy`                                                                       |
| E2E upload 15 clipes     | **PASS**                             | `e2e/video-upload.spec.ts`: 15 fixtures, 15 cenas, READY, reload                             |
| E2E suíte completa       | **PASS 10/10**                       | hosted CI run `43332950992` no head `7f2cc69`; 10 passed (2.6m)                              |
| R2 live (upload/leitura) | **PASS**                             | 15 clipes enviados ao R2, READY, reload, 401 anônimo; `check:r2` PASS                        |
| CORS/lifecycle R2        | **CORS PASS / lifecycle PENDING**    | CORS PUT/GET/HEAD + ETag configurado; lifecycle pendente                                     |

## 5. Matriz de aceitação (issue #20)

| Critério                                                                                                  | Status         | Evidência/limite                                                                                           |
| --------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| Owner importa lote de 15 clipes e associa a 15 cenas, preservando original e SHA-256                      | **PASS**       | E2E 15/15 live no R2 com SHA-256 calculado/persistido e verificado via `/api/video/assets`, cenas e reload |
| Suporta upload parcial e retry sem duplicação; ordem salva/reaberta                                       | **PARTIAL**    | Sessões persistidas, retomada e partes idempotentes; falta teste de falha parcial real                     |
| Conteúdo inválido, excessivo e URL externa rejeitados                                                     | **PASS local** | schema, magic bytes, probe, limites, chaves server-side; unit tests                                        |
| Anon/non-owner 401/403/404; headers private/no-store                                                      | **PASS local** | E2E anônimo 401/303; RLS PgTAP; rota de download private/no-store                                          |
| Sem gasto/storage público; RLS e recuperação                                                              | **PASS**       | bucket privado; token/CORS ativos; sem gasto; lifecycle/GC pendente                                        |
| PgTAP RLS owner vs non-owner                                                                              | **PASS**       | 42/42, incluindo READY forjado e hard delete bloqueados                                                    |
| Playwright upload e recarga                                                                               | **PASS**       | 15 clipes, 15 cenas, reload; E2E 10/10                                                                     |
| Fixtures MP4 válido, truncado, duração longa, VFR, zero-byte, codec, tamanho, path traversal, concorrente | **PARTIAL**    | unit cobre magic/tamanho/schema/probe/VFR; faltam fixtures truncada/zero-byte e concorrência no E2E        |
| Unit/integration/error rollback, storage orphan reconciliation                                            | **PARTIAL**    | service cobre partes/resume, hash, M4 e expiração; reconciliação de órfãos/GC fica para WO-005             |
| Deliverables docs/Evidence/PR Draft                                                                       | **PASS**       | este documento + Evidence Bundle + PR Draft #48                                                            |

## 6. Riscos e limites

- **R2 token:** token bucket-scoped configurado e validado; o primeiro token foi exposto em saída local durante o provisionamento, revogado e substituído. Credenciais somente no arquivo privado; nenhuma no Git.
- **Validação real:** o E2E usa `FixtureVideoProbe`; o ffprobe real roda no worker/WO-005. Em produção, `VIDEO_PROBE_DRIVER=none` mantém assets em `QUARANTINED` (nunca `READY` sem prova).
- **Hash de 200 MiB na função Vercel:** conclusão com hash streaming pode exceder limites; o caminho de produção deve concluir/validar no worker. O WO-003 não faz deploy.
- **Miniaturas:** a UI usa `<video>` protegido; poster JPEG é opcional e será gerado no worker. Não há thumbnail pública.
- **CORS:** configurado para `http://127.0.0.1:4173` e `https://dif-studio.vercel.app`, métodos `PUT/GET/HEAD`, `ExposeHeaders: ETag`; validado no E2E live.
- **GC/retention:** lifecycle e tombstone estão definidos na ADR; rotina automática fica para WO-005. A tentativa de aplicar lifecycle via S3 (`Get/PutBucketLifecycleConfiguration`) retornou `AccessDenied` com o token bucket-scoped atual; a configuração precisa ser feita no dashboard ou com token que inclua a permissão de lifecycle.
- **Quotas:** 10 GB free; ~300 MiB/episódio; bloqueio em 95% no servidor; alerta em 80% pendente.

## 7. Próximos passos

1. Configurar lifecycle do bucket no dashboard/token com permissão (quarentena 7 dias; abortar multipart incompleto em 1 dia).
2. Integrar validação ffprobe no worker (WO-005) e ativar `VIDEO_PROBE_DRIVER=ffprobe`.
3. Auditar o delta, abrir PR Draft e não promover checkpoint.

## 8. Auditoria independente e correções

A primeira auditoria independente (commit `fb6a3c8`) retornou **BLOCKED**; a reauditoria do head `3a6a22f` retornou **CORRECTION REQUIRED** (H1/H2 de resume). As correções abaixo foram aplicadas neste PR:

- **H1 CSP:** `connect-src`, `media-src` e `img-src` agora permitem `https://*.r2.cloudflarestorage.com`; o E2E live valida upload direto e prévia.
- **H1 resume:** o complete aceita `parts: []` e mescla as partes já confirmadas da sessão; uma sessão com todas as partes registradas pode ser concluída.
- **H2 arquivo exato:** a sessão guarda `file_sha256` (hash calculado no browser); o resume compara o hash, e o servidor compara o SHA-256 do objeto R2 antes de READY. Arquivo diferente de mesmo tamanho é rejeitado.
- **M1 CI:** `scripts/audit-policy.mjs` formatado; `prettier --check` passa; CI `quality` PASS.
- **M2 idempotência:** a sessão existente só é retomada se owner/episódio/cena/tamanho/hash coincidirem; caso contrário, 409.
- **H1 session key (reauditoria):** a reauditoria independente do head `27a54d1` encontrou que um owner podia alterar `quarantine_key` via Data API e induzir o servidor a apagar um objeto R2 conhecido. A migration `20261112210000` revoga INSERT/UPDATE/DELETE de sessões para `authenticated`, amarra a chave ao owner/sessão e imutabiliza owner, IDs, chave, tamanho e hash; o servidor re-deriva e valida a chave. Teste de chave adulterada adicionado.
- **M3 retry parcial:** `uploaded_parts` + rota `PUT /api/video/uploads/{sessionId}/parts/{partNumber}`; o resume assina/reenvia apenas partes faltantes e o complete mescla as confirmadas.
- **M4 conclusão:** além do rollback de hash/prefix/copy, a conclusão recupera `CompleteMultipartUpload` já efetivado (fallback `statObject`) e um asset já criado quando a atualização da sessão falhou; a quarentena só é removida após o commit do asset, e testes injetam falha de insert e de update.
- **M5 quotas/limite:** 15 clipes/episódio aplicados no servidor e na UI; a cota do episódio soma assets + sessões ativas; owner 10 GB com bloqueio em 95%.
- **M6 cache:** URLs assinadas R2 incluem `ResponseCacheControl: private, no-store` e `Content-Disposition: inline`.
- **M7 drivers:** `memory` e `fixture` só funcionam em `import.meta.env.DEV`; produção retorna 503/sem probe.
- **M8/M11 RLS:** PgTAP **42/42**; `authenticated` não pode atualizar/deletar `video_assets`, inserir `READY` ou escrever sessões. A promoção a READY usa o service role server-side; READY forjado, hard delete e reescrita de chave são bloqueados no banco. Tombstone/GC fica para WO-005.
- **M9 service tests:** `video-assets.test.ts` cobre partes/resume, chave adulterada, hash errado, falhas injetadas no M4 (insert e update), sessão expirada e download não-READY.
- **M12 frame rate/VFR:** probe rejeita taxa fora de 23,976–60 fps, VFR (`avg_frame_rate` vs `r_frame_rate`) e densidade implausível por `nb_frames`; parser ffprobe tem testes com JSON real.
- **M13 expiração:** `loadSession` e o caminho de idempotência retornam 410; listas/cotas filtram sessões expiradas.
- **L1/L2:** dev-object exige DEV; `r2Configured` exige endpoint.

**Auditoria final:** a reauditoria independente do head `c07af6e` retornou **APPROVED**, sem findings bloqueantes. H1 (chave de sessão), B1/M4 (retenção da quarentena até o commit e recuperação após falha) e H1/H2 anteriores foram verificados; M2 (paginação/atômica de quotas) foi classificado como **não bloqueante** no escopo single-owner e fica para WO-013/WO-005. O PR permanece Draft e o merge/promoção exige aprovação explícita do owner.

**Pendências conhecidas (não bloqueantes):** lifecycle do bucket (bloqueado por escopo do token), fixtures truncada/zero-byte e concorrência no E2E, paginação/limite atômico de quotas (somas de linhas; check-then-act), poster/GC e ffprobe real no worker (WO-005). O WO-004+ permanece bloqueado até aprovação formal/merge do WO-003.

**Nota de E2E:** a suíte completa local passou **10/10** no run limpo ([`e2e-full-10of10.txt`](evidence/wo-003/e2e-full-10of10.txt)). Um rerun posterior falhou no journey pré-existente por 500 em `/app` e timeout de 900 s ([`e2e-full-rerun.txt`](evidence/wo-003/e2e-full-rerun.txt)); o teste de vídeo live passou 15/15. O CI hospedado é a autoridade.

**Evidência local:** [`evidence/wo-003/tests.txt`](evidence/wo-003/tests.txt), [`evidence/wo-003/r2-provisioning.txt`](evidence/wo-003/r2-provisioning.txt), [`evidence/wo-003/live-r2.txt`](evidence/wo-003/live-r2.txt), [`evidence/wo-003/e2e-live-r2.txt`](evidence/wo-003/e2e-live-r2.txt) e [`evidence/wo-003/e2e-full-10of10.txt`](evidence/wo-003/e2e-full-10of10.txt).

**Nenhum deploy de produção, gasto, segredo em Git ou promoção de checkpoint ocorreu.**
