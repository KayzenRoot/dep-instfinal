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
- `config` efetivo e `sources` por campo;
- `scenes[]` com o config efetivo de cada cena que possui override, incluindo `sources` (`SCENE`);
- `warnings` (`STYLE_PRESET_MISSING`, `STYLE_SFX_UNAVAILABLE`, `STYLE_SFX_LICENSE`);
- `capturedAt` em UTC.

SFX são auditados no momento da resolução. Referências removidas ou sem licença comercial/social são retiradas do config congelado e geram warning legível, sem bloquear o render.

O plano de edição grava `styleBible` no momento do save (`attachStyleSnapshot`). O snapshot entra no hash canônico do plano, portanto renders/exports antigos não mudam quando o preset recebe nova revisão. O timeline compara o snapshot com a resolução atual (`styleSnapshotDrift`) e avisa quando o estilo mudou; salvar o plano aplica o estilo atual como nova versão (opt-in explícito). Se o plano ainda não tem color grade, a cor do estilo é injetada; um color grade explícito do plano é preservado.

## UI e API

- `/app/style`: seletor de escopo, editor completo, prévia efetiva com paleta/tipografia/fatos aprovados (cor, SFX, voz, abertura, capa, final A/B, CTA), tabela de origem por campo, revisões com aprovar/restaurar, importar, duplicar e exportar.
- Overrides de episódio e cena com formulários esparsos (“vazio = herdar”), seleção de cena e lista de cenas congeladas no snapshot.
- `/api/style/[presetId]`: JSON `dif-studio-style-preset/v1`, owner-only, `private, no-store`, sem binários/URLs/segredos; download opcional.
- Item “Estilo” na navegação do workspace.

## Testes e provas

| Suíte                                | Resultado                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/domain `style-bible.test.ts`    | 9 testes: precedência, todos os 19 campos com cena vencendo, hash determinístico, import/export, schema estrito, cenas congeladas, drift, fallback de SFX |
| Unit/actions `style-actions.test.ts` | 6 testes: save, override esparso, SFX explícito vazio, aprovação com concorrência, JSON inválido, conflito 409                                            |
| Unit/plan `video-edit-plans.test.ts` | 2 testes: snapshot no plano + injeção de cor, neutro/color explícito preservados                                                                          |
| PgTAP `rls_and_integrity.sql`        | **242/242** — RLS das 4 tabelas, revisão imutável, conflito, escopo inválido, leitura por owner, escrita direta negada, quota 200                         |
| Policy audit                         | **35 invariantes / 41 tabelas**                                                                                                                           |
| E2E `style.spec.ts`                  | 2 séries com estilos distintos, sem contaminação; override de episódio/cena; export sem segredos; import DRAFT-only; screenshots 360/768/1440             |
| Build/typecheck/lint                 | `npm run build`, `npm run check`, `npm run lint` PASS                                                                                                     |
| Suíte unit/integração completa       | **335 passed + 3 skipped**                                                                                                                                |

## Matriz de aceitação

| AC                                                                          | Estado                 | Evidência                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Duas séries com estilos radicalmente distintos, sem interferência           | PASS local             | E2E: Alfa (mono/horror/vermelho/CTA A) × Beta (serif/clean/verde/CTA B); previews e origem por campo divergem |
| Precedência correta; override de legenda da cena não muda preset da série   | PASS                   | Unit (todos os campos) + E2E (override de cena, export da série mantém `horror`/`tiktok`)                     |
| Novo preset não muda renders/exports antigos; aplicar exige opt-in          | PASS por desenho/teste | `styleBible` congelado no plano/hash; timeline sinaliza drift; salvar plano cria nova versão                  |
| Export/import preserva referências válidas sem secrets/URLs; erro legível   | PASS                   | Zod estrito, export owner-only, auditoria de SFX, PgTAP licença/asset, E2E sem `http`/segredos                |
| Previews refletem cor/áudio/capa/CTA aprovados; retenção/cotas documentadas | PASS                   | Fatos no `/app/style`, warnings de asset, quota 200 e retenção documentadas                                   |

## Limites conhecidos (residuais)

- O pipeline de render atual consome o snapshot congelado e o color grade injetado; tipografia/legenda/SFX ficam registrados no snapshot como referências reprodutíveis para a evolução do renderizador, sem alterar jobs READY nem planos antigos.
- O override de cena entra no snapshot com precedência e origem, mas ainda não altera um MP4 já renderizado; a aplicação ocorre em novos planos/renderizações.
- Import/export cobre `schemaVersion: 1`; versões futuras devem ser rejeitadas e migradas explicitamente.
- Sem backfill de presets para séries existentes; a criação é manual e nenhum dado V1/cânone é migrado sem aceite.
