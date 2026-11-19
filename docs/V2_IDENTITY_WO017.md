# DIF-V2-WO-017 — Continuidade visual e Character Identity Kit

**Status:** implementação completa em `feat/dif-v2-wo-017`; unit/action, PgTAP, policy, E2E local e build em validação; CI e auditoria independente **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `174e045` (checkpoint WO-016 promovido).
**Escopo:** WO-017 (#34) + adendo ENH-16; depende de WO-001/003/004/011/016.

## Entregue

### Character Identity Kit (pré-Flow)

- `CharacterIdentityProfile` vinculado ao personagem canônico existente (`characters`), sem segundo cadastro e sem alterar `visual_description`, lore ou cânone.
- Campos: aliases, cabelo, figurino, silhueta, marcas, acessórios, paleta, iluminação, itens imutáveis/mutáveis, negative prompts, referências READY owner-only, foto-chave, looks com intervalo de episódios, override manual de âncora e notas.
- Versão atual + histórico imutável (`character_identity_profiles` / `character_identity_profile_versions`), concorrência otimista (`expectedVersion`) e restauração como novo DRAFT.
- Domínio determinístico: `buildIdentityAnchor`, `buildContinuityChecklist`, `composeIdentityPrompt`, seleção de look por episódio, hash canônico e matching conservador por nome/alias em notas de cena.
- `/app/identity`: seletor de série/personagem/episódio, editor do perfil, referências privadas, preview da âncora/checklist e prompts por cena sem sobrescrever os prompts existentes.
- Export: `/api/identity/[characterId]/export?format=json|md` e arquivos `identity/character-anchors.json`, `identity/continuity-checklist.md` e `identity/scene-anchors.json` no ZIP Flow; apenas IDs e instruções, nunca URL assinada permanente.

### Inspetor de continuidade visual (pós-Flow)

- `VisualContinuityReport` versionado/append-only com observações, frames amostrados, método, confiança, status e decisão do owner.
- Regras determinísticas:
  - frame ausente quando a cena não tem frame inicial/final vinculado;
  - `FIGURINO`/`VESTUARIO`/`CABELO`/`WARDROBE`/`HAIR` nas notas vs perfil/look;
  - mudança de `LOCAL`/`LOCATION` e `TEMPO`/`TIME` entre cenas adjacentes;
  - diferença de luma/saturação entre frames adjacentes (método `PIXEL_STATS`, confiança LOW/MEDIUM).
- Frames privados são baixados no servidor via Cloudinary autenticado, reduzidos a RGB e nunca expostos por URL permanente; o navegador usa `/api/media/[assetId]` owner-only.
- `/app/continuity/visual`: seletor de episódio, resumo, frames lado a lado, observações com esperado/observado/método/confiança, decisões (aceitar, exceção, revisar, bloqueante, resolvido), regeneração manual no Flow e histórico.
- Decisões são persistidas em nova revisão; a regeneração reaplica decisões por id determinístico. Nenhuma decisão altera cena, cânone, lore ou vídeo.
- Export Flow bloqueia **somente** quando a última revisão tem observação `BLOCKING`; sem relatório, adiciona warning e não bloqueia.
- Relatório exportável em JSON/Markdown por rota owner-only.

## Modelo de dados e segurança

- `character_identity_profiles` (atual) + `character_identity_profile_versions` (histórico imutável).
- `visual_continuity_reports` (revisões imutáveis com `status`, `blocking_count`, `report_hash` e `supersedes_report_id`).
- RLS owner-read/service-write, claim `dif_studio_owner`, `FORCE ROW LEVEL SECURITY`, revoke de `authenticated` para escrita; RPCs `security definer` executáveis apenas por `service_role`.
- `expectedVersion` no perfil e `expected_revision` no relatório; conflitos retornam 409.
- Hash canônico SHA-256 verificado na leitura de perfis e relatórios.
- Backup/restore e manifesto de backup incluem as três tabelas; grants de leitura ao `service_role` para as tabelas legadas de metadados.
- Nenhuma migração altera dados existentes, exceto a constraint aditiva `characters(owner_id, series_id, id)` usada pela FK.

## Correções pós-auditoria independente

- **Persistência/hash:** `continuityFrameStatsSchema` agora inclui `frameCount`; stats são arredondados a 3 casas antes do hash; o servidor valida `visualContinuityReportSchema` antes de salvar e de decidir. Um teste de roundtrip com stats não nulos prova parse + hash iguais.
- **Limites:** o builder limita observações a 200 (preservando BLOCKING/NEEDS_REVIEW primeiro), frames a 120, perfis a 60 e limitações a 10, com limitação explícita; relatórios acima do schema não são mais gravados.
- **Decisão bloqueante:** merge por `sceneId/entityType/attribute/characterId` quando o id muda por edição da nota, evitando liberar o export por mudança textual.
- **Referências:** ativos já vinculados são carregados além dos 80 recentes; indisponíveis aparecem com aviso e não são removidos silenciosamente. Servidor aceita apenas REFERENCE/FRAME READY; restore histórico não revalida bytes.
- **Frescor:** export calcula `CONTINUITY_REPORT_STALE` quando a revisão do episódio ou `scenes.updated_at` é posterior ao relatório; é warning, não bloqueio.
- **Retenção/quota:** 500 revisões por episódio/perfil e RPCs service-only para podar histórico mantendo as mais recentes; o trigger de imutabilidade só permite poda com setting interno.
- **Orçamento de frames:** amostragem limitada por `CONTINUITY_SAMPLING_BUDGET_MS` (default 60 s) e timeout de 15 s por imagem.
- **UX/evidência:** status vazio não vira ACCEPTED; export avisa `IDENTITY_PROFILES_DRAFT`/`CONTINUITY_VISUAL_EMPTY`; thumbnails lazy e links JSON/Markdown; testes de 240→200 observações, cap de 10 limitações, roundtrip e decisões após mudança de nota (só BLOCKING é transportado por chave; ACCEPTED/EXCEPTION/RESOLVED de evidência diferente voltam a NEEDS_REVIEW).

## Capacidade real versus planejada

- A inspeção usa **frames já vinculados** (`start_frame_asset_id`/`end_frame_asset_id`). Não há extração de frame do meio do vídeo na aplicação: isso exigiria canvas no navegador ou o worker FFmpeg, fora deste incremento.
- O matching de personagem é textual e conservador (nome/alias exato nas notas). Não há reconhecimento facial, de figurino ou semântico.
- Estatísticas de pixel são sugestões de iluminação, não julgamento de continuidade; cortes, color grade e mudanças intencionais podem gerar falsos positivos e devem ser marcados como exceção.
- Nenhum modelo multimodal pago, GPU, scraping ou automação do Flow é usado. O fluxo continua utilizável sem Cloudinary para metadados (frames ficam sem amostragem e entram como limitação).
- A integração com o Storyboard Inspector WO-024 é futura; o domínio e os artefatos de identidade já são reutilizáveis.
- Não há geração automática de relatório por render; o owner gera a revisão no inspetor.

## Critérios de aceitação

| Critério                                                                            | Estado       | Evidência                                                                   |
| ----------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| Figurino contraditório gera alerta rastreável e decisão do owner                    | PASS         | domain test nota vs perfil/look; E2E registra decisão e histórico           |
| Quadros e notas lado a lado sem vazamento de mídia                                  | PASS parcial | UI e `/api/media` owner-only; apenas frames vinculados são amostrados       |
| Iluminação aparece como sugestão não conclusiva e admite exceção                    | PASS         | regra `PIXEL_STATS` + teste de exceção intencional                          |
| Nenhum alerta altera lore/cânone/vídeo; revisão versionada no relatório             | PASS         | tabela append-only, RLS, testes PgTAP, nenhuma escrita em cenas/cânone      |
| Fluxo utilizável sem modelo multimodal pago                                         | PASS         | apenas metadados, pixels e revisão humana                                   |
| 2 personagens e 4 cenas geram prompts distintos com anchor estável                  | PASS         | domain test com 2 perfis/4 cenas; anchor por episódio e look                |
| Mudança de figurino autorizada não gera erro permanente                             | PASS         | look com intervalo; decisão `EXCEPTION`; restore DRAFT                      |
| Owner edita/rejeita âncora e restaura versão sem alterar cânone                     | PASS         | override, DRAFT/APPROVED, restore append-only; E2E                          |
| Export inclui nomes/aliases, referências owner-only e instruções sem URL permanente | PASS         | E2E JSON/ZIP verifica anchors/checklist/report                              |
| Alertas pós-Flow têm evidência, admitem desconhecido e revisão humana               | PASS         | método/confiança observáveis, `NEEDS_REVIEW`, decisão com justificativa     |
| Relatório persistido é sempre legível e com hash verificável                        | PASS         | schema com `frameCount`, stats arredondados, parse antes do save, roundtrip |

## Testes planejados/executados

- Unit: perfis/anchors/looks/aliases/UTF-8/homônimos/sem imagem, matching 2×4, composição de prompt; relatório com contradição, frame ausente, luz, locação/tempo, merge de decisões, bloqueio explícito, roundtrip de stats, limites 200/201 e Markdown sem URLs.
- Actions: parsing do perfil, referências/foto-chave, DRAFT/approve/restore, redirect 303 e mapeamento 409; gerar/decidir relatório, regeneração e erros.
- PgTAP 183: RLS owner-read, escrita direta negada, isolamento de segundo owner, conflito de versão/revisão, histórico imutável, EXECUTE negado a authenticated, quota/retenção e relatório bloqueante.
- E2E: perfil salvo/aprovado/restaurado, export JSON, relatório gerado, decisão BLOCKING bloqueia ZIP, RESOLVED libera ZIP e inclui identity/continuity no pacote.
- Policy: 31 invariantes / 29 tabelas; backup/restore atualizados.

## Riscos e residuais

- Sem extração de frame do meio do clipe; cenas sem frames vinculados só geram `FRAME_MISSING`.
- Matching por nome/alias não cobre pronomes, descrições indiretas ou homônimos na mesma série.
- Estatísticas de pixel são grosseiras e não detectam figurino/objeto; iluminação intencional exige exceção.
- Não há associação cena↔personagem persistida; a correspondência é derivada das notas e revisável.
- Relatórios são gerados sob demanda; não há job automático nem comparação entre séries.
- Referências ficam no JSON do perfil (IDs de `media_assets`), não em `image_references`; a biblioteca existente continua sendo a fonte dos bytes. Ativos indisponíveis aparecem marcados e o restore histórico não revalida bytes.
- A âncora manual é texto livre; revisão humana e hash do perfil são a garantia de rastreabilidade.
- Frames privados dependem de Cloudinary configurado; falha de amostragem vira limitação, não bloqueio.
- WO-024 (storyboard pré-Flow) e extração no worker permanecem para WOs futuras.
- Export ZIP inclui perfis DRAFT com warning; a UI explicita o status. O export standalone JSON/MD inclui o status, mas não um warning separado.
- Relatórios antigos podem ser podados por RPC service-only; o latest preserva decisões. Uma revisão latest legada acima dos limites do schema (se existir) precisaria de remediação administrativa.
- A poda usa um GUC de sessão permitido apenas ao service_role; a imutabilidade deixa de ser absoluta para esse role confiável.
- O gate de frescor é warning, não bloqueio; um relatório desatualizado ainda libera o ZIP se não tiver BLOCKING. Revisão nula vs. atual e mudanças de perfil/bytes de mídia podem não ser sinalizadas.
- Quotas de 500 revisões retornam 409 com mensagem operacional, mas a poda não tem UI; é um runbook service-only.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização contínua do owner antes de merge/promoção. **Sem deploy nesta etapa.**
