# DIF-V2-WO-013 — Hardening operacional: quotas, backup, retenção e recuperação

**Status:** implementação completa e correções da auditoria em `feat/dif-v2-wo-013`; unit 210+3, PgTAP 155/155, policy 29/25, restore local e retenção dry-run PASS; CI final e reauditoria **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `7d15076` (checkpoint WO-012 promovido).
**Escopo:** WO-013 (#30) — núcleo operacional (quotas, limites de worker, saúde, backup/restore, retenção dry-run). As extensões OPS-2026-11-12 ligadas às WOs 015–021 ficam registradas como obrigações posteriores, sem infraestrutura duplicada.

## Entregue

- Quotas diárias por owner no `enqueue_render_job`: 20 jobs/dia e 2 GiB de saída/dia (UTC), além dos limites existentes de 3 jobs ativos por episódio e 100 na fila global; erros viram HTTP 429 `RENDER_DAILY_QUOTA`.
- Worker com reserva de disco configurável (`WORKER_DISK_RESERVE_MB`, default 2048) antes de reivindicar job: pausa com `worker_paused` em vez de falhar em loop; threads FFmpeg limitadas (`WORKER_FFMPEG_THREADS`, 1–8, default 2) e aplicadas no comando `-threads`.
- `render_queue_health()` service-only + `GET /api/render-jobs/health` owner-only com queued/running/failed/oldest/worker/heartbeat; painel mínimo na timeline (fila, worker sem lease).
- `scripts/backup-metadata.mjs`: dump schema/data do schema public via Supabase CLI, SHA-256 dos arquivos, contagens, artifacts e laudos; sem auth/secrets/mídia.
- `scripts/restore-metadata.mjs`: restaura em banco descartável `dif_restore_test`, aplica schema/dados, valida contagens, join episódio→temporada→série→cenas, hash manifesto↔laudo e presença de blob local; sinaliza blob ausente sem fingir sucesso.
- `scripts/retention.mjs`: dry-run por padrão, referencia artefatos locais aos manifests, exige `--confirm` para deletar, recusa exclusão com jobs ativos e mantém R2 manual.
- `grant select` explícito ao service role para as 19 tabelas operacionais usadas por backup/health.

## Runbook mínimo dos scripts

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=...
export SUPABASE_CLI_JS=/caminho/absoluto/node_modules/supabase/dist/supabase.js
npm run backup:metadata -- --out-dir /caminho/privado

export DOCKER_BIN=/caminho/absoluto/docker
npm run restore:metadata -- --backup-dir /caminho/privado --database dif_restore_test
```

`retention` usa apenas `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; o dry-run é o padrão e `--delete-local --confirm` é obrigatório para excluir.

## Capacidade real versus planejada

- R2 lifecycle/GC continua manual: o token bucket-scoped do R2 recebe `AccessDenied` em APIs de lifecycle; nenhuma exclusão remota é feita por script.
- Backup cobre o schema `public` (metadados/manifests); usuários do Auth, senhas, mídia e URLs assinadas não entram. Restore de Auth é um passo separado do runbook.
- Restore automatizado é limitado ao stack local descartável (`dif_restore_test`); remoto exige `psql`/runbook aprovado e nunca é executado por padrão.
- Quotas são constantes conservadoras (20/2 GiB) documentadas; não substituem monitoramento de free tier.
- Limites de CPU/RAM usam threads FFmpeg + concorrência 1 + timeout/lease; não há cgroup nativo dentro do processo Node.
- As extensões operacionais das WOs 015–021 (capas, hooks, StyleBible, analytics) ficam para depois dessas WOs.

## Critérios de aceitação

| Critério                                                              | Estado     | Evidência                                                                                                                      |
| --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| CPU/RAM/disco respeitam limites; fila informa status real             | PASS local | threads 1–8, reserva 2048 MB, pausa por disco, concorrência 1, health endpoint                                                 |
| Worker offline/restart/storage full/timeout recuperam sem READY falso | PASS local | pausa por disco sem claim, lease/reconcile, E2E enfileira/cancela sem worker                                                   |
| Restore em ambiente de teste recupera episódio/plano/cenas/SHA        | PASS local | `dif_restore_test`: 0 mismatches, join 30, 2 hashes manifesto=QA, blobs verified_local; run com blob removido retorna ok=false |
| Logs sem segredos; quotas/histórico; dry-run antes de limpeza         | PASS local | quota 429, health sanitizado, retenção dry-run, `--confirm` e recusa com job ativo                                             |
| V1 disponível com worker desativado                                   | PASS local | E2E enfileira/cancela sem worker e navega páginas V1                                                                           |

## Testes planejados

- PgTAP: quotas diárias de jobs/bytes, health JSON, grants service-only.
- Unit: `worker-limits` (reserva, threads), render composition com `-threads`.
- Backup/restore real local: schema+data dump, restore em `dif_restore_test`, contagens/join/hash.
- Retenção: dry-run com referenciado + órfão, recusa sem `--confirm`, deleção só do órfão.
- E2E timeline existente (worker real, QA/download) e responsivo; CI completo.

## Correções pós-auditoria

A primeira auditoria independente retornou **CORRECTION REQUIRED** (F1–F11). Aplicado:

- **F1/F5/F6:** allowlist + regex estrita de tabelas, verificação SHA-256 de schema/data antes de aplicar e nome de banco/container validado por regex.
- **F2:** `ok`/exit code agora exigem metadados corretos **e** blobs locais verificados por tamanho+SHA; blob ausente/hash mismatch são falha explícita, R2 fica `unverified_r2`.
- **F3/F4:** jobs e laudos são paginados; retenção e backup falham fechado em erro em vez de truncar em 1000.
- **F7:** CANCELED conta na cota diária, advisory lock por owner e teto de bytes documentado como soft.
- **F8:** env numérico do worker usa parser finito com fallback (poll/lease/reserva/intervalo).
- **F9/F10:** `-filter_threads` aplicado além de `-threads`; backup usa diretório privado 0700/0600; scripts exigem caminhos absolutos (`SUPABASE_CLI_JS`, `DOCKER_BIN`) e credenciais por env, sem lookup de PATH.
- **F11:** documentação reclassifica benchmark de CPU/RAM como parcial e não declara sucesso quando o blob está ausente.

## Riscos e residuais

- R2 lifecycle/GC manual até token com permissão; sem exclusão remota automática.
- Backup não inclui Auth users nem bytes de mídia; restore de identidade é manual.
- Quotas fixas podem precisar de ajuste após benchmark real de temporada.
- Limites de memória do FFmpeg não são impostos por cgroup; dependem de concorrência 1, timeout e monitoramento do host.
- Worker ainda usa service role ampla; escopo de menor privilégio continua aberto para WO-014.
- Extensões OPS das WOs 015–021 ainda pendentes.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
