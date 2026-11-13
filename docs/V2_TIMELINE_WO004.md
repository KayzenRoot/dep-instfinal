# DIF-V2-WO-004 — Timeline canônica, alinhamento e versões

**Work Order:** `DIF-V2-WO-004` · issue #21 · epic #17
**Base:** `feat/dif-v2-wo-003` head `4d1aa3c` (WO-003 audit-approved, not merged)
**Branch:** `feat/dif-v2-wo-004` (stacked on WO-003)
**Status:** implementação, PgTAP, unit e E2E **PASS**; CI hospedado `43369752010` passou antes das correções H1/M1/M2; **novo CI e reauditoria pendentes** após conflito P0001, rebuild de revisão e validação de aprovação. O merge de WO-003/WO-004 e a promoção do checkpoint exigem autorização explícita do owner.

## 1. Objetivo

Persistir uma montagem determinística e editável, separada do roteiro/cânone, com cenas, clipes READY, trims, transições, tracks, CTA e legendas. O plano é versionado, tem hash de manifesto e não altera episódio publicado, votos ou decisões canônicas.

## 2. Modelo

Migration `supabase/migrations/20261113090000_v2_wo004_edit_plans.sql`:

- `video_edit_plans`: um plano atual por owner/episódio; `current_version`, `current_status` (`DRAFT`, `APPROVED`, `RENDERED`), `plan jsonb`, `manifest_hash`, timestamps.
- `video_edit_plan_versions`: snapshots imutáveis (`plan`, hash, nota, versão); unique por owner/plano/versão; trigger rejeita UPDATE/DELETE.
- RLS owner-only para leitura; `authenticated` não tem INSERT/UPDATE/DELETE. Escritas passam por RPCs `SECURITY DEFINER` executáveis **somente por `service_role`**, chamadas pelo servidor com o owner verificado; a validação completa do plano e o hash ficam no servidor:
  - `save_video_edit_plan(owner, episode, expected_version, plan, hash, note)` — cria v1 ou falha com `P0001` (HTTP 409) em conflito; `P0001` evita o retry automático do PostgREST para `40001`.
  - `restore_video_edit_plan(owner, episode, version, expected_version, note)` — anexa uma nova versão; não apaga o histórico.
  - `set_video_edit_plan_status(owner, episode, expected_version, status)` — DRAFT/APPROVED; o servidor revalida hash, revisão e plano antes de aprovar.
- `episode_revision_number` é gravado a partir do plano; o plano não reescreve `episode_revisions`.
- `restore` revalida a versão de origem contra o contexto atual (episódio, cenas, assets READY, revisão) antes de anexar a nova versão.
- `loadEditPlan` recalcula o SHA-256 canônico e rejeita hash divergente; revogar `authenticated` das RPCs fecha o caminho de plano/hash forjado pelo Data API.

## 3. Contrato do plano

`src/lib/schemas/video-edit-plan.ts` valida:

- `episodeId`, `episodeRevisionNumber`, `durationMs` 90–150 s, `sceneDurationMs` 4/6/8 s, `fps` 30.
- até 4 tracks (`video`/`overlay`) e 60 clipes; cada clipe tem `sceneId`, `assetId`, `trackId`, `sourceIn/Out`, `timelineStart/End`, `transition` (`cut`/`crossfade`), `transitionMs` e `gainDb`.
- CTA opcional com janela explícita; template de legendas.
- `src/lib/domain/video-edit-plan.ts` valida invariantes: offsets monotônicos, duração explícita, trim preservado, asset READY da cena correta, sem asset/cena duplicado, sem sobreposição exceto crossfade curto, todas as cenas presentes, CTA dentro da duração.
- `buildDefaultEditPlan` usa as cenas e o asset READY mais recente por cena; 120 s/15×8 s, 90 s/12 cenas e 150 s/19 cenas com último clipe parcial.
- Quando o roteiro ganha uma revisão, a UI mostra aviso de plano obsoleto e oferece `Reconstruir para a revisão atual`, que cria uma nova versão default sem apagar o histórico.
- `canonicalEditPlanJson` ordena chaves; o servidor calcula SHA-256 e persiste em `manifest_hash`.

## 4. Server/UI

