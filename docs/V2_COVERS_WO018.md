# DIF-V2-WO-018 — Capas, posters e cards

**Status:** **PROMOTED**; CI `44639723116` PASS no code head `f0acc7b` (287+3 unit, PgTAP 196/196, E2E 16/16, Sonar PASS); auditoria independente final **APPROVED WITH RESIDUALS**; squash-merged em `62c30eb` (PR #65); issue #35 fechada. Sem deploy nesta WO.
**Base:** `main` `2617b67` (checkpoint WO-017 promovido).
**Escopo:** WO-018 (#35), dependente de WO-003/004/011/012/016.

## Entregue

- `CoverConfig` versionado: template, versão, formato, frame privado, título, subtítulo, selo, série, foco X/Y e watermark.
- `cover_revisions` append-only com revisão por episódio, config/hash, status DRAFT/APPROVED, quota de 500 e histórico restaurável como novo DRAFT; RLS owner-read/service-write e RPC service-only.
- Quatro presets determinísticos: `noir`, `vhs_polaroid`, `archive` e `cctv`, com tratamento de cor, overlay, tipografia e selo próprios.
- Formatos 9:16 (1080×1920), 3:4 (1080×1440) e 4:5 (1080×1350), margens seguras, título limitado a três linhas com ellipsis e recorte central 4:5 para o grid.
- Render Sharp sob demanda: crop por foco, tratamento do preset, SVG de título/selo/série/watermark e saída PNG/JPEG. Nenhum byte gerado é persistido; a config é a fonte de verdade.
- `/app/covers`: seleção de episódio, frame privado opcional, presets, formato, foco, watermark, geração de 3+ estilos, prévias owner-only, aprovação, restauração DRAFT e downloads PNG/JPEG/ZIP com os três formatos.
- Rota `/api/covers/[revisionId]`: owner-only, `private, no-store`, render on demand, download separado e ZIP; nunca expõe URL permanente.
- Link no caderno do episódio; backup/restore e policy incluem `cover_revisions`.

## Correções pós-auditoria independente

- **Descoberta/consumo:** “Capas” entrou na navegação; o episódio consulta a última capa APPROVED e mostra a prévia com link para o estúdio. A aprovação deixa de ser estado sem consumidor.
- **Safe zones/contraste:** título/selo/série/watermark usam margens conservadoras por formato, incluindo a faixa de UI do TikTok/Reels; scrim, stroke e `textLength` evitam texto claro sobre frame claro e cortes de glifos largos; selo/série são truncados.
- **Tamanho de resposta:** PNG/JPEG/ZIP são medidos contra 4 MB e retornam 413 com instrução de JPEG/formato individual; preview usa escala 0.35 (378×672), reduzindo CPU/resposta.
- **Frame indisponível:** config com frame vinculado mas source ausente retorna 409 em vez de cair silenciosamente no fundo do preset; erro de Sharp vira 502 seguro.
- **EXIF:** dimensões são trocadas para orientations 5–8 antes do crop; teste com orientation 6.
- **Hash/retenção:** hash inclui parâmetros do template e versão do renderer; RPC service-only `prune_cover_revisions` mantém as revisões mais recentes e é testada no PgTAP.
- **Evidência:** E2E navega pela UI, verifica acesso anônimo negado, capa aprovada no episódio com `naturalWidth > 0` e screenshots em 360/768/1440; testes de safe zone/scrim, contraste real, frame corrompido, fonte transparente e EXIF adicionados.
- **Rodada final:** série movida para abaixo do selo e dentro do crop 4:5; subtítulo entrega duas linhas; PNG achata transparência em preto; `hash_version` lida e validada com hasher versionado; quota de 500 revisões exercitada no PgTAP; render determinístico (bytes idênticos) testado.

## Capacidade real versus planejada

- Frames vêm de `media_assets` READY (REFERENCE/FRAME) e dos vínculos `start_frame_asset_id`/`end_frame_asset_id`. Não há extração de frame do meio do vídeo na aplicação; isso exigiria worker/canvas e permanece futuro.
- Sem Cloudinary configurado ou sem frame, a capa usa o fundo do preset; a UI/E2E continuam funcionais. A renderização com frame privado é feita no servidor e o original não é alterado.
- A tipografia usa DejaVu/Arial do ambiente, sem distribuir fonte proprietária. Métricas de texto são heurísticas de largura; a prévia renderizada é a referência, não um medidor tipográfico humano.
- Não há publicação automática, previsão de viralidade, geração por IA ou custo por imagem; cada download re-renderiza a config.
- O ZIP baixa os três formatos com a mesma config; cada formato também pode ser baixado separadamente.
- Histórico é limitado a 500 revisões por episódio; poda administrativa não tem UI nesta WO.
- Não há golden image pixel-a-pixel entre sistemas/fontes; os testes verificam dimensões, formato, não-vazio, Unicode, escape e determinismo de config.

## Critérios de aceitação

| Critério                                                                                | Estado        | Evidência                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Episódio Flow real/sintético: escolher frame e obter ≥3 estilos com identidade de série | PASS parcial  | 4 presets; E2E gera 3 estilos sem frame; render com frame coberto por integração Sharp                                |
| Downloads 9:16, 3:4, 4:5 e prévias de corte; texto/logo legíveis nas safe zones         | PASS residual | render testa os 3 formatos; título/selo/série dentro do crop; ZIP 3 formatos com fallback JPEG; E2E confere 1080×1350 |
| Editar título/preset/foco atualiza capa sem mudar frames/cânone; versões recuperáveis   | PASS          | config versionada, aprovar/restaurar, foco/crop, hash versionado; nenhuma escrita em cenas/cânone                     |
| Anon/non-owner não acessam frame/capa; export segue licença                             | PASS          | rota owner-only, RLS, PgTAP, sem URLs permanentes                                                                     |
| Custo zero por geração de imagem                                                        | PASS          | render local Sharp sobre assets existentes; sem API paga/GPU                                                          |

## Testes planejados/executados

- Unit: 5 testes — 4 presets, dimensões/safe zones de UI, wrap Unicode/ellipsis, `textLength`/scrim, subtítulo em duas linhas, escape XML, hash versionado e nome seguro.
- Render: 10 testes — 12 combinações formato × preset, frame/foco/JPEG, EXIF orientation 6, preview 378×672, limite de 4 MB, contraste real em frame branco, frame corrompido, fonte transparente, determinismo byte a byte e título longo Unicode.
- Actions: geração de 3 templates com revisão otimista, configuração inválida, approve/restore e redirects.
- PgTAP 196: owner read, escrita direta negada, segundo owner isolado, RPC versionada, poda preservando APPROVED e quota de 500 exercitada (501ª revisão bloqueada).
- E2E: entrar pela nav, criar episódio sintético, gerar/aprovar, prévia PNG 4:5, download JPEG/ZIP, acesso anônimo negado, capa aprovada no episódio com `naturalWidth > 0`, screenshots 360/768/1440.
- Policy: 32 invariantes / 30 tabelas; backup/restore atualizados.

## Riscos e residuais

- Sem extração de frame do meio do vídeo; somente frames já vinculados/READY.
- Fonte depende do ambiente (DejaVu/Arial); render pode variar entre sistemas sem golden pixel.
- Texto é heurístico (largura por caracteres), não medição tipográfica real; títulos longos truncam.
- Render on demand consome CPU a cada prévia/download; sem cache persistente.
- Histórico de 500 revisões com poda service-only; UI lista só as 30 mais recentes.
- Sem prévia de crop interativa por arraste; foco é controlado por ranges.
- Nenhuma publicação, agendamento ou análise de performance social.
- E2E usa fundo de preset (sem Cloudinary); composição com frame real é validada em integração Sharp, não E2E.
- Contraste é garantido por scrim/stroke e layout, mas não há golden image pixel-a-pixel entre sistemas/fontes; revisão visual permanece.
- Fonte do ambiente (DejaVu/Arial); hash usa `hash_version` gravada, mas só a versão 1 existe hoje; um bump visual deve adicionar hasher/renderer versionado.
- ZIP PNG de frame muito detalhado pode exceder 4 MB e cair para JPEG; o guard evita truncamento, mas reduz a resolução de formato.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização contínua do owner antes de merge/promoção. **Sem deploy nesta etapa.**
