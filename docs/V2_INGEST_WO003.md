# DIF-V2-WO-003 — Ingestão segura de clipes Flow e storage privado

**Work Order:** `DIF-V2-WO-003` · issue #20 · epic #17
**Base:** `main` `b0f78064a2a5902acc98c20efc92648ec540b7e9` (WO-002 merge, 2026-11-12)
**Branch:** `feat/dif-v2-wo-003`
**Status:** implementação e testes locais **PASS**; **aceitação live do R2 BLOCKED** até a criação manual do token R2 (o widget do dashboard não é automatizável de forma confiável e o OAuth do wrangler não tem escopo para criar tokens). Checkpoint V2 permanece **PROPOSED — NOT PROMOTED**.

## 1. Objetivo

Permitir upload em lote de clipes gerados manualmente no Flow, associados a episódio e cena, com armazenamento privado Cloudflare R2, quarentena, validação e acesso owner-only. Nenhum vídeo entra no PostgreSQL; nenhuma imagem Cloudinary é reutilizada para vídeo.

## 2. Decisão de storage

ADR-V2-002 **ACCEPTED** pelo owner em 2026-11-12: **Cloudflare R2 privado**. Bucket `dif-studio-video-private` criado no dashboard; acesso público desabilitado. Token R2 escopado ao bucket, CORS e lifecycle ficam pendentes de conclusão manual/provisionamento.

## 3. Entregue no código

### 3.1 Banco e RLS

Migration `supabase/migrations/20261112170000_v2_wo003_video_storage.sql`:

- `video_upload_sessions`: owner, episódio/cena, asset draft, idempotency key, upload multipart R2, chave de quarentena, parte/tamanho, status, expiração.
- `video_assets`: owner, episódio/cena, versão, provider `r2`, bucket/chave, poster, SHA-256, bytes, duração, dimensões, codec/container, status (`UPLOADING`, `QUARANTINED`, `VALIDATING`, `READY`, `REJECTED`, `DELETED`), retenção e tombstone.
- RLS owner-only `SELECT/INSERT/UPDATE/DELETE` com claim `dif_studio_owner=true`; anon revogado; `READY` exige SHA-256, bytes, duração, dimensões, codec, container e `validated_at`.
- FKs compostas para `episodes`/`scenes`; unique de versão por owner/episódio/cena; índices de status/episódio.

### 3.2 Storage e validação

- `src/lib/server/video-storage.ts`: interface `VideoStorage`; `R2VideoStorage` (S3-compatible, multipart, presign, copy, hash streaming, download temporário, signed GET); `InMemoryVideoStorage` para testes.
- `src/lib/server/video-probe.ts`: interface `VideoProbe`; `FfprobeVideoProbe` (execFile, timeout, sem shell); `FixtureVideoProbe`; validação de magic bytes MP4, H.264, 9:16, duração 4/6/8 s com tolerância ±500 ms, dimensões e rotação.
- `src/lib/server/video-assets.ts`: criação idempotente de sessão, quotas (200 MiB/clipe, 2 GiB/episódio, 10 GiB/owner), partes, conclusão, SHA-256, quarentena, probe opcional, cópia para chave final, transições e listagem.
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

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `VIDEO_STORAGE_DRIVER` (`r2`/`memory`), `VIDEO_PROBE_DRIVER` (`none`/`ffprobe`/`fixture`), `MAX_VIDEO_MB`, `VIDEO_PART_SIZE_MB`. Segredos somente server-side; `.env.example` atualizado.

## 4. Testes executados

| Verificação              | Resultado                            | Evidência                                                            |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| PgTAP/RLS local          | **PASS 33/33**                       | `supabase test db`; 16 tabelas owner-scoped, incluindo as duas novas |
| Unit — probe             | **PASS 7**                           | magic bytes, duração, 9:16, codec, container, rotação                |
| Unit — storage           | **PASS 4**                           | multipart, hash, copy, prefix, presign R2 sem vazar segredo          |
| Unit — schemas           | **PASS 5**                           | nome/idempotência/tamanho/partes                                     |
| Unit total               | **PASS 61 + 1 skip**                 | `npm test`                                                           |
| Lint                     | **PASS**                             | `npm run lint`                                                       |
| Typecheck                | **PASS 0 erros/0 warnings**          | `npm run typecheck`                                                  |
| Build                    | **PASS**                             | `npm run build` (adapter-node local)                                 |
| Policy audit             | **PASS 18 invariantes / 16 tabelas** | `npm run audit:policy`                                               |
| E2E upload 15 clipes     | **PASS**                             | `e2e/video-upload.spec.ts`: 15 fixtures, 15 cenas, reload; E2E 10/10 |
| E2E suíte completa       | **PASS 10/10**                       | `CI=1 node scripts/test-local-e2e.mjs` (servidor limpo)              |
| R2 live (upload/leitura) | **BLOCKED**                          | token R2 não criado; widget do dashboard não automatizável           |
| CORS/lifecycle R2        | **BLOCKED**                          | depende do token/provisionamento                                     |