- `src/lib/server/video-edit-plans.ts`: contexto owner-only, load, validação, hash, RPCs e mapeamento de conflito/erros.
- `src/routes/app/timeline/+page.server.ts`: load do episódio, cenas, assets READY, plano, versões e ações `save`, `restore`, `status`.
- `src/routes/app/timeline/+page.svelte`: seletor de episódio, timeline de 15 clipes, trim, reordenação, crossfade, status, hash e histórico com restauração.
- `WorkspaceNav.svelte`: link “Timeline”.
- Nenhum campo de vídeo é gravado no PostgreSQL; o plano referencia `video_assets` READY e o storage permanece R2 privado.

## 5. Testes

| Verificação          | Resultado                            | Evidência                                                                                                      |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Domain/schema        | **PASS 11**                          | `video-edit-plan.test.ts`: 120/90/150, reorder, trim, crossfade, foreign asset, double-booking, canonical hash |
| PgTAP/RLS            | **PASS 58/58**                       | owner/non-owner plans, append-only versions, optimistic conflict, restore, approve, direct insert denied       |
| Unit total           | **PASS 92 + 1 skip**                 | `npm test`                                                                                                     |
| Lint/typecheck/build | **PASS**                             | `npm run lint`, `npm run typecheck`, `npm run build`                                                           |
| Policy audit         | **PASS 22 invariantes / 18 tabelas** | `npm run audit:policy`                                                                                         |
| E2E timeline         | **PASS local e CI**                  | `e2e/timeline.spec.ts`: 15 uploads, reorder, save v1, clean GET, approve, save v2, restore v1→v3; CI 12.4s     |
| E2E suíte            | **PASS 11/11** (3.2m CI)             | hosted CI `43369752010`; serial `workers=1` evita contenção do pool local                                      |
| CI baseline final    | **PASS 6m1s**                        | run `43369752010` on `f886b2d`: unit 92+1, PgTAP 58/58, policy 22/18, E2E 11/11                                |

## 6. Matriz de aceitação (issue #21)

| Critério                                                                                              | Status   | Evidência/limite                                                        |
| ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Timeline exata 120 s/15×8 s e alternativas 90/150 s com último clipe parcial                          | **PASS** | domain tests; UI default plan                                           |
| Reordenar/trim/transições atualizam offsets e durações                                                | **PASS** | domain tests; E2E reorder/save/reload                                   |
| Versões persistem, restore não apaga histórico, conflito concorrente rejeitado                        | **PASS** | PgTAP 54/54; E2E restore v1→v3                                          |
| Plano inválido (offset negativo, duração excedida, double-booking, asset foreign) retorna erro seguro | **PASS** | Zod + domain tests; RPC shape check                                     |
| Edição não muda cânone/roteiro; acesso owner-only                                                     | **PASS** | tabelas separadas; RLS/RPC owner; nenhum write em episodes/scenes/canon |

## 7. Riscos e limites

- **Stacked branch:** WO-004 depende do branch WO-003 ainda não mergeado; o merge dos dois exige autorização do owner. Não há deploy de produção.
- **Concorrência:** a RPC serializa por episódio com `FOR UPDATE`; `expected_version` nulo/obsoleto retorna 409 sem lost update. `P0001` é usado no lugar de `40001` para não acionar retry automático do PostgREST. A UI exige reload após conflito.
- **Tracks:** o editor entregue usa a track `video-main`; overlay/áudio/legendas ficam no contrato e no worker/WO-006/WO-009.
- **Render:** `RENDERED` existe no schema, mas só será definido pelo worker WO-006; o WO-004 não renderiza.
- **E2E:** timeline + upload de 15 clipes saturam o PostgREST local em paralelo; a suíte usa `workers: 1`. O CI hospedado é a autoridade.
- **M2/WO-003:** a cota de vídeo ainda usa somas de linhas/check-then-act; hardening em WO-013/WO-005.

## 8. Evidência e gate

- Evidência local e matriz acima; anexar saída do CI, PgTAP e E2E no Evidence Bundle.
- Auditoria independente e correções antes de qualquer merge/promoção.
- Checkpoint V2 permanece **PROPOSED — NOT PROMOTED**; WO-005+ bloqueado.
