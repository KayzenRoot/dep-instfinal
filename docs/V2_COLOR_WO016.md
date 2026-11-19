# DIF-V2-WO-016 — Color Match e presets de terror

**Status:** implementação completa em `feat/dif-v2-wo-016`; unit **218+3**, render FFmpeg real, E2E timeline **1/1** e responsivo **1/1** PASS; CI e auditoria independente **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `d96ed00` (checkpoint WO-015 promovido).
**Escopo:** WO-016 (#33), dependente de WO-002/003/006/011/012.

## Entregue

- Presets versionados `neutral`, `vhs_1987`, `police_archive`, `cctv` e `cursed_tape` com parâmetros declarativos allowlisted (`eq`, `colorbalance`, `noise`, `vignette`).
- `ColorGrade` persistido no `VideoEditPlan`: preset/versão, intensidade global 0–100%, referência criativa e overrides por clipe (força própria ou exclusão).
- `buildColorFilter` determinístico por clipe, escalando os parâmetros pela intensidade e retornando `null` para neutro/excluído; o render FFmpeg aplica o filtro após scale/crop/format e antes do concat/xfade.
- `/app/color`: seletor de episódio, presets, intensidade, referência e ajuste por cena; comparação antes/depois lado a lado por CSS aproximado; salvar cria nova versão DRAFT e remover restaura o plano sem correção.
- Manifesto do worker registra o `color` aplicado; o hash do plano versionado cobre o grade.
- Nenhuma GPU, rede neural, API paga ou alteração no clipe fonte.

## Capacidade real versus planejada

- O Color Match é **preset + intensidade + override por cena**, não uma correspondência automática de histograma entre clipes. A referência ancora a comparação antes/depois e a escolha criativa; não copia estatísticas de outra cena.
- A prévia lado a lado usa CSS aproximado; o FFmpeg eq/colorbalance/noise/vignette é a referência de render e pode divergir em cor/contraste.
- O render opera em `format=yuv420p` após scale/crop; fontes HDR/BT.2020 não foram testadas e não há promessa de tone mapping.
- Não há análise automática de crushing/clipping por frame; os parâmetros são conservadores e a revisão visual no aparelho continua obrigatória.
- O custo do filtro `noise` é medido no render de integração e no benchmark ARM64 disparado pela mudança de composição; não há fallback automático para preset leve ainda.

## Critérios de aceitação

| Critério                                                              | Estado       | Evidência                                                                              |
| --------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| 15 clipes recebem preset comum e intensidade por cena, antes/depois   | PASS local   | UI `/app/color`; E2E aplica preset e limpa; preview CSS antes/depois                   |
| Referência não altera fonte; reversão reprodutível; render compatível | PASS local   | grade no plano versionado; clear salva plano sem cor; filtro determinístico            |
| Preserva sombras e evita clipping excessivo em fixtures               | PASS parcial | parâmetros conservadores; teste de render real; QA visual manual pendente              |
| FPS/A/V intactos; custo por minuto medido e reportado                 | PASS parcial | integração FFmpeg verifica duração/codec; benchmark ARM64 no CI; sem per-minute report |

## Testes planejados

- Unit: presets distintos, neutro no-op, escala por força, override/exclusão, CSS aproximado.
- Render: comando contém `eq`/`colorbalance` por clipe e respeita exclusão; integração FFmpeg real de clipe graduado.
- E2E: aplicar preset/intensidade e remover correção, com nova versão.
- Responsivo 360/768/1440 com `/app/color`.

## Riscos e residuais

- Sem histogram matching automático; sem detecção automática de clipping/crushing.
- Preview CSS diverge do FFmpeg; revisão no MP4 final é obrigatória.
- HDR/BT.2020 não testado; comportamento documentado apenas para SDR.
- `noise` pode elevar custo de render; fallback leve automático não implementado.
- Aplicar cor cria nova versão DRAFT e exige aprovar plano + reaprovar legendas antes do render.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
