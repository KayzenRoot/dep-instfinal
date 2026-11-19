# DIF-V2-WO-016 — Color Match e presets de terror

**Status:** implementação e correções pós-auditoria em `feat/dif-v2-wo-016`; unit/integração locais, PgTAP, policy, E2E e benchmark medidos; CI, reauditoria e merge **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `d96ed00` (checkpoint WO-015 promovido).
**Escopo:** WO-016 (#33), dependente de WO-002/003/006/011/012.

## Entregue

- Presets versionados `neutral`, `vhs_1987`, `police_archive`, `cctv` e `cursed_tape` com parâmetros declarativos allowlisted (`eq`, `colorbalance`, `noise`, `vignette`).
- `ColorGrade` persistido no `VideoEditPlan`: preset/versão, intensidade global 0–100%, referência criativa e overrides por clipe (força própria ou exclusão).
- `buildColorFilter` determinístico por **id do clipe**, escalando os parâmetros pela intensidade e retornando `null` para neutro/excluído; o render FFmpeg aplica o filtro após scale/crop/format e antes do concat/xfade.
- `/app/color`: seletor de episódio, presets, intensidade, referência e ajuste por cena rotulado pelo `scene_index` real; comparação antes/depois lado a lado por CSS aproximado; salvar cria nova versão DRAFT e remover restaura o plano sem correção.
- Manifesto do worker registra o `color` aplicado; o hash do plano versionado cobre o grade.
- QA de render em plano graduado adiciona o check `COLOR_RANGE` (amostragem RGB, percentis de luma e clipping); clipping severo gera WARN, não bloqueio.
- Nenhuma GPU, rede neural, API paga ou alteração no clipe fonte.

## Presets e preservação de sombras

Os parâmetros foram recalibrados após fixtures de baixa luz, contraluz, rampa tonal e RGB extremo. A versão anterior de `cursed_tape` (contraste 1,15, gamma 0,97, vinheta PI/4) esmagava as sombras em cena escura; os presets agora usam contraste 1,05, gamma ≥ 1,1 e vinheta mais fraca (PI/9 a PI/10), preservando detalhe sem clipping nos fixtures.

| Preset           | Eq (100%)                                             | Ruído | Vinheta |
| ---------------- | ----------------------------------------------------- | ----- | ------- |
| `vhs_1987`       | brilho +0,02 · contraste 1,05 · sat 1,12 · gamma 1,10 | 4     | PI/9    |
| `police_archive` | brilho +0,02 · contraste 1,05 · sat 0,60 · gamma 1,15 | 3     | PI/9    |
| `cctv`           | brilho +0,02 · contraste 1,05 · sat 0,45 · gamma 1,18 | 6     | PI/9    |
| `cursed_tape`    | brilho +0,02 · contraste 1,05 · sat 0,85 · gamma 1,20 | 8     | PI/10   |

## Correções pós-auditoria (2026-11-19)

- **Clipe certo no render:** `NormalizedClip` carrega `clipId`; o filtro resolve por id e não pelo índice ordenado. Regressão cobre `plan.clips` fora de ordem cronológica.
- **Rótulo de cena:** `/app/color` cruza `sceneId` com `scene_index` do contexto (que já é 1-based) e ordena os clipes pela timeline; Hook Lab/reordenação não trocam mais “Cena N”.
- **Concorrência otimista:** formulários enviam `expectedVersion` exibido; helpers usam essa versão no RPC (um teste com versão divergente prova que a versão relida não é usada) e conflitos 409 chegam à UI.
- **Erros reais:** `VideoEditPlanError` é mapeado para 400/404/409/503 em vez de 503 genérico.
- **Overrides:** JSON/schema inválido retorna 400 (não descarta em silêncio); força é inteiro 0–100 no cliente e no servidor; referência/override com clipe inexistente ou duplicado retorna 400.
- **Remover cor:** botão só habilita quando há cor; servidor recusa remoção vazia sem criar versão; mensagem avisa DRAFT e reaprovação de legendas.
- **Referência nula:** `null` permanece “sem referência fixa” em vez de virar o primeiro clipe no próximo save; o E2E confere o select vazio após reload.
- **Plano inválido:** erro de hash/parse aparece como erro real, não como “salve uma timeline”.
- **Refresh seguro:** salvar/remover redireciona 303 para um GET com `saved`/`cleared`; atualizar a página não reenvia o POST nem mostra 409 falso.
- **Acessibilidade:** controles por cena têm `aria-label` com o nome da cena.
- **Prévia honesta:** UI e docs explicitam que a camada VHS global do render não aparece na prévia CSS.
- **Testes:** adicionados schema, helpers de servidor, actions (400/404/409 e redirect), regressão de ordem, fixtures de cor com detecção de no-op, QA `COLOR_RANGE` PASS/WARN e benchmark 720p/1080p.

## Capacidade real versus planejada

- O Color Match é **preset + intensidade + override por cena**, não uma correspondência automática de histograma entre clipes. A referência ancora a comparação antes/depois e a escolha criativa; não copia estatísticas de outra cena.
- A prévia lado a lado usa CSS aproximado; o FFmpeg eq/colorbalance/noise/vignette é a referência de render e pode divergir em cor/contraste. A camada VHS global do episódio também não é simulada na prévia.
- O render opera em `format=yuv420p` após scale/crop; fontes HDR/BT.2020 não foram testadas e não há promessa de tone mapping.
- Não há análise de clipping antes do render; depois do render, o QA amostra RGB e emite WARN quando um extremo passa de 20% ou os dois somam 30% dos pixels amostrados. A amostragem padrão é 0,2 fps/12 frames (grosseira para crush localizado) e o check não é crítico.
- Os parâmetros dos presets são a definição v1; alterá-los exige bump de `presetVersion` e dispatch versionado (residual para WO-021).
- O custo do Color Match foi medido localmente (Windows 11, Ryzen 5 2500U, FFmpeg 9.0.2): em 720p, 63,1 s de render por minuto de footage sem cor e 160,4 s com `cursed_tape@80` (2,54×); em 1080p, 111,0 s e 375,2 s (3,38×). CPU e, quando o FFmpeg reporta, RSS estão no artefato `docs/evidence/wo-016/benchmark-color.json`. No runner ARM64 do CI, o mesmo benchmark marcou 7,96→40,31 s/min em 720p e 16,20→83,57 s/min em 1080p (5,06× e 5,16×); o `maxrss` não é emitido pelo FFmpeg Linux. O workflow `color-render-benchmark` repete a medição a cada mudança de preset/composição.

## Critérios de aceitação

| Critério                                                              | Estado     | Evidência                                                                                                               |
| --------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 15 clipes recebem preset comum e intensidade por cena, antes/depois   | PASS       | E2E CI cria 15 clipes, aplica `cursed_tape@80`, persiste override 40 na cena 1, confere “Cena 1” e remove; preview antes/depois |
| Referência não altera fonte; reversão reprodutível; render compatível | PASS       | grade no plano versionado; clear salva plano sem cor; hash/manifesto; filtro determinístico; legado sem `color` intacto |
| Preserva sombras e evita clipping excessivo em fixtures; warning      | PASS       | 7 renders reais em 4 fixtures SDR; p05 e clipping medidos; teste falha se o grade for no-op; `COLOR_RANGE` PASS/WARN     |
| FPS/A/V intactos; custo real por minuto medido e reportado            | PASS       | integração verifica codec/duração/fps/geometria; benchmark 720p/1080p com s/min e CPU; job ARM64 no CI                  |

## Testes

- Unit: schema (limites, preset inválido, override), presets distintos/neutro/escala, estatísticas de cor, assessment/comparação, helpers de servidor (versão, target, clear), actions (400/409, overrides, `expectedVersion`).
- Render: filtro por clipe, exclusão e ordem fora de ordem; integração FFmpeg real de 4 s graduado.
- Cor: integração FFmpeg com baixa luz, contraluz, rampa e RGB extremo; 4 presets na fixture escura; sem shadow crush nem crescimento de clipping > 5 p.p.
- QA: artefato graduado recebe `COLOR_RANGE` PASS/WARN.
- E2E: preset + override por cena persistido + remoção com DRAFT; responsivo 360/768/1440 com `/app/color` populado.
- Benchmark: `npm run benchmark:color-render` (720p/1080p, com/sem cor, wall/CPU/RSS).

## Riscos e residuais

- Sem histogram matching automático; sem detecção de clipping antes do render.
- Preview CSS diverge do FFmpeg e não simula a camada VHS global; revisão no MP4 final é obrigatória.
- HDR/BT.2020 não testado; comportamento documentado apenas para SDR.
- `noise` eleva o custo (2,5–3,4× no host local, 5,1× no ARM64); fallback leve automático não implementado.
- Parâmetros v1 são globais; mudanças futuras exigem versionamento real (WO-021).
- Aplicar ou remover cor cria versão DRAFT e exige aprovar plano + reaprovar legendas antes do render.
- O QA de cor amostra 12 frames a 0,2 fps e usa limiares grosseiros; crush localizado pode passar. O check é WARN, não bloqueio.
- O benchmark local usa host Windows/AMD; os números ARM64 do CI (`44461340719`) e o host local divergem em escala, mas ambos foram registrados.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, reauditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
