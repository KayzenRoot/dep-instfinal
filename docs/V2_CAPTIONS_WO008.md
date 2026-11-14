# DIF-V2-WO-008 — Legendas inteligentes, SRT/ASS e burn-in

**Status:** implementação e CI pré-auditoria **PASS**; auditoria independente retornou **CORRECTION REQUIRED** (H1–H5); correções aplicadas e revalidação local **PASS**; novo CI e reauditoria pendentes. **Não aprovada**, **não merged**, **não deployed**.
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
| Voz real + roteiro pt-BR geram legendas alinhadas/editáveis                  | **PASS local** | integração real Piper Cadu + Vosk (score >0,5); E2E timeline com 13 cues                          |
| Trocar texto/timing persiste e atualiza preview/render sem mexer na narração | **PASS local** | `caption_tracks` versionado + snapshot; editor; worker lê track aprovado do take atual            |
| SRT parseável, ASS válido e burn-in dentro da tela                           | **PASS local** | unit SRT/ASS/CTA; FFmpeg burn-in com frame real e margem horizontal ≥80 px; manifest `captions`   |
| Falha ASR/ARM64 não quebra edição; fallback manual                           | **PASS**       | editor manual independente do Vosk; erros explícitos; `ASR_FALLBACK` quando a cobertura é parcial |
| Legendas/áudio privados, sem conteúdo em logs                                | **PASS**       | RLS owner-only, service-only writes, APIs privadas, guarda de take/voz aprovada                   |

## Correções pós-auditoria (H1–H5)

- **H1 — timestamps:** timestamps de palavras/cues arredondados para inteiros e schema validado antes de persistir; cues curtas são estendidas até 300 ms em vez de descartadas.
- **H2 — take atual:** `loadCaptionTrack`, exportações, página e worker filtram pelo `narration_take_id`; aprovar/gerar exige voz aprovada e READY; trigger do DB rejeita JSON/coluna divergentes e aprovação sem voz aprovada.
- **H3 — fantasma/fallback:** o último cue termina no máximo 1,5 s após a última palavra ASR; cobertura <80% ou última palavra antes de 40% da duração rebaixa a fonte para `ASR_FALLBACK`.
- **H4 — safe area/escape:** quebra por largura estimada (880 px) além do limite de 42 caracteres; ASS re-quebra qualquer linha manual; `\` e `{}` são neutralizados; o ASS é copiado para diretório de trabalho seguro e referenciado por nome simples, eliminando falhas com apóstrofo/dois-pontos no path.
- **H5 — evidência:** E2E valida `output_manifest.captions` (`trackId`, `cues`, estilo, safe zone, take, hash); teste CTA cobre não-sobreposição/janela; teste FFmpeg extrai frame real e mede a margem horizontal; docs corrigidas para 13 cues.

## Testes

- `npm test`: **132 passed + 3 skipped**; inclui 120s, mux, burn-in ASS, CTA e ASR opt-in.
- `npm run test:db`: **122/122 PASS**.
- `npm run test:e2e:local -- e2e/timeline.spec.ts`: **1 passed (12,1m)**, com legendas aprovadas, render READY e manifesto com 13 cues.
- `npm run build`: PASS.
- `npm run audit:policy`: **26 invariantes / 23 tabelas PASS**.
- Integração real ASR: `caption-asr.integration.test.ts` PASS com Piper Cadu + Vosk.
- CI hospedada anterior `43608151136` em `64d8999`: **SUCCESS** (8m54s); Sonar PASS; E2E 12/12 em 4,3m. Evidência em `docs/evidence/wo-008/ci-64d8999.txt`. O CI do commit de correções será registrado em novo arquivo de evidência.

- Unit `captions.test.ts` (15 testes): normalização, alinhamento/hallucination, timestamps fracionários, fantasma, cue curta, linhas largas, CTA, SRT/ASS, safe zone e escape ASS.
- Integração real opt-in `caption-asr.integration.test.ts`: Piper Cadu → Vosk → alinhamento.
- Integração FFmpeg: burn-in ASS com path contendo apóstrofo, frame real 1080×1920 e margem horizontal segura.
- PgTAP: owner-only, service-only, aprovação com cues, vínculo ao plano, vínculo ao take e voz aprovada.
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

Testes locais PASS; novo CI e reauditoria independente pendentes; Evidence Bundle e Checkpoint Delta PROPOSED. Falta autorização explícita de merge/promoção. **Sem merge/deploy.**
