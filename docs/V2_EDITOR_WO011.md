# DIF-V2-WO-011 — Editor visual, preview e safe zones

**Status:** implementação completa em `feat/dif-v2-wo-011`; testes focados, typecheck, lint, E2E local e burn-in FFmpeg **PASS**; CI, auditoria independente e aceitação humana **PENDENTES**. **Não merged**, **sem deploy de produção**, checkpoint apenas **PROPOSED**.
**Base:** `main` `95e5d16` (checkpoint WO-010 promovido).
**Escopo:** WO-011 (#28) + addendum ENH-07 (prévia de safe zones TikTok/Reels), dependente de WO-003–WO-010.

## Entregue

- `PlatformPreviewProfile` versionado (`tiktok`, `reels`, `clean`) com canvas 1080×1920, área segura, zonas de UI simuladas, caixas padrão de legenda/CTA, fonte/data e disclaimer de simulação.
- `EditPlanPreview` persistido no `VideoEditPlan` com caixas canônicas de legenda/CTA; o save valida limites, área segura, sobreposição legenda↔CTA e colisão com zonas de UI.
- CTA e legendas ganharam posição real no ASS: `\an5\pos(...)` por caixa; `role: CTA` separa os cues de CTA dos demais. O render worker e a exportação ASS usam o layout do plano; o overlay de UI **não** entra no MP4.
- `/app/editor`: seleção de episódio, preview do clipe selecionado, overlay de safe zones, comparação TikTok/Reels/limpo, alertas de colisão, correção por campos x/y/width/height, reordenação, trim, transição, ganho master, mapa de faixas, waveform opt-in da narração, fila de render e versões.
- Ação “Editar automaticamente” aponta para o diretor; a ação “Timeline completa” mantém a fila/retry existentes.
- Navegação `Editor` no workspace; rota coberta pela checagem responsiva owner-only.
- E2E: 15 clipes, gerar direção, quatro correções persistidas (reorder, crossfade, caixa de legenda e ganho master), colisão HIGH bloqueando save, reload e render READY.

## Capacidade real versus planejada

- A prévia de vídeo é o **clipe selecionado**, não o render composto; ela mostra o overlay de safe zones e o texto de legenda/CTA da versão atual. O MP4 continua sendo a fonte de verdade.
- Perfis são **simulações conservadoras internas**, não cópias pixel-perfect das interfaces atuais do TikTok/Reels. O perfil Reels usa orientação conservadora de anúncios da Meta e não é uma garantia de orgânico.
- Crop de capa/feed, undo ilimitado, waveform sempre carregada e preview do render composto não fazem parte desta entrega. A waveform é opt-in e pode falhar sem bloquear a edição.
- Correções de legenda/CTA exigem salvar uma nova versão DRAFT; legendas aprovadas ficam presas à versão anterior e devem ser reaprovadas antes do render.
- Nenhuma API social, screenshot atual ou chamada de rede externa é usada.

## Critérios de aceitação

| Critério                                                                    | Estado           | Evidência                                                                                             |
| --------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| 15 cenas + edição automática + pelo menos 4 correções sem outro editor      | **PASS local**   | E2E timeline: direção, reorder, crossfade, caixa de legenda e ganho master persistidos e render READY |
| Prévia corresponde ao plano aplicado; progresso/erro/offline sem spinner    | **PASS local**   | preview lê plano/captions; alertas de colisão; fila de render; erro de waveform explícito             |
| Legendas, música, SFX, transição e reordenação persistem e atualizam render | **PASS local**   | plan versionado, preview boxes no ASS do worker, E2E reload e job real                                |
| Teclado/touch 360px; anon/nonowner sem mídia ou jobs                        | **PASS local**   | campos/botões sem drag; E2E owner-boundary 360/768/1440; layout /app e endpoints privados             |
| Fluxo V1 de roteiro/canon/imagens/ZIP íntegro                               | **PASS local**   | suíte existente e rotas não alteradas; CI deve confirmar regressão                                    |
| Clipe 1080×1920 com legenda no rodapé alerta e reposiciona; MP4 corrige     | **PASS local**   | colisão HIGH + save bloqueado; `buildCaptionAss` posicionado; burn-in FFmpeg mede caixa no frame      |
| TikTok/Reels distintos/configuráveis; CTA e capa não colidem                | **PASS parcial** | perfis e caixas configuráveis; CTA validada; crop de capa/feed fica residual                          |
| Alternar perfil não muda render/cânone; só correção salva muda o plano      | **PASS local**   | troca de perfil é estado local; save do plano é explícito                                             |
| Overlay não entra no MP4                                                    | **PASS local**   | overlay é DOM/CSS; ASS contém apenas cues e posições; burn-in não desenha zonas de UI                 |
| Aviso honesto de UI mutável/revisão no aparelho                             | **PASS**         | disclaimer em cada perfil e texto da página                                                           |

## Testes

- `platform-preview.test.ts` **6/6**: perfis, defaults sem colisão, colisão com UI, overlap, persistência, limites.
- `captions.test.ts` **27/27**: regressão de CTA/ASS e novas posições.
- `video-edit-plan.test.ts` **12/12**.
- Burn-in FFmpeg: **2/2**, incluindo caixa de legenda posicionada em frame real.
- E2E `timeline.spec.ts` **1/1** (3,0 min): quatro correções, reload, aprovação, render READY.
- E2E `owner-boundary.spec.ts` responsivo **1/1** (42,9 s).
- Typecheck **0/0**, lint PASS.

## Riscos e residuais

- A prévia não é o render composto; pode divergir em cor/ordem de clipes até o render.
- Perfis são estimativas conservadoras; UI dos apps pode mudar. Revisão final no aparelho é obrigatória.
- Crop de capa/feed não implementado nesta versão.
- Undo é feito por versões do plano/timeline, não por pilha ilimitada no editor.
- Waveform exige take de narração e decode no navegador; indisponibilidade não bloqueia save/render.
- Legendas aprovadas precisam ser reaprovadas após alterações de plano.
- E2E local usa stack Supabase descartável; Docker local pode exigir recuperação após restart.

## Gate

Unit/PgTAP/E2E/CI, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
