# DIF Studio V2 — plano de execução e grafo de dependências (PROMOTED)

- **Work Order:** `DIF-V2-WO-001` · issue #18
- **Epic:** #17 · issues #18–#45
- **Base atual:** `main` `326c576` (após checkpoint WO-007); plano original em `13467ab009e0eaaee1be6ba2e35678228cfbdf32`.
- **Status:** **PROMOTED** — WO-001/002 **APPROVED/merged**; ADR-V2-002 **ACCEPTED**; WO-003/004/005 **APPROVED/merged** (`ac55d27`, `c6be101`, `dc405d8`); checkpoint V2 **PROMOTED**; WO-006 **APPROVED/merged** (`239f3ba`); WO-007 **APPROVED/merged** (`326c576`); WO-008 **NEXT**.
- **Fonte viva:** os corpos atuais das issues #18–#45 prevalecem sobre este plano.

## Inventário — 28 WOs e 20 melhorias

| WO     | Issue | Módulo                                                  | Risco    | Dependências explícitas / propostas                               | Estado                       |
| ------ | ----- | ------------------------------------------------------- | -------- | ----------------------------------------------------------------- | ---------------------------- |
| WO-001 | #18   | Gate V1 + Source Pack V2 + ADR PROPOSED + Context Lock  | ELEVATED | PR #16 encerrado (mergeado em `13467ab`)                          | APPROVED (merged)            |
| WO-002 | #19   | Benchmark FFmpeg/ARM64 e viabilidade US$ 0              | ELEVATED | WO-001 APPROVED + ADR aceita                                      | APPROVED (GO COND.)          |
| WO-003 | #20   | Ingestão segura de clipes e storage privado             | ELEVATED | WO-001; WO-002 GO; contrato de storage                            | COMPLETED (merged `ac55d27`) |
| WO-004 | #21   | Timeline canônica, alinhamento e versões                | ELEVATED | WO-001; WO-003                                                    | COMPLETED (merged `c6be101`) |
| WO-005 | #22   | Worker, fila, lease, retry, recuperação                 | ELEVATED | WO-001; WO-003; WO-004                                            | COMPLETED (merged `dc405d8`) |
| WO-006 | #23   | Composição FFmpeg, cortes, transições, VHS 9:16         | ELEVATED | WO-002; WO-004; WO-005                                            | COMPLETED (merged `239f3ba`) |
| WO-007 | #24   | Narração pt-BR, voz importada e TTS local opcional      | ELEVATED | WO-005; WO-006; adendo emoção                                     | COMPLETED (merged `326c576`) |
| WO-008 | #25   | Legendas reais, SRT/ASS e burn-in                       | STANDARD | WO-006; WO-007                                                    | NEXT                         |
| WO-009 | #26   | SFX/música licenciados, mix/ducking, soundscape estéreo | STANDARD | WO-006; WO-007; adendo soundscape                                 | PLANNED                      |
| WO-010 | #27   | Diretor de edição e curva de tensão                     | ELEVATED | WO-004; WO-025 (proposta); adendo tensão                          | PLANNED                      |
| WO-011 | #28   | Editor/preview e safe zones                             | ELEVATED | WO-006–009; adendo safe zones                                     | PLANNED                      |
| WO-012 | #29   | Export MP4 H.264/AAC + Quality Inspector                | ELEVATED | WO-005–009; WO-011; adendo QA                                     | PLANNED                      |
| WO-013 | #30   | Hardening: quotas, backup, retenção, recuperação        | ELEVATED | WO-003; WO-005; WO-012; WO-015–021 (complemento); etapa final     | PLANNED                      |
| WO-014 | #31   | Release V2: regressão, auditoria, deploy                | ELEVATED | WO-001–013 e WO-015–021; terminal                                 | PLANNED                      |
| WO-015 | #32   | Hook Lab: 3 aberturas A/B/C                             | STANDARD | WO-004; WO-010; WO-011; WO-012                                    | PLANNED                      |
| WO-016 | #33   | Color Match e presets de terror                         | STANDARD | WO-002; WO-003; WO-006; WO-011; WO-012                            | PLANNED                      |
| WO-017 | #34   | Continuidade visual + Character Identity Kit            | ELEVATED | WO-003; WO-004; WO-011; WO-016 (quando disponível)                | PLANNED                      |
| WO-018 | #35   | Capas, posters e cards                                  | STANDARD | WO-003; WO-004; WO-011; WO-012; WO-016                            | PLANNED                      |
| WO-019 | #36   | Finais A/B cinematográficos e CTA canônica              | STANDARD | WO-004; WO-010; WO-012 (proposta); V1 canon/choices               | PLANNED                      |
| WO-020 | #37   | Laboratório de retenção, métricas manuais               | STANDARD | WO-012; WO-015; WO-018; WO-019; WO-001; métricas V1 manuais       | PLANNED                      |
| WO-021 | #38   | Bíblia audiovisual, presets e herança                   | STANDARD | WO-004; WO-009; WO-011; WO-016; WO-018                            | PLANNED                      |
| WO-022 | #39   | Smart Cutdowns 30/45/60 s                               | STANDARD | WO-004; WO-008; WO-012; WO-015; WO-019                            | PLANNED                      |
| WO-023 | #40   | Clip Rescue reversível                                  | ELEVATED | WO-003; WO-006; WO-012; WO-016; retenção mínima WO-001/003        | PLANNED                      |
| WO-024 | #41   | Storyboard Inspector pré-Flow                           | STANDARD | WO-001; WO-025; V1 storyboard                                     | PLANNED                      |
| WO-025 | #42   | Narrative Intelligence pré-produção                     | STANDARD | WO-001; V1 episódios/revisões/bíblia                              | PLANNED                      |
| WO-026 | #43   | Interactive Universe, grafo de escolhas/cânone          | ELEVATED | WO-001; WO-025; WO-019                                            | PLANNED                      |
| WO-027 | #44   | Publishing Kit manual multiplataforma                   | STANDARD | WO-012; WO-018; WO-019; WO-022; WO-021                            | PLANNED                      |
| WO-028 | #45   | Season Factory 10–15 episódios                          | ELEVATED | WO-024; WO-025; WO-026; WO-012/015/018/019/021/022/027 (proposta) | PLANNED                      |

