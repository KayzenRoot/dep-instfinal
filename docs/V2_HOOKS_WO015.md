# DIF-V2-WO-015 — Hook Lab: três aberturas e variantes exportáveis

**Status:** implementação completa em `feat/dif-v2-wo-015`; unit **213+3**, PgTAP **161/161**, policy **30/26**, E2E timeline **1/1** (4,5 min) e responsivo **1/1** PASS; CI e auditoria independente **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `9862f8c` (checkpoint WO-013 núcleo promovido).
**Escopo:** WO-015 (#32), dependente de WO-004/010/011/012.

## Entregue

- Contrato `HookVariant` versionado por episódio/plano/versão: `variant_key` (`cold_open`, `intriguing_line`, `sound_entry`), objetivo, hash do plano fonte, clipe/asset/cena de abertura, janela de tempo, premissa sem spoiler, score heurístico e motivos auditáveis.
- Motor determinístico em `src/lib/domain/hook-lab.ts`: escolhe até três clipes distintos usando curva de tensão do diretor, legendas interrogativas e eventos de áudio/diretor aceitos; retorna menos opções com limitações reais quando falta material.
- `hook_variants`: RLS owner-only, escrita apenas por service role, patch imutável sobre a versão do plano; aplicar cria uma **nova versão** via `saveVideoEditPlan` sem sobrescrever a original.
- `/app/hooks`: seletor de episódio, geração, cards A/B/C com vídeo do clipe de abertura, duração, premissa, score, motivos, aplicar como oficial e reverter à versão base; link no workspace.
- Aplicar/reverter mantém histórico de versões; trocar de variante aplica sobre o plano atual; CTA, narração e SFX continuam na linha do tempo original. A nova versão exige reaprovar as legendas antes do render, e o enqueue bloqueia render sem track aprovada quando o template de legendas está ativo.
- Exportação independente por variante em JSON (`/api/hooks/[variantId]/export`) com ID, nome, hash da versão fonte e do plano derivado, ordem de clipes, janela, score, motivos e próximos passos; o MP4 de cada variante usa aplicar → aprovar plano → reaprovar legendas → render.
- PgTAP: RLS owner-only, escrita negada ao owner, isolamento entre owners e unicidade por versão.
- Metadados preparados para análise manual na WO-020; nenhuma promessa de retenção ou viralidade.

## Capacidade real versus planejada

- O Hook Lab reordena **clipes inteiros** já READY; não cria frames, não gera vídeo por IA e não altera a duração total.
- A prévia é o clipe de abertura com seek no `sourceInMs`, não o render composto; o MP4 final continua sendo a referência e exige aplicar, aprovar o plano, reaprovar legendas e renderizar.
- O score é heurístico e transparente; não mede retenção, não ranqueia com dados reais e não substitui teste A/B na WO-020.
- A variante de “fala intrigante” usa apenas track com `current_status = APPROVED`; não gera texto novo. O hook de texto via Gemini opt-in não foi implementado nesta entrega.
- Sem spoiler automático semântico: a premissa é genérica e o owner revisa; nenhuma decisão de cânone/votação é alterada.

## Critérios de aceitação

| Critério                                                            | Estado   | Evidência                                                                       |
| ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| 3 variantes distinguíveis com timecodes/motivos; fallback honesto   | PENDENTE | unit engine 3/3; E2E gera ≥2 com material real                                  |
| Prévia/export A/B preservam sync, CTA, 9:16 e SHA; original intacto | PENDENTE | aplicar cria nova versão; reverter restaura base; render usa pipeline existente |
| Owner troca/reverte/reabre mantendo as três versões                 | PENDENTE | PgTAP + E2E aplicar/reverter                                                    |
| Nenhum prompt/variante enviado a Gemini offline                     | PENDENTE | nenhuma chamada de provider no Hook Lab                                         |
| Revisão humana confirma diferenças e sem spoiler                    | PENDENTE | revisão visual no aparelho; premissas genéricas                                 |

## Testes planejados

- Unit `hook-lab.test.ts`: três variantes distintas, aplicação sem duplicar clipes, fallback com material limitado.
- PgTAP: RLS, service-only writes, unicidade e isolamento.
- E2E timeline: gerar, aplicar como nova versão, reverter e confirmar que a versão anterior permanece.
- Responsivo 360/768/1440 com `/app/hooks`.

## Riscos e residuais

- Reordenar clipes inteiros pode mudar a relação visual↔fala; narração/legendas permanecem no tempo original. Revisão humana obrigatória.
- A variante de fala depende de legendas aprovadas; sem elas, o laboratório oferece menos opções.
- Não há edição frame-accurate nem trim específico do hook.
- Hook de texto via Gemini opt-in e score com dados reais ficam para adendos/WO-020.
- Aplicar/reverter cria nova versão DRAFT e exige aprovar o plano + reaprovar legendas; o enqueue bloqueia render sem legendas aprovadas para a versão.
- A variante JSON é exportável individualmente; o MP4 por variante não é gerado em um clique e segue o pipeline versionado.
- O estado APPLIED não é transacional com o save do plano; reaplicar/reverter valida a versão atual, mas concorrência extrema continua residual.
- Reverter restaura a versão base e descarta edições não-clip feitas depois dela; o histórico preserva a recuperação.
- O hash do plano derivado no export é calculado a partir da versão fonte; o apply opera sobre o plano atual compatível por assinatura de cortes.

## Correções pós-auditoria

A auditoria retornou **CORRECTION REQUIRED** (A1 legendas/CTA na nova versão, A2 export independente, A3 staleness, A4 testes, A5 backup). Aplicado:

- **A1:** enqueue bloqueia render quando o plano pede legendas e não há track aprovada para a versão/take; UI avisa que aplicar/reverter cria versão DRAFT que exige aprovar plano e reaprovar legendas.
- **A2:** export JSON independente por variante com ID, hashes fonte/derivado, ordem de clipes, score e próximos passos; MP4 por variante segue o pipeline aplicar→aprovar→reaprovar→render.
- **A3:** aplicar é idempotente na versão atual; reverter exige `APPLIED` e `appliedVersion === current_version`; aplicar valida a assinatura de cortes da versão fonte contra o plano atual.
- **A4:** PgTAP cobre unicidade; E2E cobre geração/aplicação/reversão; fixture de material limitado e apply sem duplicar clipes.
- **A5:** `hook_variants` incluído no backup/restore de metadados.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
