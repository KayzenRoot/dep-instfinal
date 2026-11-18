# DIF-V2-WO-010 — Diretor de edição e curva de tensão

**Status:** **PROMOTED** em `1824061` (squash-merge do PR #58); issue #27 fechada. Unit 181+3, PgTAP 131/131, E2E 13/13, CI `44191794064`, Sonar, Socket e ARM64 **PASS**; auditoria round 2 **APPROVED WITH RESIDUALS**; owner autorizou continuidade/merge em 2026-11-18 (“continue de onde parou”), com a ressalva registrada de que não houve veredito separado “aprovado” sobre as amostras. **Sem deploy de produção.**
**Base:** `main` `faa329a` (checkpoint WO-009 promovido); merge em `1824061`.
**Escopo:** WO-010 (#27) + addendum ENH-03 (curva de tensão cinematográfica), dependente de WO-004/WO-006/WO-008/WO-009.

## Entregue

- Contrato Zod `EditDirectorPlan` com presets `slow-burn`, `reveal`, `found-footage` e `custom`; pontos `[timeMs, tension 0..100]` estritamente crescentes; marcadores `HOOK/BUILDUP/RELIEF/REVEAL/CLIMAX/CTA`; eventos allowlisted (`SILENCE_BEFORE_REVEAL`, `DOOR_CREAK`, `VHS_STATIC`, `PHRASE_HIGHLIGHT`, `SFX_ACCENT`, `CTA_CARD`); status `PROPOSED/ACCEPTED/REJECTED/ADJUSTED`; revisão `DRAFT/REVIEWED/APPLIED`; hash canônico e snapshot da CTA anterior.
- Planner offline determinístico com seed, limite de eventos por preset (`slow-burn` 3, `found-footage` 5, `reveal` 6), detecção de cena de revelação, silêncio pré-revelação, porta/impacto somente com assets licenciados, glitch VHS, destaque de frase e CTA referenciando no máximo duas escolhas existentes.
- Provider Gemini opcional (`GEMINI_API_KEY`): prompt com dados separados de instruções, JSON estrito, timeout de 20 s, teto de saída de 2.048 tokens, allowlist de assets verificados e timecodes; qualquer falha cai no planner offline com aviso, sem fallback pago. Nenhuma resposta vira comando, Shell, SQL ou URL.
- Aplicação/reversão atômica do subplano de direção no `VideoEditPlan`: eventos aceitos viram eventos de áudio versionados com IDs determinísticos; CTA é aplicada somente se o card for aceito; `previousCta` restaura a CTA anterior no revert; assets ausentes ou sem licença comercial/social falham com erro explícito.
- Mapeamento da curva para parâmetros allowlisted: ganho de SFX, duração do glitch VHS (máximo 700 ms), duração do silêncio e offset de ganho de música/ambiência em ±3 dB calculado no início do evento. O timing de clipes, narração e legendas é protegido e não é movido silenciosamente. A quantidade de eventos é limitada pelo preset (não pela curva), e o ganho de ambiência não é automação contínua nesta versão.
- Render: janelas `VHS_STATIC` viram `eq` com `enable='between(t,...)'`; janelas `SILENCE_BEFORE_REVEAL` aplicam `volume=0:enable='between(t,...)'` nos buses de música/ambiência. O grafo FFmpeg foi validado com FFmpeg 9.0.2.
- UI `/app/director`: seletor de episódio, preset/seed/suspense/modo, gráfico SVG da curva com comparação antes/depois, edição de pontos por campos numéricos, cards de evento com motivo/intensidade/status, CTA referenciada, aplicar/reverter, nota de versão e histórico. Sem processamento pesado no navegador.
- Navegação `Diretor` no workspace e cobertura E2E do fluxo sugerir → revisar → aplicar → reverter → aplicar → render.

## Capacidade real versus planejada

- O modo offline é o padrão e não faz chamadas de rede.
- O diretor **não reescreve** roteiro, escolhas, cânone, votos ou produto final; toda aplicação é uma nova versão DRAFT do plano e exige aprovação humana antes do render.
- A curva controla áudio, pausas e glitch; **não altera o ritmo de cortes** porque retiming de clipes dessincronizaria narração/legendas e violaria o contrato de timing canônico. Contraste de legendas por tensão, ducking dinâmico e automação contínua de ambiência também não são automatizados nesta WO; o ganho de ambiência é um offset estático por evento.
- `PHRASE_HIGHLIGHT` é registrado como marcador editorial informativo nesta versão; não altera o render. A CTA e os efeitos de áudio/VHS são os elementos aplicados.
- Glitch é limitado a 700 ms por evento, 3 eventos e 2.100 ms no total; o planner propõe um evento, reduzindo risco fotossensível. Não há alegação de retenção ou eficácia.
- Gemini é opcional e usa a chave gratuita já prevista em `docs/OPERATIONS.md`; nenhum serviço pago, GPU ou API de vídeo foi adicionado.

## Critérios de aceitação

| Critério                                                                         | Estado               | Evidência                                                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mesmo roteiro/assets/seed produzem plano equivalente offline                     | **PASS local**       | `edit-director.test.ts`: hash determinístico, variação por seed, 3 presets                                                                                  |
| Usuário solicita IA opcional, vê sugestões e rejeita sem alterar cânone          | **PASS local**       | modo offline padrão; provider retorna DRAFT com `acceptedEventIds=[]`; UI exige aceite explícito                                                            |
| JSON inválido, timecode negativo, asset foreign, efeito fora da allowlist        | **PASS local**       | `director-ai.test.ts`: JSON inválido, asset estrangeiro e timecode fora; schema Zod rejeita demais                                                          |
| Caso “porta abre”: efeito no instante, pausa antes da revelação, sync preservado | **PASS local**       | planner ancora silêncio/porta na cena de revelação; E2E cobre aplicação; render windows testadas                                                            |
| Zero chamadas de API no modo offline, inclusive em retries                       | **PASS local**       | `suggestDirectorWithGemini` não chama `fetch` sem chave; action offline usa apenas planner                                                                  |
| 120 s/15 cenas com ≥4 fases por preset                                           | **PASS local**       | `edit-director.test.ts` verifica 6 marcadores e 4+ fases nos três presets                                                                                   |
| Edição manual de 3 pontos persiste após relogin                                  | **PASS local**       | E2E edita 3 tensões e confirma após reload e após novo login                                                                                                |
| Curva impacta mix/render nos timecodes corretos sem dessincronizar               | **PASS local**       | testes unitários de ganho/duração; filtros `eq/volume enable`; timing de clipes intocado                                                                    |
| Preview e render com hash/versionamento e antes/depois                           | **PASS local**       | `planHash`, versão do plano, curva anterior tracejada e histórico; render usa plano aprovado                                                                |
| `slow-burn` usa menos efeitos que `reveal`                                       | **PASS local**       | teste unitário diferencia a contagem de eventos                                                                                                             |
| Rejeitar pontos inválidos/inputs maliciosos                                      | **PASS local**       | pontos não monotônicos e glitch >700 ms rejeitados; prompt injection tratado como dados                                                                     |
| E2E sugerir → revisar → aplicar → reverter → render                              | **PASS local**       | `e2e/timeline.spec.ts` 1/1 em 12,8 min; worker real concluiu READY                                                                                          |
| Aceitação visual/auditiva humana dos 3 presets                                   | **PASS c/ ressalva** | owner autorizou continuidade/merge após receber as amostras (“continue de onde parou”); não houve veredito separado “aprovado” — ver `owner-acceptance.txt` |

## Testes

- Suite local: **175 testes PASS + 3 skipped** (25 arquivos) antes dos dois testes finais; CI final **181 + 3**. Focados: `edit-director.test.ts` 14/14, `director-ai.test.ts` 5/5, `render-composition.test.ts` 11/11 (30/30).
- Typecheck `svelte-check`: **0 erros / 0 warnings**.
- Lint: **PASS** (`eslint . --max-warnings=0`).
- Policy: **27 invariantes / 24 tabelas** (sem migração nesta WO).
- FFmpeg: expressões `eq=...:enable='between(t,...)'` e `volume=0:enable='between(t,...)'` aceitas e executadas no FFmpeg 9.0.2.
- E2E: `e2e/timeline.spec.ts` **1/1 PASS** (12,8 min) com gerar → editar 3 pontos → aceitar VHS/CTA → aplicar → reload → novo login → reverter → reaplicar → narração/legendas → render READY; log em `docs/evidence/wo-010/e2e-timeline-local.txt`.
- PgTAP: **131/131 PASS**; sem migração nova.
- CI: run **44190122840** **SUCCESS** (6m45s) — format/lint/typecheck, unit **181+3**, build, policy 27/24, audit de produção, PgTAP e E2E **13/13** (3,3m); Sonar, Socket e Vercel preview PASS. ARM64 run **44190122832** SUCCESS: 7,738 s wall / 165.948 KiB RSS no mix de 120 s.
- Auditoria independente e aceitação humana serão registradas em `docs/evidence/wo-010/` após execução.

## Correções pós-auditoria independente

A primeira auditoria (head `e196ca7`) retornou **CORRECTION REQUIRED** por um HIGH: o cap de 700 ms era por evento, sem limite agregado de glitches. Correções aplicadas:

- VHS limitado a 3 eventos e 2.100 ms somados, além de 700 ms por evento.
- Timeout do Gemini cobre também a leitura do corpo; testes para timeout, 401, 429, 500, JSON inválido, asset foreign, CTA estrangeira e prompt injection.
- Instruções e dados do Gemini separados (`systemInstruction` vs. conteúdo do usuário); allowlist de SFX exige `kind === 'SFX'`.
- Rate limit de 6 sugestões Gemini por hora por owner; offline não consome bucket.
- Aplicar/reverter avisa que legendas aprovadas ficam presas à versão anterior e precisam ser reaprovadas; a CTA entra pelas legendas.
- Pontos: inserção no maior intervalo, sem duplicar `timeMs`; erros do Zod são devolvidos com caminho/mensagem.
- Duração de VHS/silêncio limitada na UI; fades de SFX curtos escalados; total de eventos de áudio limitado a 64.
- `PHRASE_HIGHLIGHT` identificado como informativo (sem efeito no render nesta versão).
- Controle “Reduzir movimento” remove o glitch VHS da aplicação; botões têm nomes acessíveis específicos e a curva tem resumo textual.
- Associação episódio↔proposta validada no apply; marcadores duplicados rejeitados; seed 0 e 1 deixam de colidir.
- Testes: 14 diretor + 5 provider + 11 render (30 focados) PASS local.

## Riscos e residuais

- Retiming de cortes, contraste de legendas, ducking dinâmico e automação contínua de ambiência ficam fora desta WO; o ganho de ambiência é um offset estático no início do evento.
- Aplicar/reverter invalida legendas aprovadas por versão; a UI avisa, mas não faz rebind automático.
- O rate limit do Gemini é process-local; instâncias múltiplas exigem limite de borda.
- `PHRASE_HIGHLIGHT` é informativo e não altera o render nesta versão.
- A curva é uma proposta editorial; não garante retenção nem substitui revisão humana.
- Gemini continua opcional; indisponibilidade/quota/erro caem no offline, nunca em gasto.
- Aprovação humana dos presets e comparação visual/auditiva dos três estilos ainda pendentes.
- E2E local depende do stack Supabase local; durante a execução o Docker reiniciou e o Postgres recuperou o data directory, exigindo repetição.

## Gate

Testes completos, PgTAP, E2E, CI, Evidence Bundle, Checkpoint Delta, auditoria independente e autorização de continuidade do owner. **Merged** em `1824061`; sem deploy de produção. WO-011 (#28) é a próxima WO e deve confirmar suas dependências no corpo da issue.
