# DIF-V2-WO-010 — Diretor de edição e curva de tensão

**Status:** implementação completa em `feat/dif-v2-wo-010`; unit, typecheck, lint, policy, build, PgTAP e E2E **PASS local**; CI, auditoria independente e aceitação humana **PENDENTES**. **Não merged**, **não deployed**, checkpoint apenas **PROPOSED**.
**Base:** `main` `faa329a` (checkpoint WO-009 promovido).
**Escopo:** WO-010 (#27) + addendum ENH-03 (curva de tensão cinematográfica), dependente de WO-004/WO-006/WO-008/WO-009.

## Entregue

- Contrato Zod `EditDirectorPlan` com presets `slow-burn`, `reveal`, `found-footage` e `custom`; pontos `[timeMs, tension 0..100]` estritamente crescentes; marcadores `HOOK/BUILDUP/RELIEF/REVEAL/CLIMAX/CTA`; eventos allowlisted (`SILENCE_BEFORE_REVEAL`, `DOOR_CREAK`, `VHS_STATIC`, `PHRASE_HIGHLIGHT`, `SFX_ACCENT`, `CTA_CARD`); status `PROPOSED/ACCEPTED/REJECTED/ADJUSTED`; revisão `DRAFT/REVIEWED/APPLIED`; hash canônico e snapshot da CTA anterior.
- Planner offline determinístico com seed, limite de eventos por preset (`slow-burn` 3, `found-footage` 5, `reveal` 6), detecção de cena de revelação, silêncio pré-revelação, porta/impacto somente com assets licenciados, glitch VHS, destaque de frase e CTA referenciando no máximo duas escolhas existentes.
- Provider Gemini opcional (`GEMINI_API_KEY`): prompt com dados separados de instruções, JSON estrito, timeout de 20 s, teto de saída de 2.048 tokens, allowlist de assets verificados e timecodes; qualquer falha cai no planner offline com aviso, sem fallback pago. Nenhuma resposta vira comando, Shell, SQL ou URL.
- Aplicação/reversão atômica do subplano de direção no `VideoEditPlan`: eventos aceitos viram eventos de áudio versionados com IDs determinísticos; CTA é aplicada somente se o card for aceito; `previousCta` restaura a CTA anterior no revert; assets ausentes ou sem licença comercial/social falham com erro explícito.
- Mapeamento da curva para parâmetros allowlisted: ganho de SFX, duração do glitch VHS (máximo 700 ms), duração do silêncio, ganho de música/ambiência em ±3 dB e seleção/quantidade de efeitos. O timing de clipes, narração e legendas é protegido e não é movido silenciosamente.
- Render: janelas `VHS_STATIC` viram `eq` com `enable='between(t,...)'`; janelas `SILENCE_BEFORE_REVEAL` aplicam `volume=0:enable='between(t,...)'` nos buses de música/ambiência. O grafo FFmpeg foi validado com FFmpeg 9.0.2.
- UI `/app/director`: seletor de episódio, preset/seed/suspense/modo, gráfico SVG da curva com comparação antes/depois, edição de pontos por campos numéricos, cards de evento com motivo/intensidade/status, CTA referenciada, aplicar/reverter, nota de versão e histórico. Sem processamento pesado no navegador.
- Navegação `Diretor` no workspace e cobertura E2E do fluxo sugerir → revisar → aplicar → reverter → aplicar → render.

## Capacidade real versus planejada

- O modo offline é o padrão e não faz chamadas de rede.
- O diretor **não reescreve** roteiro, escolhas, cânone, votos ou produto final; toda aplicação é uma nova versão DRAFT do plano e exige aprovação humana antes do render.
- A curva controla áudio, pausas e glitch; **não altera o ritmo de cortes** porque retiming de clipes dessincronizaria narração/legendas e violaria o contrato de timing canônico. Contraste de legendas por tensão também não é automatizado nesta WO.
- Glitch é limitado a 700 ms e um evento por proposta para reduzir risco fotossensível; não há alegação de retenção ou eficácia.
- Gemini é opcional e usa a chave gratuita já prevista em `docs/OPERATIONS.md`; nenhum serviço pago, GPU ou API de vídeo foi adicionado.

## Critérios de aceitação

| Critério                                                                         | Estado         | Evidência                                                                                          |
| -------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Mesmo roteiro/assets/seed produzem plano equivalente offline                     | **PASS local** | `edit-director.test.ts`: hash determinístico, variação por seed, 3 presets                         |
| Usuário solicita IA opcional, vê sugestões e rejeita sem alterar cânone          | **PASS local** | modo offline padrão; provider retorna DRAFT com `acceptedEventIds=[]`; UI exige aceite explícito   |
| JSON inválido, timecode negativo, asset foreign, efeito fora da allowlist        | **PASS local** | `director-ai.test.ts`: JSON inválido, asset estrangeiro e timecode fora; schema Zod rejeita demais |
| Caso “porta abre”: efeito no instante, pausa antes da revelação, sync preservado | **PASS local** | planner ancora silêncio/porta na cena de revelação; E2E cobre aplicação; render windows testadas   |
| Zero chamadas de API no modo offline, inclusive em retries                       | **PASS local** | `suggestDirectorWithGemini` não chama `fetch` sem chave; action offline usa apenas planner         |
| 120 s/15 cenas com ≥4 fases por preset                                           | **PASS local** | `edit-director.test.ts` verifica 6 marcadores e 4+ fases nos três presets                          |
| Edição manual de 3 pontos persiste após relogin                                  | **PASS local** | E2E edita 3 tensões e confirma após reload e após novo login                                       |
| Curva impacta mix/render nos timecodes corretos sem dessincronizar               | **PASS local** | testes unitários de ganho/duração; filtros `eq/volume enable`; timing de clipes intocado           |
| Preview e render com hash/versionamento e antes/depois                           | **PASS local** | `planHash`, versão do plano, curva anterior tracejada e histórico; render usa plano aprovado       |
| `slow-burn` usa menos efeitos que `reveal`                                       | **PASS local** | teste unitário diferencia a contagem de eventos                                                    |
| Rejeitar pontos inválidos/inputs maliciosos                                      | **PASS local** | pontos não monotônicos e glitch >700 ms rejeitados; prompt injection tratado como dados            |
| E2E sugerir → revisar → aplicar → reverter → render                              | **PASS local** | `e2e/timeline.spec.ts` 1/1 em 12,8 min; worker real concluiu READY                                 |
| Aceitação visual/auditiva humana dos 3 presets                                   | **PENDENTE**   | requer owner; amostras serão registradas em `docs/evidence/wo-010/`                                |

## Testes

- Suite completa local: **175 testes PASS + 3 skipped** (25 arquivos), incluindo FFmpeg real de 120 s; `edit-director.test.ts` 10/10, `director-ai.test.ts` 3/3, `render-composition.test.ts` 11/11.
- Typecheck `svelte-check`: **0 erros / 0 warnings**.
- Lint: **PASS** (`eslint . --max-warnings=0`).
- Policy: **27 invariantes / 24 tabelas** (sem migração nesta WO).
- FFmpeg: expressões `eq=...:enable='between(t,...)'` e `volume=0:enable='between(t,...)'` aceitas e executadas no FFmpeg 9.0.2.
- E2E: `e2e/timeline.spec.ts` **1/1 PASS** (12,8 min) com gerar → editar 3 pontos → aceitar VHS/CTA → aplicar → reload → novo login → reverter → reaplicar → narração/legendas → render READY; log em `docs/evidence/wo-010/e2e-timeline-local.log`.
- PgTAP: **131/131 PASS**; sem migração nova.
- CI/auditoria/aceitação humana serão registrados em `docs/evidence/wo-010/` após execução.

## Riscos e residuais

- Retiming de cortes e contraste de legendas por tensão ficam fora desta WO para não quebrar sincronização; documentados como limite, não como recurso entregue.
- A curva é uma proposta editorial; não garante retenção nem substitui revisão humana.
- Gemini continua opcional; indisponibilidade/quota/erro caem no offline, nunca em gasto.
- Aprovação humana dos presets e comparação visual/auditiva dos três estilos ainda pendentes.
- E2E local depende do stack Supabase local; durante a execução o Docker reiniciou e o Postgres recuperou o data directory, exigindo repetição.

## Gate

Testes completos, PgTAP, E2E, CI, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização explícita de merge/promoção. **Sem merge/deploy.**