## 5. Matriz de aceitação (issue #20)

| Critério                                                                                                  | Status                        | Evidência/limite                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Owner importa lote de 15 clipes e associa a 15 cenas, preservando original e SHA-256                      | **PASS local / BLOCKED live** | E2E 15/15 em memória com SHA-256; R2 live depende do token                                         |
| Suporta upload parcial e retry sem duplicação; ordem salva/reaberta                                       | **PARTIAL**                   | Sessões persistidas, retomada e partes idempotentes; falta teste de falha parcial real             |
| Conteúdo inválido, excessivo e URL externa rejeitados                                                     | **PASS local**                | schema, magic bytes, probe, limites, chaves server-side; unit tests                                |
| Anon/non-owner 401/403/404; headers private/no-store                                                      | **PASS local**                | E2E anônimo 401; RLS PgTAP; rota de download private/no-store                                      |
| Sem gasto/storage público; RLS e recuperação                                                              | **PASS local / BLOCKED live** | bucket privado; R2 token/CORS pendentes; sem gasto                                                 |
| PgTAP RLS owner vs non-owner                                                                              | **PASS**                      | 33/33                                                                                              |
| Playwright upload e recarga                                                                               | **PASS**                      | 15 clipes, 15 cenas, reload; E2E 10/10                                                             |
| Fixtures MP4 válido, truncado, duração longa, VFR, zero-byte, codec, tamanho, path traversal, concorrente | **PARTIAL**                   | unit cobre magic/tamanho/schema/probe; faltam fixtures VFR/concorrência e probe ffprobe real no CI |
| Unit/integration/error rollback, storage orphan reconciliation                                            | **PARTIAL**                   | storage/quarantine/rollback cobertos; GC/reconciliação de órfãos é WO-005                          |
| Deliverables docs/Evidence/PR Draft                                                                       | **PENDING**                   | este documento + Evidence Bundle + PR Draft                                                        |

## 6. Riscos e limites

- **R2 token:** criação manual necessária; sem token, `VIDEO_STORAGE_DRIVER=r2` retorna 503 e nenhum upload live é possível. Nenhuma credencial foi commitada.
- **Validação real:** o E2E usa `FixtureVideoProbe`; o ffprobe real roda no worker/WO-005. Em produção, `VIDEO_PROBE_DRIVER=none` mantém assets em `QUARANTINED` (nunca `READY` sem prova).
- **Hash de 200 MiB na função Vercel:** conclusão com hash streaming pode exceder limites; o caminho de produção deve concluir/validar no worker. O WO-003 não faz deploy.
- **Miniaturas:** a UI usa `<video>` protegido; poster JPEG é opcional e será gerado no worker. Não há thumbnail pública.
- **CORS:** uploads diretos do browser ao R2 exigem CORS restrito a `APP_ORIGIN` e `ExposeHeaders: ETag`; pendente.
- **GC/retention:** lifecycle e tombstone estão definidos na ADR; rotina automática fica para WO-005.
- **Quotas:** 10 GiB free; ~300 MiB/episódio; bloquear em 95% sem upgrade pago.

## 7. Próximos passos

1. Criar token R2 escopado ao bucket (manual) e salvar em `C:\Users\csn19\.zcode\dif-secrets\r2.env`; não colar no chat.
2. Configurar CORS do bucket para `http://127.0.0.1:4173` e `https://dif-studio.vercel.app`, métodos `PUT/GET/HEAD`, `ExposeHeaders: ETag`.
3. Rodar E2E live de 15 clipes no R2 e validar SHA-256/leitura/expiração.
4. Integrar validação ffprobe no worker (WO-005) e ativar `VIDEO_PROBE_DRIVER=ffprobe`.
5. Auditar o delta, abrir PR Draft e não promover checkpoint.

**Evidência local:** [`evidence/wo-003/tests.txt`](evidence/wo-003/tests.txt) e [`evidence/wo-003/r2-provisioning.txt`](evidence/wo-003/r2-provisioning.txt).

**Nenhum deploy de produção, gasto, segredo em Git ou promoção de checkpoint ocorreu.**
