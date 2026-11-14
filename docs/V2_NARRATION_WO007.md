# DIF-V2-WO-007 — Narração pt-BR, voz importada e TTS local

**Status:** implementação, testes, CI, auditoria de código, aceitação auditiva do owner e benchmark ARM64 **PASS**. Aguardando apenas autorização explícita de merge/promoção. **Não merged**, **não deployed**.
**Base:** `main` @ `c0f3cfd` (checkpoint WO-006).
**Branch:** `feat/dif-v2-wo-007`.
**Escopo:** WO-007 (#24) + addendum DIF-V2-ENH-12 (direção de voz).

## Entregue

- Upload owner-only de WAV/MP3/M4A até 20 MB, validado por bytes com ffprobe, com SHA-256, duração, sample rate, canais, pico RMS e true peak; rejeita clipping e formato inválido.
- Áudio privado em R2 (`narration/<owner>/<episode>/<take>.wav|mp3|m4a`), nunca em storage público; download apenas por URL assinada curta e rota owner-only.
- `voice_direction_plans` versionado por episódio, com `narrationTextSha256`, histórico de versões e snapshots restauráveis; RLS owner-only e escrita exclusiva do service role.
- `narration_takes` imutável por identidade (hash, tamanho, duração, loudness, modelo, licença); RLS owner-only.
- `VoiceDirectionPlan`: segmentos por sentença, emoção (`neutral/tension/whisper/urgency/fear/revelation`), speed 0,75–1,25, pausas antes/depois, volume, WPM alvo e mapa de pronúncia. Heurística determinística offline; JSON validado por Zod.
- Aprovação de direção exige take `READY` do mesmo episódio, garantido no servidor e por trigger no banco.
- Render com narração: o job fixa `narration_take_id` no enqueue (imutável), baixa o áudio privado, revalida SHA/tamanho/duração, renderiza vídeo, copia o stream de vídeo e faz mux AAC 48 kHz estéreo. Áudio mais curto é preenchido com silêncio desde que cubra ao menos 50% do vídeo; overflow acima de 250 ms falha explicitamente (`NARRATION_OVERFLOW`), sem corte oculto.
- TTS local Piper opcional: geração por segmento, pausas/velocidade/volume, normalização, concatenação, relatório de duração/WPM/true peak/LUFS/clipping, regeneração de um único segmento e upload opcional para R2/DB.
- UI `/app/narration`: seletor de episódio, edição por segmento, pronúncia/WPM/variante, preset editorial por série (metadados de direção; não alteram a prosódia do Piper), upload, preview, comparação A/B de takes, seleção, aprovação, histórico de versões e restauração.
- TTS Piper com timeout por segmento, relatório reprodutível com SHA-256 do WAV e do modelo, e validação de extensão contra o formato real.
- Timeline mostra a narração aprovada e o take que será fixado no render; sem narração aprovada o render segue vídeo-only.
- Backup manifest inclui as tabelas de narração.

## Capacidade real versus planejada

Piper **não** altera emoção real. O relatório declara `emotion: false`; emoção permanece metadado de direção/legenda e o motor aplica somente velocidade, volume e pausas. A voz importada é o fallback honesto. Nenhum áudio de terceiro é clonado, nenhuma API paga é chamada e nenhum modelo sem licença é usado.

Modelo de audição: `pt_BR-cadu-medium.onnx` (Piper 1.8+, dataset CC0), SHA-256 `d5a662e3f606d5a49dd29ba9ce90c304ae45dd9543f8b0c773bcb0de282499de`. Amostras versionadas: `docs/evidence/wo-007/sample-neutral.wav` (`55f87e2d296ecf5eabced845b27708e32fbc39b7f88535b75bed8980d6ee1c04`, 8.978 s) e `sample-tension.wav` (`e8871c4d1846d8053f4672b91b759f31747d4a60a42c2b3ace79456af6921439`, 7.350 s).

## Critérios de aceitação

| Critério                                                                                    | Estado       | Evidência                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner carrega voz importada, reproduz preview e renderiza num plano com timestamps corretos | **PASS CI**  | E2E `e2e/timeline.spec.ts` no CI `43547252585`: upload WAV 118 s, preview, aprovação, restauração, render READY com AAC 48 kHz; áudio preenche os 2 s restantes; duração total no E2E; monotonicidade coberta por teste unitário e relatório |
| TTS local gera narração inteligível pt-BR em episódio sintético, com custo medido           | **PASS**     | 232 palavras → 94.552 s, true peak −2,8 dBFS, −19,5 LUFS, 8,7 MB; ARM64: 81 s de áudio em 8,86 s, RTF 0,109, 282 MB RSS, ASR 0,909; owner aceitou as amostras Cadu                                                                           |
| Qualidade aceita pelo owner                                                                 | **PASS**     | Owner: “agora esta muito bom vamos continuar” em 2026-11-14; amostras Cadu `sample-neutral.wav`/`sample-tension.wav` e `docs/evidence/wo-007/owner-acceptance.txt`                                                                           |
| Acentos/pontuação preservados e pausas ajustáveis                                           | **PASS**     | fixtures com `Às`, `três`, `dezessete`, `Alice=Álissi`, `dez=10`; relatório por segmento                                                                                                                                                     |
| Extensão/silêncio não destrói timing                                                        | **PASS**     | `narrationDurationPolicy`: piso de 50% de cobertura, pad de áudio curto, falha acima de 250 ms de overflow; teste unitário e mux real                                                                                                        |
| Sem clipping alto ou diferenças ocultas                                                     | **PASS**     | limiter `0.7` com `level=false` e true peak final ≈ −1,8 dBFS; threshold de rejeição −0,5 dBFS; true peak/LUFS no take e no relatório                                                                                                        |
| Acesso privado e revisão versionada                                                         | **PASS**     | RLS owner-only, service-only writes, PgTAP 108/108, versões com snapshots e restauração                                                                                                                                                      |
| 4 estilos como metadados e 2 diferenças audíveis                                            | **PASS**     | 6 emoções e 4 presets modelados; amostras neutral/tension aceitas pelo owner; TTS entrega diferenças reais de velocidade/pausa/volume, sem alegar emoção real                                                                                |
| Regenerar trecho sem refazer todo vídeo                                                     | **PASS CLI** | `TTS_SEGMENT_ID` regenera um segmento e recompõe o WAV; render reutiliza o vídeo e refaz apenas o mux                                                                                                                                        |
| Undo/revert e áudio original preservado                                                     | **PASS**     | versões com snapshot e ação `?/restore`; takes nunca são sobrescritos nem deletados                                                                                                                                                          |
| Modo offline/sem TTS íntegro; sem API paga/clonagem                                         | **PASS**     | upload manual e render funcionam sem Piper; nenhuma chamada paga no código                                                                                                                                                                   |

## Testes executados

- `npx supabase test db`: **108/108 PASS**.
- `npm run audit:policy`: **25 invariantes / 22 tabelas PASS**.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- Vitest unitário/integração: **116 passed + 2 skipped**; `voice-direction` + `render-composition` + mux FFmpeg real; TTS Piper opt-in real.
- CI hospedada `43547252585` em `4117010`: **SUCCESS** (8m11s); E2E **12/12** em 3,5m; timeline com narração e render READY em **34,7s**; worker real `render_completed`.
- E2E: upload, preview, aprovação, restauração de versão, recompravação, render real com AAC e READY.
- E2E owner-boundary: rotas de narração anônimas retornam 401; layout 360/768/1440 sem overflow.
- TTS 120 s: `docs/evidence/wo-007/tts-full-120-report.json`.
- Amostras de audição: `docs/evidence/wo-007/sample-neutral.wav`, `sample-tension.wav` e relatórios `tts-neutral-report.json`/`tts-tension-report.json`.
- Log sanitizado do CI: `docs/evidence/wo-007/ci-4117010.txt`.

## Riscos e residuais

- **Arm64 benchmark PASS:** Oracle Neoverse-N1, 2 vCPU, 81 s de áudio em 8,86 s (RTF 0,109), 282 MB RSS, 191% CPU; ASR 0,909; temporários removidos.
- **Aceitação auditiva PASS:** owner aceitou as amostras Cadu em 2026-11-14; registro em `docs/evidence/wo-007/owner-acceptance.txt`.
- **Qualidade emocional:** Piper é plano; não rotular como emocional. A emoção é direção e o fallback é voz importada.
- **R2 lifecycle/GC:** takes órfãos e versões antigas ainda dependem de operação manual; não há varredura automática nesta WO.
- **SRT:** os timestamps por segmento estão no relatório, mas a exportação SRT/ASS é WO-008.
- **Worker credential:** o worker continua com service role; menor privilégio é WO-013/014.
- **R2 live na narração:** o E2E usa `WORKER_NARRATION_DIR` local; o download R2 real do take não foi exercitado nesta WO (o R2 de vídeo foi validado em WO-003).
- **VPS deploy:** nenhum daemon, container, firewall, chave ou deploy foi alterado.

## Comandos de operação

```powershell
$env:PIPER_PYTHON='C:/caminho/venv/Scripts/python.exe'  # Piper 1.8+
$env:PIPER_MODEL='C:/caminho/pt_BR-cadu-medium.onnx'
$env:PIPER_VOICE='pt_BR-cadu-medium'
$env:PIPER_MODEL_LICENSE='CC0'
$env:TTS_PLAN_FILE='C:/caminho/plan.json'
$env:TTS_OUTPUT_DIR='C:/caminho/saida'
npm run tts:local
```

Para regenerar um segmento, mantenha o diretório e defina `TTS_SEGMENT_ID=<uuid>`. Para upload privado, defina `TTS_UPLOAD=1`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e as variáveis R2; o episódio vem de `episodeId` no plano.

## Gate

Auditoria independente de código **APPROVED**; CI final verde; aceitação auditiva e benchmark ARM64 PASS; Checkpoint Delta PROPOSED. **Aguardando autorização explícita de merge/promoção.** Próxima WO permanece bloqueada.
