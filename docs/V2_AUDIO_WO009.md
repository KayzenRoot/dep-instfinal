# DIF-V2-WO-009 — Biblioteca licenciada, mix/ducking e soundscape

**Status:** implementação e testes locais **PASS**; CI final, auditoria independente e autorização do owner pendentes. **Não aprovada**, **não merged**, **não deployed**.
**Base:** `main` `7d6af5e` (checkpoint WO-008 promovido).
**Branch:** `feat/dif-v2-wo-009`.
**Escopo:** WO-009 (#26) + addendum ENH-14 (soundscape estéreo simulado), dependente de WO-006/WO-007.

## Entregue

- `audio_assets` owner-only: SFX/música/ambiência com autor, origem, licença, URL, atribuição, direitos comercial/social, status de licença, tags, intensidade, hash, duração, sample rate, canais, peak/true peak/LUFS e bytes privados no mesmo storage R2.
- Ingestão privada WAV/MP3/M4A/OGG com ffprobe, limite de 25 MB, detecção de clipping/silêncio, extensão vs formato real, deduplicação por SHA-256 e metadados de licença obrigatórios. Licença `VERIFIED` exige direitos comercial e social; `UNKNOWN`/`BLOCKED` ficam retidas para export.
- Eventos de áudio no `VideoEditPlan` (versionados junto ao plano): asset, kind, startMs, duração, offset, ganho, fades, pan, loop, ducking, preset espacial (`corridor`, `radio`, `steps-behind`, `whisper-side`) e modo `stereo_pan`/`binaural_simulated`.
- UI `/app/audio`: filtros por tipo e cinco categorias sugeridas (`porta`, `passos`, `impacto`, `drone`, `ambiente`), importação com licença, playback privado e badges de status.
- Timeline: editor de eventos, ganho master, controles por track, template de suspense 120 s (ambiência + impacto por timecode), preview A/B normal vs soundscape via Web Audio (simulado, sem alegar 3D nativo).
- Mixer FFmpeg: narração como sidechain, música/ambiência com ducking, SFX em bus separado, fades/pan/loop, presets espaciais, `loudnorm I=-16 TP=-1.5`, `alimiter`, AAC 48 kHz estéreo e validação de true peak/LUFS no render.
- Gate de licença em três camadas: UI só oferece assets exportáveis, `saveVideoEditPlan` rejeita asset ausente/sem licença/fora de faixa, worker revalida antes de baixar e queimar; evento bloqueado nunca chega ao MP4.
- Manifesto do render registra `audio` (eventos, ducking, modos espaciais, true peak, LUFS) e `audioMix` (assets, licenças, master gain).

## Capacidade real versus planejada

A biblioteca começa vazia; nenhum asset é baixado automaticamente. As licenças são declarações registradas pelo owner, não parecer jurídico. O soundscape é estéreo processado (pan, delay, filtros, eco) e compatível com downmix mono; **não é Dolby Atmos nem áudio 3D nativo**. A ausência de trilha não bloqueia o render: narração-only continua funcionando pelo caminho WO-007.

## Critérios de aceitação

| Critério                                                                  | Estado         | Evidência                                                                                |
| ------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| Owner adiciona/organiza 5 categorias com licenças                         | **PASS local** | E2E importa porta/passos/impacto/drone/ambiente com CC0 e filtra a biblioteca            |
| Template 120 s insere ambiência/SFX por timecode com narração e controles | **PASS local** | template unit; UI; mix integration com voz, música ducked e impacto; ganhos por evento   |
| Mix sem clipping, volume consistente e pausas; sem trilha não bloqueia    | **PASS local** | FFmpeg real: −16 LUFS alvo, true peak ≤ −0,8 dBTP, AAC 48 kHz; narração-only legado PASS |
| Ganho/posição no plano e reproduzidos no render                           | **PASS local** | schema/hash do plano, eventos versionados, filtros FFmpeg e manifesto do worker          |
| Efeito sem licença não aparece no MP4 exportável                          | **PASS local** | `assertAudioEventsUsable`, save gate, worker gate, PgTAP check e testes de biblioteca    |

## Addendum ENH-14 — soundscape

- Dois ambientes previstos: passos com pan esquerda→direita e rádio distante→perto; presets disparam pan/echo/low-pass e `binaural_simulated` usa atraso intercanal discreto.
- Preview A/B no navegador aproxima normal vs soundscape; o render real é a fonte de verdade.
- Downmix mono é testado sem silêncio/cancelamento grave.
- Limitações honestas: não há HRTF/Atmos nativo, não há rastreamento 3D; fones são recomendados no texto da UI.

## Testes

- Unit **156 + 3 skipped**: `audio-library.test.ts` (licença/deduplicação/eventos/template), `audio-library.test.ts` server (ingestão), `render-composition` unit (grafo de mix/ducking/limiter).
- Integração FFmpeg: mix real com narração + música + SFX, true peak/LUFS, ducking mensurável por banda, segunda renderização e downmix mono.
- PgTAP **131/131**: RLS/owner-only, service-only, licença verificada e rejeição cross-owner/cross-licença.
- E2E: importação de cinco categorias/filtros PASS (26,1s); timeline existente 1/1 PASS (2,5m); owner-boundary responsivo `/app/audio` PASS local; `401` do endpoint privado no CI.
- Policy audit: **27 invariantes / 24 tabelas PASS**. Benchmark local 120 s: 11,6 s wall, 15,3 s user, 124,708 KiB RSS (ARM64 pendente).
- CI e auditoria independente serão registrados em `docs/evidence/wo-009/`.

## Riscos e residuais

- Licença é metadado declarado; revisão jurídica humana continua necessária.
- O helper/ingestão exige WAV PCM 16-bit para o ASR; a biblioteca aceita WAV/MP3/M4A/OGG.
- Benchmark ARM64 específico do mixer e escuta humana em fones/speaker ainda pendentes; medições locais são indicativas.
- R2 live download/lifecycle/GC e menor privilégio do worker permanecem WO-013/014.
- O template de suspense é um ponto de partida; não substitui direção sonora humana.

## Gate

Testes completos, CI, Evidence Bundle, Checkpoint Delta PROPOSED, auditoria independente e autorização explícita de merge/promoção. **Sem merge/deploy.**