### Melhorias aprovadas — ownership 1:1

| #   | Melhoria                     | WO dona         |
| --- | ---------------------------- | --------------- |
| 1   | Hook Lab, 3 aberturas        | WO-015          |
| 2   | Color Match/presets          | WO-016          |
| 3   | Curva de tensão              | WO-010 (adendo) |
| 4   | Continuidade visual/metadata | WO-017          |
| 5   | Quality Inspector            | WO-012 (adendo) |
| 6   | Capas 9:16 + feeds           | WO-018          |
| 7   | Prévia com safe zones        | WO-011 (adendo) |
| 8   | CTA A/B cinematográfico      | WO-019          |
| 9   | Laboratório de retenção      | WO-020          |
| 10  | Bíblia audiovisual           | WO-021          |
| 11  | Smart Cutdowns               | WO-022          |
| 12  | Narração emocional           | WO-007 (adendo) |
| 13  | Clip Rescue                  | WO-023          |
| 14  | Soundscape estéreo simulado  | WO-009 (adendo) |
| 15  | Storyboard Inspector         | WO-024          |
| 16  | Character Identity Kit       | WO-017 (adendo) |
| 17  | Narrative Intelligence       | WO-025          |
| 18  | Interactive Universe         | WO-026          |
| 19  | Publishing Kit               | WO-027          |
| 20  | Season Factory               | WO-028          |

São **28 WOs**, não 34: os seis adendos ficam dentro das WOs indicadas.

## Grafo e ordem topológica proposta

```
WO-001 ─┬─> WO-002 ─> WO-003 ─> WO-004 ─> WO-005 ─> WO-006 ─┬─> WO-007 ─> WO-008 ─┐
        │                                                   ├─> WO-009 ───────────┤
        │                                                   └────────────────────┴─> WO-011 ─> WO-012
        ├─> WO-025 ─> WO-010 (proposta) ──────────────────────────────────────────────────────> WO-015
        │              └─> WO-024 ─> WO-028
        ├─> WO-016 ─> WO-017
        └─> WO-016 ─> WO-018 ─> WO-021 ─> WO-027
WO-012 + WO-015 + WO-019 ─> WO-022
WO-012 + WO-016 + WO-006 + WO-003 ─> WO-023
WO-015 + WO-018 + WO-019 ─> WO-020
WO-025 + WO-019 ─> WO-026
WO-003 + WO-005 + WO-012 + WO-015–021 ─> WO-013 (hardening final)
Todas 001–013 + 015–021 ─> WO-014 (release terminal)
```

