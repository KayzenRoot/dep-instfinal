# DIF-V2-WO-018 — Capas, posters e cards

**Status:** implementação completa em `feat/dif-v2-wo-018`; unit/render/action, PgTAP, policy, build e E2E em validação; CI e auditoria independente **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
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

## Capacidade real versus planejada

- Frames vêm de `media_assets` READY (REFERENCE/FRAME) e dos vínculos `start_frame_asset_id`/`end_frame_asset_id`. Não há extração de frame do meio do vídeo na aplicação; isso exigiria worker/canvas e permanece futuro.
- Sem Cloudinary configurado ou sem frame, a capa usa o fundo do preset; a UI/E2E continuam funcionais. A renderização com frame privado é feita no servidor e o original não é alterado.
- A tipografia usa DejaVu/Arial do ambiente, sem distribuir fonte proprietária. Métricas de texto são heurísticas de largura; a prévia renderizada é a referência, não um medidor tipográfico humano.
- Não há publicação automática, previsão de viralidade, geração por IA ou custo por imagem; cada download re-renderiza a config.
- O ZIP baixa os três formatos com a mesma config; cada formato também pode ser baixado separadamente.
- Histórico é limitado a 500 revisões por episódio; poda administrativa não tem UI nesta WO.
- Não há golden image pixel-a-pixel entre sistemas/fontes; os testes verificam dimensões, formato, não-vazio, Unicode, escape e determinismo de config.

## Critérios de aceitação

| Critério | Estado | Evidência |
| --- | --- | --- |
| Episódio Flow real/sintético: escolher frame e obter ≥3 estilos com identidade de série | PASS parcial | 4 presets; E2E gera 3 estilos sem frame; render com frame coberto por integração Sharp |
| Downloads 9:16, 3:4, 4:5 e prévias de corte; texto/logo legíveis nas safe zones | PASS | render testa os 3 formatos; layout seguro; ZIP 3 formatos; E2E confere 1080×1350 e download |
| Editar título/preset/foco atualiza capa sem mudar frames/cânone; versões recuperáveis | PASS | config versionada, aprovar/restaurar, foco/crop; nenhuma escrita em cenas/cânone |
| Anon/non-owner não acessam frame/capa; export segue licença | PASS | rota owner-only, RLS, PgTAP, sem URLs permanentes |
| Custo zero por geração de imagem | PASS | render local Sharp sobre assets existentes; sem API paga/GPU |

## Testes planejados/executados

- Unit: 4 presets distintos, dimensões/safe zones, wrap Unicode/ellipsis, escape XML, hash determinístico, nome de arquivo seguro.
- Render: 12 combinações formato × preset, composição sobre frame, foco, JPEG, título longo com acentos/emoji.
- Actions: geração de 3 templates com revisão otimista, configuração inválida, approve/restore e redirects.
- PgTAP: owner read, escrita direta negada, segundo owner isolado, RPC versionada e quota.
- E2E: criar episódio sintético, gerar 3 capas, aprovar, prévia PNG 4:5, download JPEG e ZIP, responsivo 360.
- Policy: 32 invariantes / 30 tabelas; backup/restore atualizados.

## Riscos e residuais

- Sem extração de frame do meio do vídeo; somente frames já vinculados/READY.
- Fonte depende do ambiente (DejaVu/Arial); render pode variar entre sistemas sem golden pixel.
- Texto é heurístico (largura por caracteres), não medição tipográfica real; títulos longos truncam.
- Render on demand consome CPU a cada prévia/download; sem cache persistente.
- Histórico de 500 revisões sem poda na UI; operação service-only.
- Sem prévia de crop interativa por arraste; foco é controlado por ranges.
- Nenhuma publicação, agendamento ou análise de performance social.
- E2E usa fundo de preset (sem Cloudinary); composição com frame real é validada em integração Sharp, não E2E.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização contínua do owner antes de merge/promoção. **Sem deploy nesta etapa.**
