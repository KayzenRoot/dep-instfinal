# DIF-V2-WO-015 — Hook Lab: três aberturas e variantes exportáveis

**Status:** implementação completa em `feat/dif-v2-wo-015`; unit **213+3**, PgTAP **160/160**, policy **30/26**, E2E timeline **1/1** (4,3 min) e responsivo **1/1** PASS; CI e auditoria independente **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `9862f8c` (checkpoint WO-013 núcleo promovido).
**Escopo:** WO-015 (#32), dependente de WO-004/010/011/012.

## Entregue

- Contrato `HookVariant` versionado por episódio/plano/versão: `variant_key` (`cold_open`, `intriguing_line`, `sound_entry`), objetivo, hash do plano fonte, clipe/asset/cena de abertura, janela de tempo, premissa sem spoiler, score heurístico e motivos auditáveis.
- Motor determinístico em `src/lib/domain/hook-lab.ts`: escolhe até três clipes distintos usando curva de tensão do diretor, legendas interrogativas e eventos de áudio/diretor aceitos; retorna menos opções com limitações reais quando falta material.
- `hook_variants`: RLS owner-only, escrita apenas por service role, patch imutável sobre a versão do plano; aplicar cria uma **nova versão** via `saveVideoEditPlan` sem sobrescrever a original.
- `/app/hooks`: seletor de episódio, geração, cards A/B/C com vídeo do clipe de abertura, duração, premissa, score, motivos, aplicar como oficial e reverter à versão base; link no workspace.
- Aplicar/reverter mantém histórico de versões; trocar de variante aplica sobre o plano atual; CTA, narração, legendas e SFX continuam na linha do tempo original.
- PgTAP: RLS owner-only, escrita negada ao owner, isolamento entre owners e unicidade por versão.
- Metadados preparados para análise manual na WO-020; nenhuma promessa de retenção ou viralidade.

## Capacidade real versus planejada

- O Hook Lab reordena **clipes inteiros** já READY; não cria frames, não gera vídeo por IA e não altera a duração total.
- A prévia é o clipe de abertura com seek no `sourceInMs`, não o render composto; o MP4 final continua sendo a referência e exige aplicar + renderizar.
- O score é heurístico e transparente; não mede retenção, não ranqueia com dados reais e não substitui teste A/B na WO-020.
- A variante de “fala intrigante” usa legendas já aprovadas; não gera texto novo. O hook de texto via Gemini opt-in não foi implementado nesta entrega.
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
- Aplicar variante cria nova versão e pode exigir reaprovar legendas antes do render (regra existente).

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
