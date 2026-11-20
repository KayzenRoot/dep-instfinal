# DIF-V2-WO-021 — Bíblia audiovisual, presets e herança

**Issue:** #38 · **Branch:** `feat/dif-v2-wo-021` · **Base:** `main` `2fcfd89`
**Status:** implementação concluída localmente; PR Draft/CI/auditoria independente pendentes. Sem deploy e sem promoção de checkpoint.

## Objetivo entregue

Uma camada única de identidade audiovisual por série/temporada, com revisões versionadas, overrides owner-only por episódio e por cena, resolução de precedência campo a campo, export/import JSON allowlisted e snapshot congelado dentro do plano de edição.

## Modelo de dados

| Tabela                    | Papel                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| `style_presets`           | um preset por `(owner, scope_type, scope_id)`; escopos `SERIES`/`SEASON` |
| `style_preset_revisions`  | histórico imutável (`DRAFT`/`APPROVED`), hash SHA-256 versionado         |
| `episode_style_overrides` | override esparso por episódio, upsert com owner                          |
| `scene_style_overrides`   | override esparso por cena, upsert com owner                              |

- RLS forçada e leitura owner-only; escrita apenas via RPC `SECURITY DEFINER` concedida a `service_role`.
- `save_style_preset_revision` exige `expectedRevision` (concorrência otimista, `40001`) e valida que o escopo pertence ao owner.
- Revisões são imutáveis (`55000` em UPDATE/DELETE), com bypass restrito a prune interno via GUC.
- Quota: 200 revisões por preset (`style_revision_quota`); presets são pequenos e o histórico aprovado nunca é descartado.
- Nenhuma URL, fonte binária, comando, filtro FFmpeg, JS/CSS ou asset sem licença é aceito: o config é um objeto Zod estrito de enums, cores `#rrggbb`, IDs de template conhecidos e IDs de SFX owner-scoped.

## Precedência e snapshot

`resolveStyle` aplica, nesta ordem: `DEFAULT < SERIES < SEASON < EPISODE < SCENE`. Cada campo recebe a origem (`sources[field]`) e valores explícitos como `false`/`0` não são confundidos com ausência.

`resolveEpisodeStyleSnapshot` considera apenas presets **aprovados** nas camadas série/temporada, aplica o override do episódio e congela:

- `presetId`, `presetRevision`, `presetHash`, `scopeType`, `scopeId`;
- `config` efetivo, `sources` e `versions` por campo (revisão da camada que venceu; `null` para default/override sem revisão);
- `scenes[]` com o config efetivo de cada cena que possui override, incluindo `sources` (`SCENE`) e `versions`;
- `warnings` (`STYLE_PRESET_MISSING`, `STYLE_SFX_UNAVAILABLE`, `STYLE_SFX_LICENSE`);
- `capturedAt` em UTC.

SFX são auditados no momento da resolução. Referências removidas ou sem licença comercial/social são retiradas do config congelado e geram warning legível, sem bloquear o render.

O plano novo grava `styleBible` no primeiro save quando há estilo configurado (`attachStyleSnapshot`) e entra no hash canônico. Planos existentes **preservam** o snapshot ao salvar edições comuns; aplicar uma revisão nova exige marcar “Aplicar estilo atual” (ou reconstruir), criando uma nova versão. Planos legados sem snapshot não são alterados silenciosamente: o timeline sinaliza a ausência e só aplica com opt-in. A cor do estilo é injetada apenas nessa aplicação; um color grade explícito é preservado.

Legendas e tipografia são aplicadas no render/export a partir do snapshot congelado (`applyStyleToCaptionTrack` + `buildCaptionAss`): `horror` → tratamento VHS, `clean` → limpo, área segura e fonte da bíblia. O `/app/finale` usa `endCardTemplateId` e `ctaPrompt` como defaults de um novo card; `/app/covers` pré-seleciona `coverTemplateId` quando há estilo; o `/app/style` mostra um clipe-amostra sintético com legenda, CTA, áudio do primeiro SFX (quando licenciado), capa aprovada renderizada, dados do final aprovado e áudio da narração aprovada; badges permanecem para voz/SFX. Voz e SFX continuam referências validadas para as telas especializadas; não são inventados automaticamente em jobs existentes.

## UI e API

