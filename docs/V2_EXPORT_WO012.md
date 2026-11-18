# DIF-V2-WO-012 — Export MP4, download privado e Quality Inspector

**Status:** implementação completa em `feat/dif-v2-wo-012`; unit **206+3**, PgTAP **152/152**, policy **28/25**, E2E timeline **1/1** e responsivo **1/1** PASS; CI e auditoria independente **PENDENTES**. Sem merge/deploy; checkpoint **PROPOSED**.
**Base:** `main` `b21afa3` (checkpoint WO-011 promovido).
**Escopo:** WO-012 (#29) + addendum ENH-05 (Quality Inspector técnico), dependente de WO-005–WO-011.

## Entregue

- `render_jobs.output_profile` (`1080p` padrão, `720p` fallback explícito) e `render_jobs.quality` (`standard`/`high`) persistidos no enqueue, com UI na timeline e aviso honesto no fallback 720p.
- `render-composition` parametrizado para 1080×1920 ou 720×1280, H.264 High/yuv420p, 30 fps, faststart, CRF/preset por qualidade; geometria não suportada falha fechado.
- `render_quality_reports`: relatório imutável por job + SHA do artefato, RLS owner-only, escrita apenas por service role, acknowledgement de WARN com justificativa; BLOCKED não pode ser reconhecido.
- Quality Inspector no worker após o render e antes do upload: hash/tamanho, vínculo plano↔artefato, codec/geometria/fps/pix format/duração, AAC estéreo 48 kHz, drift A/V, decodificação integral, `blackdetect`, `freezedetect`, `silencedetect`, pico `astats`, LUFS quando disponível, safe area declarativa, legendas e CTA.
- Exceções artísticas: janelas aceitas do diretor (`SILENCE_BEFORE_REVEAL`, `VHS_STATIC`, `CTA_CARD`) e pad intencional da narração descontam apenas o trecho aprovado; cada exceção fica registrada com motivo.
- Gate: `BLOCKED` técnico (hash, codec, decode, áudio, safe area, legendas/CTA ausentes) falha o job sem READY e sem upload; preto/freeze/silêncio heurístico é `WARN` com severidade e pode ser reconhecido pelo owner; `PASS` libera o download; check crítico `NOT_TESTED` e `WARN` sem reconhecimento não liberam.
- Manifest registra `outputProfile`, `quality`, `qa.status/reportId/reportSha256/summary`, `captionsOmitted` e CTA; upload R2 grava `sha256`/plano/QA como metadata privada.
- Download owner-only `/api/render-jobs/[jobId]/download`: confere relatório e metadata R2 (SHA/tamanho/plano), transmite com `private, no-store` e não expõe URL permanente; modo local de teste restrito a non-production.
- `/app/export`: lista os renders recentes, status QA, verificações com timecodes, reconhecimento de WARN, download do MP4, SRT e laudo JSON (`/api/render-jobs/[jobId]/qa`) com checklist humano.
- PgTAP: 152/152 (opções, 720p completo, RLS, imutabilidade, acknowledgement); policy audit 28 invariantes/25 tabelas.

## Capacidade real versus planejada

- O QA é técnico e determinístico: não faz OCR, não julga semântica, copyright, qualidade criativa ou “potencial viral”. A revisão humana no aparelho continua obrigatória.
- `blackdetect`/`freezedetect`/`silencedetect` têm thresholds configuráveis por env (`QA_*`), mas são heurísticas; trechos artísticos precisam de janela aceita ou reconhecimento.
- O checklist humano é exportado no laudo JSON; não há assinatura persistida separada para renders PASS.
- O download transmite o objeto privado pelo servidor; links assinados continuam existindo apenas para mídia V1. Não há publicação em redes sociais.
- Perfis de safe area são os mesmos da WO-011; planos legados sem `preview` ficam `NOT_TESTED` na safe area e no layout de legendas.

## Critérios de aceitação

| Critério                                                                       | Estado     | Evidência                                                           |
| ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------- |
| Episódio 120 s/15 cenas gera MP4 com narração, trilha, SFX, efeitos e legendas | PASS local | E2E timeline real 5,5 min; QA PASS; download com SHA-256 confirmado |
| CTA de duas escolhas correta e fora da safe area                               | PASS local | QA de CTA e safe area; cue de CTA obrigatório quando habilitada     |
| ffprobe comprova resolução/proporção/codec/áudio/duração e decode integral     | PASS local | QA `CONTAINER`, `AUDIO_STREAM`, `DURATION`, `DECODE`                |
| Download privado autenticado e idêntico ao SHA do manifesto                    | PASS local | E2E `/download` + SHA-256; anon 401                                 |
| Nova exportação não perde a anterior                                           | PASS local | jobs/artefatos por job id; lista dos últimos 20 renders             |
| 720p só como fallback com aviso                                                | PASS local | UI + validação de geometria + teste unit 720p/high                  |
| QA detecta preto/freeze/silêncio/clipping e safe area                          | PASS local | unit + integração FFmpeg real; exceções do diretor/pad              |
| BLOCKED não vira READY e não pode ser reconhecido                              | PASS local | PgTAP + fluxo do worker                                             |

## Testes planejados

- Unit: parsers de `blackdetect`/`freezedetect`/`silencedetect`/`astats`, thresholds e schema do relatório.
- Integração FFmpeg real: artefato preto de 3 s gera `BLACK_FRAMES` WARN; decode/container PASS.
- PgTAP: opções de enqueue, RLS owner-only, imutabilidade, acknowledgement WARN, BLOCKED rejeitado.
- E2E timeline: render READY com QA PASS, `GET /api/render-jobs/[jobId]` com laudo, download idêntico ao SHA, anon 401.
- Responsivo 360/768/1440 da página de exportação; lint/typecheck/build/policy.

## Correções pós-auditoria

A primeira auditoria independente retornou **CORRECTION REQUIRED** (H1: `complete_render_job` ainda exigia 1080×1920 e o fallback 720p falhava; H2: preto/freeze/silêncio heurístico geravam BLOCKED irrevogável; M1–M8). Aplicado:

- **H1:** `complete_render_job` lê `output_profile` e aceita 1080×1920 ou 720×1280; manifesto com bloco `qa` exige relatório PASS/WARN correspondente ao SHA; PgTAP cobre 720p, hash divergente e ausência de laudo.
- **H2:** `BLACK_FRAMES`, `FREEZE_FRAMES` e `SILENCE` viraram WARN com severidade HIGH/MEDIUM e podem ser reconhecidos pelo owner com justificativa; BLOCKED fica restrito a falhas técnicas (hash, codec, decode, áudio, safe area, legendas/CTA ausentes). Sobreposição parcial de exceção agora desconta só a janela aprovada.
- **M1:** CTA habilitada com legendas desativadas vira BLOCKED (a CTA não entraria no MP4).
- **M2:** download bloqueia qualquer check crítico `NOT_TESTED` (ex.: safe area de plano legado).
- **M3:** exceção de sobreposição parcial desconta só a janela aprovada e registra o intervalo real.
- **M4:** a página de exportação mantém o relatório do SHA do manifesto e valida o JSON com Zod.
- **M5:** QA mede fps/pix format do probe e adiciona nível integrado (LUFS) quando disponível.
- **M6:** UI ganhou filtro de checks, exceções visíveis e link para a timeline.
- **M7:** SRT/ASS usam `takeId` da narração pinada (ou `none` explícito); worker usa o `reportSha256/status` retornados, grava artefatos locais por job id e extrai `QA_*` do stderr sem depender do início da linha.
- **M8:** evidência/docs foram recontadas após os testes.

## Riscos e residuais

- Thresholds heurísticos podem gerar falso positivo/negativo; exceções e revisão humana são obrigatórias.
- O clique por timestamp abre a timeline do episódio, não um frame exato; não há OCR nem julgamento semântico.
- O worker ainda usa service role ampla; menor privilégio e quotas ficam para WO-013.
- R2 lifecycle/GC e retenção de renders antigos continuam pendentes de WO-013.
- Relatórios de jobs anteriores à WO-012 não existem; é necessário re-renderizar para liberar o download.
- O download em produção depende de R2 configurado; em dev/teste usa o diretório local do worker.
- O sign-off humano é registrado pelo acknowledgement de WARN; renders PASS têm checklist no laudo, sem assinatura separada.

## Gate

CI hosted, PgTAP, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização do owner antes de merge/promoção. **Sem merge/deploy.**
