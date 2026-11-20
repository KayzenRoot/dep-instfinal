# DIF-V2-WO-020 — Laboratório de retenção e métricas manuais

**Status:** implementação em `feat/dif-v2-wo-020`; CI `44689704303` PASS em `474ebc8` (318+3 unit, PgTAP 229/229, E2E 18/18, Sonar PASS), policy 34/37; auditoria delta final **PENDENTE**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `59ec14c` (checkpoint WO-019 promovido).
**Escopo:** WO-020 (#37), dependente de WO-012/015/018/019 e do fluxo manual V1.

## Entregue

- Modelo privado owner-only: `published_posts`, `published_post_versions`, `creative_variants`, `analytics_snapshots`, `retention_imports` e `retention_experiments`.
- Posts com plataforma, URL validada (texto, nunca fetched), data de publicação e vínculo opcional a hook/capa/final aprovados do mesmo episódio.
- Snapshots append-only com revisão, `snapshot_hash`, `supersedes_snapshot_id`, origem MANUAL/CSV, período e métricas agregadas nuláveis (ausente ≠ zero).
- Fórmulas versionadas com numerador/denominador explícitos: engajamento por views, conclusão, watch time relativo e interações por 1000 views.
- Comparação A/B somente com mesma plataforma, janelas equivalentes e amostra ≥1000 views; caso contrário `NOT_COMPARABLE`/`INSUFFICIENT`. Texto sempre “observado/associação”, nunca causalidade.
- Import CSV com validação por linha, campos vazios → NULL, idempotência por hash, limites de tamanho e erros por linha.
- `/app/retention`: cadastro de posts/variantes, snapshots manuais, importação CSV, dashboard com origem/denominador, experimentos A/B observacionais, export CSV/JSON e remoção owner-only.
- Export CSV com proteção de fórmula (`= + - @`) e JSON com definições/versão; nada de dados de espectadores.
- Backup/restore e policy incluem as seis tabelas; 37 tabelas e 34 invariantes.

## Capacidade real versus planejada

- Nenhuma API social, scraping, login automatizado, leitura de dashboard ou coleta de comentários; todos os números são fornecidos manualmente/CSV.
- Métricas são agregadas; não há dados por espectador, segmentação de público ou atribuição de tráfego.
- A comparação A/B é descritiva: não estima significância, não controla confundidores e não prevê viralidade.
- O período é comparável quando mesma plataforma, duração da janela ±20% e views ≥1000 nas duas variantes; janelas diferentes geram aviso.
- Histórico de post é versionado; snapshots nunca são sobrescritos (retificação cria nova revisão com `supersedes`).
- Export CSV/JSON é owner-only; remoção apaga post, versões, variantes, snapshots e experimentos vinculados.

## Critérios de aceitação

| Critério                                                                                        | Estado | Evidência                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 2 vídeos/fixtures, plataformas distintas, períodos e A/B; dashboard mostra origem e denominador | PASS   | E2E cria TikTok+Reels com snapshots, A/C TikTok para A/B, CSV, comparação observacional e cross-platform NOT_COMPARABLE |
| Métrica ausente não vira zero/conclusão; períodos distintos mostram incomparabilidade           | PASS   | NULL/partial → warnings/`INSUFFICIENT`; CSV sem interações INDISPONÍVEL; cross-platform alerta                          |
| Gráficos/resumo factual sem “viral”, “garantia” ou ranking especulativo                         | PASS   | barras SVG de views/engajamento, histórico por post, comparação observacional; teste proíbe termos                      |
| Entrada repetida idempotente com histórico; edição não sobrescreve evidência                    | PASS   | hash único, revisão append-only, duração/métrica pinadas, `supersedes` e histórico na UI                                |
| Export/exclusão sem vazar dados owner ou de usuários                                            | PASS   | rotas owner-only, export agregado, delete RPC; E2E anônimo 401 e remoção                                                |

## Correções pós-auditoria independente

- **Interações parciais:** `PARTIAL_INTERACTIONS` é emitido e a comparação com cobertura de campos diferente retorna `INSUFFICIENT`/`INTERACTION_COVERAGE_MISMATCH`; NULL nunca vira zero.
- **Limites por owner:** variantes e snapshots são buscados com `.in('post_id', postIds)` depois dos posts, sem limite global que esconda o episódio.
- **Números estritos:** formulário e CSV rejeitam `1.000`, `1,5`, `1.234,5` e texto; apenas dígitos (e ponto decimal na conclusão). Erro por linha é exibido.
- **CSV injection:** células perigosas são citadas e cada linha recebe apóstrofo; vírgulas/quebras não criam registros sem escape.
- **Snapshot/experimento pinados:** `episode_duration_ms` e `metric_version` ficam no snapshot; experimentos guardam os snapshots A/B usados e rejeitam variantes do mesmo post.
- **Histórico/gráficos:** dashboard tem barras SVG de views/engajamento, histórico por post com revisões/supersedes e select de retificação; A/B mostra variante, post, views e unidade.
- **Resiliência:** snapshot histórico inválido gera warning e não derruba a página/export; conflito de revisão concorrente usa advisory lock e 409, não falso duplicado.

## Testes planejados/executados

- Unit: 11 testes — fórmulas com NULL/zero/amostra baixa/discrepância, interações parciais vs completas, watch =105% rejeitado, comparabilidade por plataforma/período/amostra/métrica, linguagem não causal, CSV quoted/CRLF, linha malformada, número ambíguo, injeção de fórmula com vírgula/newline.
- PgTAP 229: RLS owner/nonowner, escrita direta negada, post/versão, variante A/B em posts distintos, snapshot idempotente com duração pinada e supersedes, imutabilidade, experimento, delete em cascata.
- E2E: login/nav, cria posts TikTok+Reels, variantes, snapshots, experimento observacional, CSV com NULL, export CSV/JSON, anônimo negado, remoção e screenshots 360/768/1440.
- Policy: 34 invariantes / 37 tabelas; backup/restore incluem as tabelas de retenção.

## Riscos e residuais

- Sem APIs oficiais, scraping ou coleta automática; dados podem ser incompletos ou enviesados pelo owner.
- Sem significância estatística, controle de confundidores ou atribuição de tráfego; comparação é descritiva.
- Sem dados por espectador, demografia ou comentários; somente agregados fornecidos.
- CSV não valida duplicidade de URL entre episódios diferentes (a chave é por owner+episódio+plataforma+URL).
- Sem UI de edição de post/variante; correções de post criam versão, variantes são imutáveis.
- Sem poda de snapshots/imports; limites de 5000 snapshots/post e 5000 linhas/CSV.
- Gráficos são barras SVG simples por último snapshot, não séries temporais completas; histórico aparece em lista por post.
- Export CSV inclui o último snapshot por post; JSON inclui todas as revisões e imports. Não há export de `published_post_versions`.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização contínua do owner antes de merge/promoção. **Sem deploy nesta etapa.**