- `/app/style`: seletor de escopo, editor completo, clipe-amostra sintético com paleta/tipografia/legenda/CTA e fatos aprovados (cor, SFX, voz, abertura, capa, final A/B, CTA), tabela de origem/versão por campo, revisões com aprovar/restaurar, importar, duplicar e exportar.
- Overrides de episódio e cena com formulários esparsos (“vazio = herdar”), `reducedMotion` tri-state (herdar/true/false), limpeza real via RPC quando todos os campos ficam vazios, seleção de cena e lista de cenas congeladas no snapshot.
- `/api/style/[presetId]`: JSON `dif-studio-style-preset/v1`, owner-only, `private, no-store`, sem binários/URLs/segredos; download opcional.
- Item “Estilo” na navegação do workspace.

## Testes e provas

| Suíte                                | Resultado                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/domain `style-bible.test.ts`    | 9 testes: precedência/versões, todos os 19 campos com cena vencendo, hash determinístico, import/export estrito, cenas congeladas, drift, fallback de SFX     |
| Unit/actions `style-actions.test.ts` | 8 testes: save, override esparso, limpeza vazia, `reducedMotion=false`, SFX explícito, aprovação da revisão clicada, JSON inválido, conflito 409              |
| Unit/plan `video-edit-plans.test.ts` | 3 testes: opt-in explícito, snapshot no plano + injeção de cor, neutro/color explícito preservados                                                            |
| Unit/caption `style-caption.test.ts` | 3 testes: mapeamento horror→VHS, área segura e fonte no ASS; legado sem snapshot intacto                                                                      |
| Unit/licença `style-bible.test.ts`   | 2 testes: asset ausente e sem licença comercial/social antes de qualquer escrita                                                                              |
| PgTAP `rls_and_integrity.sql`        | **247/247** — RLS das 4 tabelas, revisão imutável, conflito, escopo inválido, leitura por owner, escrita direta negada, quota 200, clear owner-only           |
| Policy audit                         | **35 invariantes / 41 tabelas**                                                                                                                               |
| E2E `style.spec.ts`                  | 2 séries com estilos distintos, sem contaminação; override de episódio/cena; export sem segredos; import DRAFT-only; títulos longos; screenshots 360/768/1440 |
| Build/typecheck/lint                 | `npm run build`, `npm run check`, `npm run lint` PASS                                                                                                         |
| Suíte unit/integração completa       | **350 passed + 3 skipped**                                                                                                                                    |

## Matriz de aceitação

| AC                                                                          | Estado            | Evidência                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duas séries com estilos radicalmente distintos, sem interferência           | PASS local        | E2E: Alfa (mono/horror/vermelho/CTA A) × Beta (serif/clean/verde/CTA B); previews e origem por campo divergem                                                                                                         |
| Precedência correta; override de legenda da cena não muda preset da série   | PASS              | Unit (todos os campos) + E2E (override de cena, export da série mantém `horror`/`tiktok`)                                                                                                                             |
| Novo preset não muda renders/exports antigos; aplicar exige opt-in          | PASS com residual | Snapshot/hash congelados; edições preservam o snapshot; “Aplicar estilo atual”/rebuild é o opt-in; helper testado. Falta E2E de versão antiga renderizada.                                                            |
| Export/import preserva referências válidas sem secrets/URLs; erro legível   | PASS              | Envelope e config Zod estritos, export owner-only, unidade de asset ausente/sem licença, E2E sem `http`/segredos                                                                                                      |
| Previews refletem cor/áudio/capa/CTA aprovados; retenção/cotas documentadas | PASS com residual | Clipe-amostra sintético, áudio do SFX licenciado, capa aprovada via API, final aprovado, legenda/fonte no render e final usando CTA/template; voz tem áudio aprovado quando existe take READY. Quota 200 documentada. |

## Limites conhecidos (residuais)

- O render consome cor, estilo de legenda, área segura e fonte do snapshot; SFX, voz e templates de capa/final permanecem referências validadas para as telas especializadas e não são auto-injetados em planos existentes.
- O override de cena entra no snapshot com precedência, origem e versão, mas a aplicação por cena no MP4 depende de a cena estar no plano/render novo; planos já renderizados não mudam.
- A amostra do `/app/style` é sintética (CSS), não um frame real do episódio; a prova visual final é o MP4 renderizado.
- Backup/restore das novas tabelas está incluído nos scripts, mas não foi executado neste ciclo.
- Import/export cobre `schemaVersion: 1`; versões futuras devem ser rejeitadas e migradas explicitamente.
- Sem backfill de presets para séries existentes; a criação é manual e nenhum dado V1/cânone é migrado sem aceite.
