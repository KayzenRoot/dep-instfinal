# DIF-V2-WO-019 — Finais A/B, CTA cinematográfica e votação manual

**Status:** implementação completa; CI `44676921244` PASS em `ff00957` (307+3 unit, PgTAP 210/210, E2E 17/17, Sonar PASS), policy 33/31; correções da auditoria aplicadas; auditoria delta final **PENDENTE**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `c94409d` (checkpoint WO-018 promovido).
**Escopo:** WO-019 (#36), dependente de WO-004/008/010/011/012 e do par de escolhas V1.

## Entregue

- `ChoiceEndCardConfig` versionado: preset, layout, duração, prompt, rodapé, revelação, movimento reduzido, SFX/volume e política explícita de narração (`mute` padrão, `keep` como override).
- `choice_end_cards` append-only com revisão por episódio, snapshot das duas escolhas, revisão do episódio, hash versionado, status DRAFT/APPROVED, quota de 200 e poda service-only preservando APPROVED; RLS owner-read/service-write e RPC service-only.
- Seis presets determinísticos (`doors`, `stamped`, `signal`, `cctv`, `split`, `analog`) e dois layouts (`split`, `stacked`), com safe area conservadora do perfil TikTok.
- Render do card como ASS standalone queimado no fim do vídeo, em camada posterior às legendas; nada de nova geração de vídeo, API paga ou GPU.
- SFX sintetizado localmente em WAV determinístico (`beep`, `rumble`, `pulse`) e misturado pelo pipeline existente com `loudnorm`, `alimiter` e true peak.
- `/app/finale`: seleciona episódio, lê as duas escolhas, gera 1–2 layouts, aprova/restaura revisões, mostra prévia em 9:16 com safe zone e baixa ASS/JSON/WAV/ZIP.
- Vínculo à timeline: “Anexar à timeline” cria/atualiza o plano versionado com `plan.endCard` e janela no fim do episódio; “Remover” limpa o vínculo. O save server-side revalida card aprovado e escolhas atuais.
- Gate de canon: card antigo fica `stale` quando qualquer rótulo/ID/conjunto de escolhas muda; API retorna 409 e o anexo/export é bloqueado até novo card aprovado. Final sem duas escolhas não recebe card inventado.
- Export Flow/ZIP inclui `finale/end-card.ass`, `finale/end-card.json` e `finale/choices.md` quando existe card aprovado.
- QA ganhou o check crítico `END_CARD` (card válido e dentro da área segura; off → desativado).
- Nav “Final A/B”, link no episódio e link na timeline; backup/restore e policy incluem `choice_end_cards`.

## Capacidade real versus planejada

- O card é uma composição 2D (ASS + SFX), não um vídeo novo; não há geração no Flow, publicação automática ou coleta de votos.
- O vínculo com o resultado posterior continua o fluxo V1 manual (`polls`, `poll_results`, `canonical_decisions`); o card nunca cria, infere ou registra voto.
- A prévia da UI é uma simulação DOM/CSS; o ASS renderizado é a referência de export. O teste de integração FFmpeg verifica pixels do card no MP4.
- Labels vêm sempre das escolhas V1; não há edição de texto no card fora do prompt/rodapé. Labels longos que não caibam no layout escolhido são bloqueados com mensagem para usar o layout empilhado.
- O layout `split` exige labels curtos; `stacked` aceita até quatro linhas por escolha. Não há shrink tipográfico além do limite de linhas.
- A janela é sempre o fim do episódio; não há arraste da posição na timeline nesta WO.
- O SFX é sintetizado por fórmula; não usa biblioteca licenciada nem asset externo.
- O histórico visível é limitado a 30 revisões; a poda é service-only e preserva APPROVED.
- Consequências multilinha do V1 são aceitas no snapshot do cânone; apenas labels/prompt/rodapé passam por `printableText`.
- A migration `20261120090000` é a primeira aplicação desta WO e nunca foi deployada; não existe ambiente com o schema anterior. Cards sintéticos locais das rodadas de auditoria foram removidos, então não há backfill a executar. O CI usa banco fresco.

## Critérios de aceitação

| Critério                                                                               | Estado       | Evidência                                                                                           |
| -------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| Episódio com ENTRAR/FUGIR produz CTA fiel, 9:16, 2 layouts, animação/som configuráveis | PASS         | 6 presets × 2 layouts; ASS/FFmpeg; E2E gera split+stacked e aprova; preview 9:16                    |
| Mudança de texto no roteiro aprovado invalida CTA antigo e exige revisão               | PASS         | hash/snapshot; card stale; API 409; E2E altera escolha via RPC e vê 3 revisões stale                |
| Final sem opções não recebe escolha inventada, erro ou voto fictício                   | PASS         | RPC exige exatamente 2 escolhas; PgTAP cobre episódio sem escolhas; UI mostra aviso de finale vazio |
| Preview e MP4 legíveis; SFX dentro dos níveis; redução de movimento                    | PASS parcial | teste FFmpeg extrai frame e verifica luma/acentos; loudnorm/alimiter; `reducedMotion` remove fades  |
| Voto manual segue fluxo V1, sem scraper ou automação                                   | PASS         | nenhuma tabela/RPC de voto nova; card apenas lê `choices`; export orienta o voto manual             |

## Correções pós-auditoria independente

- **C1 — geometria ASS:** retângulos passaram a usar `\an7\pos(...)`, ancorando o canto superior esquerdo. O teste FFmpeg agora compõe sobre frame verde e exige menos de 500 pixels verdes, além de luma escura e acentos visíveis.
- **H1 — mute da narração:** `buildNarrationMuxCommand` aceita `muteWindows` e aplica `volume=0` na janela do card mesmo quando `sfx: none` e não há eventos de áudio; teste FFmpeg mede volume antes/dentro do card.
- **H2 — stale real:** o snapshot inclui `consequence`, compara a revisão do episódio e o RPC recebe o snapshot exato, rejeitando mudanças concorrentes (`end_card_choice_snapshot_conflict`). O E2E muda só a consequência (mesmos labels) e confirma stale/409, depois muda o label.
- **H3 — fim real da timeline:** o card precisa terminar em `max(clip.timelineEndMs)` e ter exatamente `durationMs`; o anexo usa o fim real dos clipes e falha se a timeline for menor que o card.
- **M1/M5/M6/M7:** anexo usa o `expectedVersion` do formulário; card aprovado é buscado fora do limite de 30; quota conta apenas DRAFTs (aprovadas não travam a quota); fontes usam famílias únicas resolvíveis.
- **M8:** QA exige janela no fim real; manifesto registra o card completo; E2E aprova e confere `finale/end-card.ass` no ZIP de export.

## Testes planejados/executados

- Unit: 11 testes — 6 presets, safe area dos 2 layouts, wrap/overflow de labels, ASS com A/B/prompt/rodapé, escape e movimento reduzido, janela inválida, consequência multilinha vs label sem newline, hash de escolhas/config (incluindo consequência), WAV determinístico/volume, plano com CTA conflitante, overflow e fim real.
- Render/composição: 4 testes — filtro ASS do card após legendas, mute de narração na janela, mux de narração sem SFX e burn-in FFmpeg sobre frame verde com checagem de cobertura/luma/acentos + SFX.
- Actions: 4 testes — geração sequencial de 2 layouts, preset inválido, anexo ao plano no fim do episódio e conflito stale.
- PgTAP 210: owner read, escrita direta negada, segundo owner isolado, RPC versionada, poda preservando APPROVED, quota 200 exercitada, episódio sem escolhas e episódio publicado bloqueados.
- E2E: entra pela nav “Final A/B”, cria episódio e duas escolhas, gera split+stacked, aprova, baixa ASS/JSON/WAV, confere `finale/end-card.ass` no ZIP, nega anônimo, altera só a consequência pelo RPC V1 (stale/409) e depois o label, screenshots 360/768/1440.
- Policy: 33 invariantes / 31 tabelas; backup/restore incluem `choice_end_cards`.

## Riscos e residuais

- Sem golden image cross-host; fonte DejaVu do ambiente e wrap heurístico.
- Sem prévia pixel do ASS na UI; a simulação DOM pode divergir do MP4 em detalhes de kerning.
- Anexo à timeline exige plano com cenas/vídeos; E2E cobre o action, não o anexo em MP4 completo nesta WO.
- `reducedMotion` remove fades, mas o layout estático ainda pode ter contraste alto; revisão visual permanece.
- Sem UI de poda; retenção service-only.
- Sem edição de labels do card; mudanças de escolha exigem novo card.
- SFX é local/determinístico, não uma biblioteca de som licenciada.
- Nenhuma coleta/predição de votos, publicação ou agendamento.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização contínua do owner antes de merge/promoção. **Sem deploy nesta etapa.**
