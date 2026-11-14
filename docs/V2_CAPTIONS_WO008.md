# DIF-V2-WO-008 — Legendas inteligentes, SRT/ASS e burn-in

**Status:** implementação, CI pré-auditoria **PASS**; duas auditorias independentes retornaram **CORRECTION REQUIRED**; correções H1–H5 e achados H-1/H-2/M-1–M-6 aplicados; revalidação local e CI `43623019673` **PASS**; reauditoria final pendente. **Não aprovada**, **não merged**, **não deployed**.
**Base:** `main` @ `326c576` (checkpoint WO-007 promovido).
**Branch:** `feat/dif-v2-wo-008`.
**Escopo:** WO-008 (#25), dependente de WO-006 + WO-007 aprovados.

## Entregue

- Contrato `CaptionTrack`/`CaptionCue` versionado por plano de edição, com estilo (`clean`, `vhs`, `highlight`), safe zone (`tiktok`, `reels`, `stories`, `feed`), fonte, score de alinhamento e hashes de script/áudio.
- Alinhamento forçado determinístico entre o roteiro conhecido e palavras ASR: normalização NFD (acentos/pontuação), DP de similaridade, descarte de palavras inventadas pelo ASR, interpolação de tokens não reconhecidos e timestamps monotônicos.
- Quebra de linha em até 2 linhas/42 caracteres com largura estimada limitada a 880 px; cues de 300 ms–8 s, sem sobreposição e sem cue fantasma para trecho vazio.
- Exportadores SRT e ASS com timestamps, estilos, margem inferior segura e neutralização de sequências ASS (`\N`, `{}`) no texto do usuário.
- `caption_tracks` owner-only com RLS forçada, escrita exclusiva do service role, versões com snapshot/restore e trigger que amarra o JSON ao `narration_take_id`, exige cues e exige voz aprovada/READY para aprovar.
- Legenda carregada/exportada/queimada apenas para o take de narração atual; trocar a voz invalida a track anterior e o worker registra o take no manifesto.
- API owner-only para SRT/ASS e UI `/app/captions` com editor de cues, prévia 9:16, importação de JSON ASR, safe zone, aprovação e histórico.
- Worker: se existir caption track aprovado para a versão do plano **e para o take do job**, copia o ASS para um diretório de trabalho seguro e aplica `ass=filename=captions.ass` antes do VHS; o manifesto registra track, cues, estilo, safe zone e take.
- CLI `npm run captions:align` com ASR Vosk local opcional (`scripts/asr-vosk.py`) e fallback manual.
- Backup manifest inclui `caption_tracks`; policy audit cobre 23 tabelas.

## Capacidade real versus planejada

O ASR Vosk é opcional e offline. O alinhamento sempre preserva o texto do roteiro; palavras inventadas pelo ASR não entram na legenda. Se o ASR falhar, o editor manual continua funcionando sem falso status de sincronização. Nenhum serviço pago, GPU, publicação ou automação do Flow foi usado.

## Critérios de aceitação

| Critério                                                                     | Estado         | Evidência                                                                                         |
| ---------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| Voz real + roteiro pt-BR geram legendas alinhadas/editáveis                  | **PASS local** | integração real Piper Cadu + Vosk (score >0,5); CLI real gerou 5 artefatos; E2E observou 13 cues  |
| Trocar texto/timing persiste e atualiza preview/render sem mexer na narração | **PASS local** | `caption_tracks` versionado + snapshot; editor; worker lê track aprovado do take atual            |
| SRT parseável, ASS válido e burn-in dentro da tela                           | **PASS local** | unit SRT/ASS/CTA; FFmpeg burn-in com frame real CJK/emoji e margem horizontal ≥80 px              |
| Falha ASR/ARM64 não quebra edição; fallback manual                           | **PASS**       | editor manual independente do Vosk; erros explícitos; `ASR_FALLBACK` quando a cobertura é parcial |
| Legendas/áudio privados, sem conteúdo em logs                                | **PASS**       | RLS owner-only, service-only writes, APIs privadas, guarda de take/voz/episódio                   |

## Correções pós-auditoria

- **H1:** timestamps de palavras/cues arredondados para inteiros e schema validado antes de persistir; cue final curta ganha espaço sem sobrepor o cue anterior (trim/merge) ou é descartada de forma explícita. Timestamps de palavras são monotônicos e ficam dentro do cue.
- **H2:** `loadCaptionTrack`, exportações, página e worker filtram pelo `narration_take_id`; aprovar/gerar exige voz aprovada e READY; trigger do DB rejeita JSON/coluna divergentes, take de outro episódio e aprovação sem voz aprovada; troca de voz substitui a track com nova versão. O contrato real `caption-align` → `asr-vosk.py` foi corrigido (stdout, sem `--output`) e executado com Piper/Vosk.
- **H3:** a cauda não correspondida é comprimida e truncada no teto de `última palavra + 1,5 s`; cobertura <80% ou última palavra antes de 40% da duração rebaixa a fonte para `ASR_FALLBACK`.
- **H4:** quebra por largura estimada (880 px) com classificação CJK/emoji, além do limite de 42 caracteres inclusive para tokens estreitos; ASS re-quebra linhas manuais; `\`, `{}` e controles são neutralizados; o ASS é copiado para diretório de trabalho seguro e referenciado por nome simples, eliminando falhas com apóstrofo/dois-pontos no path.
- **H5:** E2E valida `output_manifest.captions` (`trackId`, `cues > 0`, estilo, safe zone, take, hash); teste CTA cobre não-sobreposição, janela longa limitada e janela curta rejeitada; teste FFmpeg extrai frame real com CJK/emoji e mede a margem horizontal; docs distinguem cues observados de cues assertados.

## Testes

- `npm test`: **137 passed + 3 skipped**; inclui 120s, mux, burn-in ASS, CTA, largura CJK/emoji e ASR opt-in.
- `npm run test:db`: **124/124 PASS**.
- `npm run test:e2e:local -- e2e/timeline.spec.ts`: **1 passed (2,9m)**, com legendas aprovadas, render READY e manifesto observado com 13 cues.
- `npm run build`: PASS.
- `npm run audit:policy`: **26 invariantes / 23 tabelas PASS**.
- Integração real ASR: `caption-asr.integration.test.ts` PASS com Piper Cadu + Vosk e duração real do áudio.
- CLI real `npm run captions:align` com Piper/Vosk: PASS; gerou `asr-words.json`, `captions.json`, `captions.srt`, `captions.ass` e `report.json` (2 cues, score 0,869; fonte `ASR_FALLBACK` porque o áudio sintético de ~8 s foi alinhado a um episódio de 120 s).
- CI hospedada `43623019673` em `b104adf`: **SUCCESS** (7m49s); unit 137+3, PgTAP 124/124, E2E 12/12 (3,5m), Sonar/Socket/Vercel PASS. Evidência em `docs/evidence/wo-008/ci-b104adf.txt`. Runs anteriores `43617826034` e `43618535947` também passaram durante as correções.

- Unit `captions.test.ts` (20 testes): normalização, alinhamento/hallucination, timestamps fracionários, fantasma, cue curta/sobreposição, monotonicidade de palavras, CTA, SRT/ASS, safe zone, CJK/emoji/token estreito e escape ASS.
- Integração real opt-in `caption-asr.integration.test.ts`: Piper Cadu → Vosk → alinhamento com duração probeada.
- Integração FFmpeg: burn-in ASS com path contendo apóstrofo, frame real 1080×1920, CJK/emoji e margem horizontal segura.
- PgTAP: owner-only, service-only, aprovação com cues, vínculo ao plano, vínculo ao take, take do mesmo episódio e voz aprovada.
- E2E: timeline + narração + legendas + render narrado/queimado; manifesto `captions` com track/take/hash/style/safeZone.
- Policy audit e backup manifest.

## Riscos e residuais

- ASR Vosk precisa de modelo local; o CI padrão não baixa modelo.
- O render atual só queima legenda se houver track aprovado para a versão do plano; planos antigos continuam vídeo-only.
- O alinhamento por palavra é aproximado quando o ASR erra a palavra; o texto é corrigido, mas o timing pode exigir ajuste humano.
- SRT/ASS são gerados da DB; não há arquivo persistido em R2.
- A VPS/worker não recebeu deploy nesta WO.
- R2 lifecycle/GC, menor privilégio do worker e revisão visual humana permanecem residuais.

## Gate

Testes locais e CI PASS; reauditoria independente pendente; Evidence Bundle e Checkpoint Delta PROPOSED. Falta autorização explícita de merge/promoção. **Sem merge/deploy.**