Regras verificadas:

- **Sem ciclo:** nenhuma aresta volta para uma WO anterior no grafo proposto.
- **WO-024 depende de WO-025**, embora #41 venha antes de #42 numericamente.
- **WO-013 é hardening final**, não pré-requisito de WO-023; a política mínima de retenção nasce em WO-001/WO-003 e é auditada em WO-013.
- **WO-014 é terminal** e exige todas as WOs 001–013 e 015–021 aprovadas.
- **WO-026** exige WO-019 (CTA) e WO-025 (Narrative Intelligence).
- Dependências marcadas como “proposta” no inventário devem ser confirmadas no corpo da issue antes da execução; se a issue viva divergir, o grafo é corrigido e registrado.
- **Reconciliação pós-auditoria (issues vivas):** WO-018 depende de WO-016 e não de WO-021; WO-021 depende de WO-018; WO-020 depende de WO-015/018/019 e não de WO-027; WO-013 incorpora o complemento 015–021 após a execução/auditoria dessas WOs. A ordem abaixo já respeita essas arestas.

### Ordem de execução proposta

1. **Gate V1** (concluído: PR #16 mergeado em `13467ab`) e **WO-001** (este plano/ADR).
2. **WO-025** Narrative Intelligence, após o Source Pack V2 liberado.
3. **WO-002** benchmark → **WO-003** ingest → **WO-004** timeline → **WO-005** worker.
4. **WO-006** render → **WO-007** narração → **WO-008** legendas → **WO-009** áudio → **WO-010** diretor/tensão → **WO-011** editor/safe zones → **WO-012** export/QA.
5. **WO-015** Hook Lab → **WO-016** Color → **WO-017** continuidade/Character Kit → **WO-018** capas → **WO-019** CTA → **WO-020** retenção → **WO-021** StyleBible.
6. **WO-022** cutdowns → **WO-023** rescue → **WO-024** Storyboard Inspector → **WO-026** Universe → **WO-027** Publishing Kit → **WO-028** Season Factory.
7. **WO-013** hardening → **WO-014** release.

Não iniciar a próxima WO enquanto a atual estiver em `CORRECTION REQUIRED` ou `BLOCKED`. O merge/deploy de cada WO exige autorização verificável; nenhuma WO começa sem a precedente `APPROVED`.

## Matriz requisito → WO → prova/DoD

| Requisito V2                                      | WO     | Prova mínima                                                                   |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Upload privado de clipes Flow, codecs/PTS, quotas | WO-003 | ffprobe, MIME/container reais, owner/anon/non-owner, path traversal/SSRF, hash |
| Timeline determinística, versões e alinhamento    | WO-004 | unit/integração, 4/6/8 s, 15 clipes/120 s, reorder, rollback                   |
| Fila/worker com lease, retry, cancel, recuperação | WO-005 | job lifecycle, crash/restart, órfãos, concorrência 1, heartbeat                |
| Render 9:16, cortes, transições, VHS              | WO-006 | ffprobe 1080×1920 H.264/AAC, A/V sync, 3 execuções, fallback                   |
| Narração pt-BR/TTS opcional/emoção                | WO-007 | voz importada, alinhamento, fallback honesto, sem vazamento de fala            |
| Legendas SRT/ASS e burn-in                        | WO-008 | timestamps monotônicos, UTF-8, sync, estilos                                   |
| SFX/música licenciada, ducking, estéreo simulado  | WO-009 | licenças/atribuições, downmix mono, mix, limiter                               |
| Diretor determinístico + Gemini opt-in + tensão   | WO-010 | plano explicável, JSON validado, sem shell/SQL/FFmpeg, sem canon automático    |
| Editor/preview + safe zones                       | WO-011 | 360/768/1440, touch/teclado/foco/reduced-motion, preview privado               |
| Export MP4 + Quality Inspector                    | WO-012 | H.264/AAC/yuv420p, black/freeze/silence/peak, download autenticado             |
| Hardening/quotas/backup/retenção                  | WO-013 | restore isolado, quotas, retenção, incidentes, logs                            |
| Release V2                                        | WO-014 | regressão integral, CI, Vercel READY no SHA, worker, smoke, auditoria          |
| Hook Lab                                          | WO-015 | 3 hooks quando houver clipes, variantes exportáveis                            |
| Color Match                                       | WO-016 | presets, cenas escuras, antes/depois, sem perder original                      |
| Continuidade/Character Kit                        | WO-017 | consistência entre cenas/episódios, identidade reutilizável                    |
| Capas/posters/cards                               | WO-018 | 9:16 + 4:5 + 3:4, safe zones, 3 capas                                          |
| CTA/finais A/B                                    | WO-019 | 2 escolhas canônicas, CTA legível, final de temporada                          |
| Retenção                                          | WO-020 | métricas manuais reais, data/denominador, sem causalidade                      |
| StyleBible                                        | WO-021 | herança/versionamento por série, presets reutilizáveis                         |
| Cutdowns                                          | WO-022 | 30/45/60 s, legendas, CTA, trailer                                             |
| Clip Rescue                                       | WO-023 | correções reversíveis, original preservado, QA                                 |
| Storyboard Inspector                              | WO-024 | pré-Flow, ritmo/tomadas, sem render                                            |
| Narrative Intelligence                            | WO-025 | auditoria de roteiro/suspense/consistência, sem canon automático               |
| Interactive Universe                              | WO-026 | grafo de escolhas/consequências, branches, sem alterar publicado               |
| Publishing Kit                                    | WO-027 | MP4/capa/SRT/descrição/hashtags/atribuições/disclosure, sem postagem           |
| Season Factory                                    | WO-028 | 12 episódios, estados, bloqueios, filas, templates owner-only                  |

## Plano de testes e benchmark

- **Base V1:** `npm ci`, format, lint, typecheck, unit, build, audits, PgTAP/RLS, Playwright e smoke.
- **Mídia:** MIME/container reais, codec/PTS/VFR, 4/6/8 s, rotacionado/corrompido/truncado, path traversal/SSRF, upload idempotente, storage indisponível, rollback de `READY`, SHA dos originais.
- **FFmpeg:** 15 clipes, 120 s, 1080×1920 9:16, H.264/AAC/yuv420p, A/V sync, legendas, safe zones, CTA; decodificação integral; black/freeze/silence/peak com exceções artísticas.
- **Benchmark WO-002:** 3 medições por perfil (ARM64 e, se aplicável, x86/local), tempo total, pico de RAM, CPU, disco, tamanho de saída e falhas; filtros de cor/QA como cenário incremental; prova de custo incremental US$ 0. Se não passar, WO-002 = BLOCKED e nenhuma WO de vídeo começa.
- **Segurança:** owner/anon/non-owner, CSRF, IDOR, RLS, sessão expirada, upload malicioso, comandos/FFmpeg args, signed URL expiry, quotas, logs.
- **E2E:** 360/768/1440, touch/teclado/foco/reduced-motion; temporada de 12 episódios; V1 preservada.
- **Qualidade criativa:** dois estilos auditivos realmente diferentes ou fallback honesto; Color Match em cenas escuras; tensão explicável; 3 hooks; 3 capas; CTA legível; cutdowns; soundscape/downmix; rescue reversível. QA visual/auditivo humano registrado.

## Riscos, custos e rollback

- **Custo:** meta US$ 0 incremental. Nenhum serviço pago, GPU, API de vídeo, domínio ou cobrança pode ser ativado sem autorização separada. Vercel Hobby, Supabase Free e VPS Oracle existente são candidatos, não garantias.
- **Storage:** provedor e cota somente após WO-002; nada de vídeo no Postgres; Cloudinary de imagens não é presumido para vídeo.
- **Rollback:** V2 atrás de feature flag; migrações aditivas; artefatos versionados; jobs canceláveis; V1 continua operando; nenhuma limpeza destrutiva sem backup verificado.
- **Bloqueios:** falta de benchmark aprovado, VPS indisponível, licença de áudio, quota de storage, defeito HIGH/CRITICAL, revisão independente ausente ou ADR não aceita => `BLOCKED`, sem avançar.

## Gate atual

- V1: PR #16 mergeado em `13467ab`; auditoria independente **APPROVED**; smoke pós-merge 200/200/303.
- WO-001: **APPROVED**; PR #46 squash-merged em `01405cb`; ADR-V2-001 **ACCEPTED** pelo owner.
- WO-002: benchmark **GO CONDITIONAL**; evidência **APPROVED**. ADR-V2-002 **ACCEPTED** (Cloudflare R2 privado); WO-003 em execução. WO-004+ **BLOQUEADAS** até WO-003 `APPROVED`.
- Nenhuma migração, tabela, upload de vídeo, worker, deploy ou gasto foi criado por este plano.
