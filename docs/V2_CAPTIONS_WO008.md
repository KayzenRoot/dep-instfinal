# DIF-V2-WO-008 — Legendas inteligentes, SRT/ASS e burn-in

**Status:** implementação e testes locais **PASS**; CI e auditoria independente pendentes. **Não aprovada**, **não merged**, **não deployed**.
**Base:** `main` @ `326c576` (checkpoint WO-007 promovido).
**Branch:** `feat/dif-v2-wo-008`.
**Escopo:** WO-008 (#25), dependente de WO-006 + WO-007 aprovados.

## Entregue

- Contrato `CaptionTrack`/`CaptionCue` versionado por plano de edição, com estilo (`clean`, `vhs`, `highlight`), safe zone (`tiktok`, `reels`, `stories`, `feed`), fonte, score de alinhamento e hashes de script/áudio.
- Alinhamento forçado determinístico entre o roteiro conhecido e palavras ASR: normalização NFD (acentos/pontuação), DP de similaridade, descarte de palavras inventadas pelo ASR, interpolação de tokens não reconhecidos e timestamps monotônicos.
- Quebra de linha em até 2 linhas/42 caracteres, cues de 300 ms–8 s, sem sobreposição e sem cue fantasma para trecho vazio.
- Exportadores SRT e ASS com timestamps, estilos, margem inferior segura e escape de texto.
- `caption_tracks` owner-only com RLS forçada, escrita exclusiva do service role, versões com snapshot/restore e trigger que exige cues para aprovar.
- API owner-only para SRT/ASS e UI `/app/captions` com editor de cues, prévia 9:16, importação de JSON ASR, safe zone, aprovação e histórico.
- Worker: se existir caption track aprovado para a versão do plano, gera ASS e aplica `ass=filename=...` no filter graph antes do VHS; o manifesto registra track, cues, estilo e safe zone.
- CLI `npm run captions:align` com ASR Vosk local opcional (`scripts/asr-vosk.py`) e fallback manual.
- Backup manifest inclui `caption_tracks`; policy audit cobre 23 tabelas.

## Capacidade real versus planejada

O ASR Vosk é opcional e offline. O alinhamento sempre preserva o texto do roteiro; palavras inventadas pelo ASR não entram na legenda. Se o ASR falhar, o editor manual continua funcionando sem falso status de sincronização. Nenhum serviço pago, GPU, publicação ou automação do Flow foi usado.

## Critérios de aceitação

| Critério                                                                     | Estado         | Evidência                                                                            |
| ---------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Voz real + roteiro pt-BR geram legendas alinhadas/editáveis                  | **PASS local** | integração real Piper Cadu + Vosk (score >0,5); E2E timeline 4,1m com 8 cues         |
| Trocar texto/timing persiste e atualiza preview/render sem mexer na narração | **PASS local** | `caption_tracks` versionado + snapshot; editor; worker lê track aprovado             |
| SRT parseável, ASS válido e burn-in dentro da tela                           | **PASS local** | unit SRT/ASS; FFmpeg burn-in; E2E com manifest `captions` e 8 cues; safe zone 220 px |
| Falha ASR/ARM64 não quebra edição; fallback manual                           | **PASS**       | editor manual independente do Vosk; erros explícitos                                 |
| Legendas/áudio privados, sem conteúdo em logs                                | **PASS**       | RLS owner-only, service-only writes, APIs privadas                                   |

## Testes

- `npm test`: **124 passed + 3 skipped**; inclui 120s, mux, burn-in ASS e ASR opt-in.
- `npm run test:db`: **117/117 PASS**.
- `npm run test:e2e:local -- e2e/timeline.spec.ts`: **1 passed (4,1m)**, com legendas aprovadas e render READY.
- `npm run build`: PASS.
- `npm run audit:policy`: **26 invariantes / 23 tabelas PASS**.
- Integração real ASR: `caption-asr.integration.test.ts` PASS com Piper Cadu + Vosk.

- Unit `captions.test.ts`: normalização, alinhamento/hallucination, monotonicidade, linhas longas, SRT/ASS, safe zone.
- Integração real opt-in `caption-asr.integration.test.ts`: Piper Cadu → Vosk → alinhamento.
- Integração FFmpeg: burn-in ASS em 9:16.
- PgTAP: owner-only, service-only, aprovação com cues, vínculo ao plano.
- E2E: timeline + narração + legendas + render narrado/queimado.
- Policy audit e backup manifest.

## Riscos e residuais

- ASR Vosk precisa de modelo local; o CI padrão não baixa modelo.
- O render atual só queima legenda se houver track aprovado para a versão do plano; planos antigos continuam vídeo-only.
- O alinhamento por palavra é aproximado quando o ASR erra a palavra; o texto é corrigido, mas o timing pode exigir ajuste humano.
- SRT/ASS são gerados da DB; não há arquivo persistido em R2.
- A VPS/worker não recebeu deploy nesta WO.
- R2 lifecycle/GC, menor privilégio do worker e revisão visual humana permanecem residuais.

## Gate

Testes completos, CI, Evidence Bundle, Checkpoint Delta PROPOSED e auditoria independente. **Sem merge/deploy/promoção.**
