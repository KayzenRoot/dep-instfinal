# DIF-V2-WO-011 — Editor visual, preview e safe zones

**Status:** implementação completa, primeira auditoria corrigida e segunda rodada de correções (H3 + M1–M4) aplicada em `feat/dif-v2-wo-011`; testes focados, typecheck, lint, E2E local, burn-in FFmpeg e CI hosted **PASS** (`44314422937` em `e1599fb`); reauditoria e aceitação humana **PENDENTES**. **Não merged**, **sem deploy de produção**, checkpoint apenas **PROPOSED**.
**Base:** `main` `95e5d16` (checkpoint WO-010 promovido).
**Escopo:** WO-011 (#28) + addendum ENH-07 (prévia de safe zones TikTok/Reels), dependente de WO-003–WO-010.

## Entregue

- `PlatformPreviewProfile` versionado (`tiktok`, `reels`, `clean`) com canvas 1080×1920, área segura, zonas de UI simuladas, caixas padrão de legenda/CTA, fonte/data e disclaimer de simulação.
- `EditPlanPreview` persistido no `VideoEditPlan` com caixas canônicas de legenda/CTA; planos novos/rebuilds materializam o perfil TikTok padrão. Planos salvos antes da WO-011 (sem `preview`) mantêm o layout ASS histórico de 880 px no render/exportação até serem salvos como nova versão, evitando quebrar legendas já aprovadas. O save valida limites, área segura, sobreposição legenda↔CTA, colisão com UI e altura estimada do texto.
- CTA e legendas ganharam posição real no ASS: `\an5\pos(...)` por caixa; `role: CTA` separa os cues de CTA dos demais. O render worker e a exportação ASS usam o layout do plano; o overlay de UI **não** entra no MP4. Texto que não cabe na caixa falha no save/approval/render em vez de transbordar.
- `/app/editor`: seleção de episódio, preview do clipe selecionado, overlay de safe zones, crop capa/feed 4:5, relatório por canal, comparação TikTok/Reels/limpo, alertas de colisão com severidade, correção por campos x/y/width/height, reordenação, trim, transição, ganho master, mapa de faixas, waveform opt-in da narração e fila de render resumida. O histórico completo de versões fica na timeline.
- Ação “Editar automaticamente” aponta para o diretor; a ação “Timeline completa” mantém a fila/retry existentes.
- Navegação `Editor` no workspace; rota coberta pela checagem responsiva owner-only.
- E2E: 15 clipes, gerar direção, quatro correções persistidas (reorder, crossfade, caixa de legenda e ganho master), colisão HIGH bloqueando save, reload e render READY.

## Capacidade real versus planejada

- A prévia de vídeo é o **clipe selecionado**, não o render composto; ela mostra o overlay de safe zones e o texto de legenda/CTA da versão atual. O MP4 continua sendo a fonte de verdade.
- Perfis são **simulações conservadoras internas**, não cópias pixel-perfect das interfaces atuais do TikTok/Reels. O perfil Reels usa orientação conservadora de anúncios da Meta e não é uma garantia de orgânico.
- O crop capa/feed é uma sobreposição 4:5 conservadora no preview, não um arquivo de capa separado. Undo ilimitado, waveform sempre carregada e preview do render composto não fazem parte desta entrega. A waveform é opt-in e pode falhar sem bloquear a edição.
- Correções de legenda/CTA exigem salvar uma nova versão DRAFT; legendas aprovadas ficam presas à versão anterior e devem ser reaprovadas antes do render.
- Nenhuma API social, screenshot atual ou chamada de rede externa é usada.

## Critérios de aceitação

| Critério                                                                    | Estado           | Evidência                                                                                             |
| --------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| 15 cenas + edição automática + pelo menos 4 correções sem outro editor      | **PASS local**   | E2E timeline: direção, reorder, crossfade, caixa de legenda e ganho master persistidos e render READY |
| Prévia corresponde ao plano aplicado; progresso/erro/offline sem spinner    | **PASS parcial** | preview lê plano/captions/boxes e alerta fit; vídeo é o clipe selecionado, não o render composto      |
| Legendas, música, SFX, transição e reordenação persistem e atualizam render | **PASS local**   | plan versionado, preview boxes no ASS do worker, E2E reload e job real                                |
| Teclado/touch 360px; anon/nonowner sem mídia ou jobs                        | **PASS local**   | campos/botões sem drag; E2E owner-boundary 360/768/1440; layout /app e endpoints privados             |
| Fluxo V1 de roteiro/canon/imagens/ZIP íntegro                               | **PASS local**   | suíte existente e rotas não alteradas; CI deve confirmar regressão                                    |
| Clipe 1080×1920 com legenda no rodapé alerta e reposiciona; MP4 corrige     | **PASS local**   | colisão HIGH + save bloqueado; `buildCaptionAss` posicionado; burn-in FFmpeg mede caixa no frame      |
| TikTok/Reels distintos/configuráveis; CTA e capa não colidem                | **PASS local**   | perfis distintos, caixas configuráveis, CTA com fit validado, crop 4:5 e relatório por canal          |
| Alternar perfil não muda render/cânone; só correção salva muda o plano      | **PASS local**   | troca de perfil é estado local; save do plano é explícito                                             |
| Overlay não entra no MP4                                                    | **PASS local**   | overlay é DOM/CSS; ASS contém apenas cues e posições; burn-in não desenha zonas de UI                 |
| Aviso honesto de UI mutável/revisão no aparelho                             | **PASS**         | disclaimer em cada perfil e texto da página                                                           |

## Testes

- `platform-preview.test.ts` **9/9**: perfis, defaults sem colisão, colisão com UI, overlap, persistência, limites, fallback legado, fit de texto.
- `captions.test.ts` **27/27**: regressão de CTA/ASS e novas posições.
- `video-edit-plan.test.ts` **12/12**.
- Burn-in FFmpeg: **2/2**, incluindo caixa de legenda posicionada em frame real.
- Suíte unit completa: **191 PASS + 3 skipped** (26 arquivos), incluindo as integrações FFmpeg reais.
- E2E local `owner-boundary.spec.ts` **2/2**: jornada owner 6,3 min e checagem responsiva 360/768/1440 em 1,7 min; `timeline.spec.ts` coberto no CI.
- CI hosted `44314422937` em `e1599fb` **PASS**: baseline, PgTAP, E2E 13/13, Sonar, Socket e Vercel.
- Typecheck **0/0**, lint PASS, build PASS.

## Riscos e residuais

- A prévia não é o render composto; pode divergir em cor/ordem de clipes até o render.
- Perfis são estimativas conservadoras; UI dos apps pode mudar. Revisão final no aparelho é obrigatória.
- Undo é feito por versões do plano/timeline, não por pilha ilimitada no editor; screenshots são capturados sem comparação golden.
- Waveform exige take de narração e decode no navegador; indisponibilidade não bloqueia save/render.
- Legendas aprovadas precisam ser reaprovadas após alterações de plano.
- Plano com template de legendas ativo, mas sem track aprovada para a versão atual, ainda renderiza video-only e conclui READY; aviso/bloqueio explícito fica para a WO-012.
- A cue CTA é posicionada e validada na caixa de CTA; o overlay de UI e o crop capa/feed continuam sendo simulações.
- E2E local usa stack Supabase descartável; Docker local pode exigir recuperação após restart.

## Correções pós-auditoria

A primeira auditoria independente retornou **CORRECTION REQUIRED** (H1 bypass por plano legado sem preview; H2 texto maior que a caixa). Aplicado:

- Planos novos/rebuilds incluem preview TikTok padrão; save normaliza planos sem preview; planos legados mantêm o ASS histórico de 880 px até um novo save; editor inicializa preview de forma síncrona.
- `caption-metrics` compartilhado usa uma estimativa conservadora de largura/altura em plan, save/approval de legendas e ASS; CTA é rechunked pela largura da caixa e falha fechado quando não cabe.
- Crop capa/feed 4:5 e relatório TikTok/Reels no preview; CTA/legendas desativadas não bloqueiam save; severidade HIGH exibida.
- Avisos de plano preso a revisão anterior e de reaprovação de legendas; waveform com timeout/reset; fonte/versão do perfil visível; manifesto registra perfil e layout hash.

## Correções pós-CI

O CI hosted `44295516685` em `8248546` falhou apenas no gate responsivo: `/app/editor should not overflow at 360px`. A captura do artefato mostrou o `<select>` de episódio dimensionado pelo título mais longo. A mesma causa afetava `/app/director` (mascarada porque o teste aborta na primeira rota). Corrigido em `e1599fb`:

- Regra global em `src/app.css` para `.episode-picker select` (`min-width: min(34rem, 100%)`) e `.field select` (`min-width: 0; max-width: 100%`), cobrindo editor, director, timeline, captions, narration e video.
- Inputs do editor recebem `min-width: 0`/`width: 100%` dentro dos grids para não estourar em 360px com plano carregado.
- Reprodução local confirmou o erro antes e depois: responsivo **FAIL** em `8248546`, **PASS** em `e1599fb`; CI `44314422937` **PASS**.

## Segunda rodada de correções

A segunda auditoria independente (HEAD de código `e1599fb`) retornou **CORRECTION REQUIRED** por uma regressão HIGH de compatibilidade e quatro defeitos médios. Aplicado:

- **H3:** planos sem `preview` deixam de receber a caixa default de 810 px no render/exportação; `layoutFromPlan` retorna `null` para eles e o ASS histórico de 880 px é preservado. O manifesto registra `layoutSource: 'preview' | 'legacy'` e o editor avisa que salvar a nova versão adota as safe zones.
- **M1:** o texto de placeholder do preview não é mais validado como legenda real; só cues existentes no playhead bloqueiam o save.
- **M2:** cues com `role: CTA` são desenhados e validados na caixa de CTA, e os demais na caixa de legenda, alinhando preview e ASS.
- **M3:** `assertPreviewLayout`/`validateEditPlan` aceitam as flags de legenda/CTA ativas, e o editor só exige tamanho mínimo das caixas habilitadas; cliente e servidor concordam com caixas desativadas.
- **M4:** o preview busca `sourceInMs` no carregamento e pausa/limita em `sourceOutMs`; o playhead reflete o trim.
- **L2/L3:** regressão de cue legado no ASS, teste de caixas desativadas, alvos de toque maiores e estado de erro do vídeo.
- Evidência responsiva passa a incluir `/app/video` e `/app/timeline`; a cobertura de versões e de métricas foi corrigida no texto.

## Gate

Unit/PgTAP/E2E/CI, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
