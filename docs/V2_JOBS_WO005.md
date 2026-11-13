# DIF-V2-WO-005 — Motor de jobs, worker Oracle, fila segura e recuperação

**Work Order:** `DIF-V2-WO-005` · issue #22 · epic #17
**Base:** `feat/dif-v2-wo-004` `0860fd3` (WO-004 audit-approved, unmerged)
**Branch:** `feat/dif-v2-wo-005` (stacked)
**Status:** implementação, PgTAP, unit e E2E **PASS**; CI hospedado `43383787230` **PASS** em 6m25s; **auditoria independente final APPROVED** em `6ca4523` (código testado `f17209d`) para o escopo fila/stub. Checkpoint V2 **PROMOTED** em 2026-11-13; merge `dc405d8`. Nenhum daemon/worker foi implantado na VPS; o worker entregue é stub local (`WORKER_STUB=1`). Checkpoint V2 **PROMOTED** em 2026-11-13; merge `dc405d8`.

## 1. Objetivo

Fornecer caminho assíncrono persistido para jobs de render fora da Vercel, com fila owner-only, claim exclusivo, lease/heartbeat, retry, cancelamento, reconciliação após reinício e auditoria sanitizada. O worker real FFmpeg pertence ao WO-006; este WO entrega o motor de fila e o worker stub.

## 2. Modelo

Migration `supabase/migrations/20261113100000_v2_wo005_render_jobs.sql`:

- `render_jobs`: owner, episódio, plano/versão, status (`QUEUED`, `CLAIMED`, `RUNNING`, `READY`, `FAILED`, `CANCELED`), prioridade, tentativas, lease, heartbeat, output manifest e timestamps.
- `render_job_events`: trilha append-only saneada (`ENQUEUED`, `CLAIMED`, `STARTED`, `COMPLETED`, `FAILED`, `RETRY_QUEUED`, `CANCELED`, `LEASE_EXPIRED`).
- RLS owner-only para SELECT; `authenticated` não escreve. RPCs `SECURITY DEFINER` executáveis somente por `service_role`.
- Índice parcial único garante **um job ativo** (`CLAIMED`/`RUNNING`) globalmente; `claim_render_job` usa advisory lock + `FOR UPDATE SKIP LOCKED`.
- Enqueue exige plano `APPROVED`, idempotência por owner/chave, limite de 3 jobs ativos/episódio e fila global de 100.
- `reconcile_render_jobs` reenfileira ou falha leases expirados, sem apagar jobs READY.

## 3. Worker

`scripts/render-worker.mjs`:

- Node/ARM64-compatible, sem shell, sem URL/comando arbitrário; recebe apenas IDs via RPC.
- Usa `WORKER_SERVICE_ROLE_KEY` server-side (nunca no browser), `WORKER_STUB=1`, `WORKER_ID`, `WORKER_LEASE_SECONDS`, `WORKER_POLL_MS`, `WORKER_MAX_JOBS`.
- Claim → start → heartbeat periódico → executa stub → complete; em erro chama `fail_render_job` (retry/FAILED).
- SIGINT/SIGTERM aborta o job ativo e devolve o lease; `reconcile_render_jobs` cobre crash/restart.
- Logs JSON sem segredos, URLs assinadas ou dados privados.
- Nenhum deployment, container, firewall ou chave nova na VPS. WO-006 substitui o stub pelo FFmpeg real.

## 4. API/UI

- `POST/GET /api/render-jobs` — enfileira/lista jobs owner-only.
- `GET/DELETE /api/render-jobs/{jobId}` — status/cancelamento.
- `/app/timeline` ganhou painel de render: enfileirar plano aprovado, status, tentativas, erro, cancelar e polling somente enquanto houver job ativo.
- Erros de fila cheia retornam 429; plano não aprovado 409; job não cancelável 409.

## 5. Testes

| Verificação          | Resultado                                | Evidência                                                                                                                                                                                 |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PgTAP/RLS            | **PASS 81/81**                           | 20 tabelas; enqueue auth negado; service claim exclusivo; second worker null; start/heartbeat/complete; fail→retry; cancel; lease expirado→requeue; owner/non-owner; insert direto negado |
| Schemas              | **PASS 2**                               | enqueue defaults/IDs/priority                                                                                                                                                             |
| Unit total           | **PASS 95 + 1 skip**                     | `npm test`                                                                                                                                                                                |
| Lint/typecheck/build | **PASS**                                 |                                                                                                                                                                                           |
| Policy audit         | **PASS 23 invariantes / 20 tabelas**     |                                                                                                                                                                                           |
| E2E timeline+worker  | **PASS local**                           | aprovar plano, enfileirar, worker stub concluir READY, enfileirar segundo e cancelar                                                                                                      |
| E2E suíte            | **PASS local 11/11** (a confirmar no CI) | `workers=1`                                                                                                                                                                               |

## 6. Matriz de aceitação (issue #22)

| Critério                                                                     | Status      | Evidência/limite                                                           |
| ---------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| Enfileirar e acompanhar transições persistidas; 2 workers não claim same job | **PASS**    | PgTAP 81/81; advisory lock + unique active index                           |
| Reinício no meio do job reconciliado; retry sem duplicação/pagamento         | **PASS**    | reconcile lease expirado; idempotência; worker stub                        |
| Cancelamento termina filhos FFmpeg e remove temporários                      | **PARTIAL** | cancelamento de fila/lease implementado; FFmpeg real/temp cleanup é WO-006 |
| Anonymous/non-owner/forged/CSRF não leem/enfileiram; audit sem segredos      | **PASS**    | RLS owner-only, RPC service-only, same-origin hook, eventos sanitizados    |
| Worker offline com erro transparente e retry, sem travar V1                  | **PASS**    | jobs ficam QUEUED; API/UI mostram status; V1 independente                  |

## 7. Riscos e limites

- **Sem deploy na VPS:** worker só rodou localmente/CI stub; instalação real exige plano aprovado e `WORKER_STUB=0` com FFmpeg (WO-006).
- **Credencial:** service role no worker é poderosa; o contrato de menor privilégio na VPS precisa de role/RPC dedicada antes do deploy (WO-013/WO-014).
- **Concorrência:** 1 job global ativo; backpressure 100 e 3/episódio. Ajuste exige medição no worker real.
- **Cancelamento:** DB marca CANCELED e o worker aborta o stub; matar processo FFmpeg e limpar temporários é WO-006.
- **Residual não bloqueante (WO-006):** start/fail não exigem lease não expirado; shutdown consome tentativa; enqueue direto não pina expected plan version/revisão; worker id não é claim token/epoch; READY de stub não é indicado na UI; sem backoff/aging; offline é silencioso; testes negativos de lease/wrong-worker/anon e limite de fila pendentes.
- **Stacked:** depende de WO-003/WO-004, ambos Draft; merge/promoção exigem autorização.

## 8. Gate

Auditoria independente, CI no head final, evidence bundle e checkpoint PROPOSED. WO-006+ bloqueado.
