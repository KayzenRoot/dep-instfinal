# DIF-V2-WO-006 — Composição FFmpeg, cortes, transições e VHS 9:16

**Work Order:** `DIF-V2-WO-006` · issue #23 · epic #17
**Base:** `main` `b1081e9` (checkpoint WO-003/004/005 promovido)
**Branch:** `feat/dif-v2-wo-006`
**Status:** implementação, composição real, ffprobe/integração, worker real e E2E **PASS**; correções B1–B5/NEW-1/B4-R aplicadas; CI final `43446568528` **PASS** em 9m37s; **reauditoria pendente**. Nenhum worker foi implantado na VPS.

## 1. Entregue

- `src/lib/domain/render-composition.ts`: comando FFmpeg determinístico e allowlisted.
  - normalização por clipe: trim, setpts, fps 30, scale/crop 1080x1920, setsar, yuv420p;
  - corte seco via `concat`; crossfade via `xfade` com offsets do plano;
  - VHS/terror por `noise`, `eq` e `vignette` com intensidade limitada;
  - H.264 High, `+faststart`, vídeo-only nesta WO; sem shell, sem interpolação de prompt.
- `src/lib/server/render-compose.ts`: executa ffmpeg via `execFile`, valida saída por ffprobe (H.264, 1080x1920, 30 fps, duração ±1 s), calcula SHA-256/tamanho.
- `scripts/render-job.ts`: worker real com service role, revalidação do plano/contexto, download R2 ou `WORKER_ASSET_DIR`, verificação de SHA-256/tamanho, render local, upload R2 ou `WORKER_LOCAL_OUTPUT_DIR`, manifesto de saída.
- `scripts/render-worker.mjs`: `WORKER_STUB=0` executa o render real via `tsx`, heartbeat durante o render, kill da árvore de processos em SIGTERM/cancelamento e falha/retry.
- Migration `20261113101000_v2_wo006_worker_grants.sql`: SELECT service_role para episodes/revisions/scenes/video_assets necessários ao contexto; nenhuma escrita nova.

## 2. Pipeline

```
plano APROVADO + assets READY
  -> revalidar contexto/revisão/hash
  -> baixar (ou usar WORKER_ASSET_DIR) e verificar SHA-256/bytes
  -> normalizar cada clipe 1080x1920/30fps/yuv420p
  -> concat/xfade + VHS
  -> libx264 High + faststart
  -> ffprobe (geometria/duração/fps/codec)
  -> upload R2 privado ou saída local de teste
  -> render_job READY + output_manifest
```

O worker não aceita comando, URL ou caminho do usuário; só IDs owner-scoped e filtros allowlisted. `READY` agora significa um MP4 real validado, não um stub.

## 3. Testes

| Verificação          | Resultado                            | Evidência                                                                                                             |
| -------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Command builder      | **PASS 5**                           | 15 clipes/120 s, xfade, ordem/trim embaralhados, gap, asset ausente/curto/path inseguro                               |
| FFmpeg integration   | **PASS 2**                           | 120 s cuts + multi-crossfade 7 s (plano nominal 90 s), 1080x1920 H.264, ffprobe ±1 s                                  |
| E2E real worker      | **PASS**                             | 15 clipes reais → plano aprovado → worker real via `tsx` → READY 1080x1920/h264/120 s; segundo job cancelado; CI 1.7m |
| Unit total           | **PASS 103 + 1 skip**                | `npm test` (inclui integração FFmpeg quando disponível)                                                               |
| PgTAP                | **PASS 83/83**                       | + grant de leitura do worker + rejeição de manifesto stub; RLS/queue verdes                                           |
| Policy audit         | **PASS 23 invariantes / 20 tabelas** |                                                                                                                       |
| Lint/typecheck/build | **PASS**                             |                                                                                                                       |

## 4. Matriz de aceitação (issue #23)

| Critério                                                                 | Status           | Evidência/limite                                                                                |
| ------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| 15 cenas 8 s = 120 s ±1 s, 9:16, sem quadro preto/A/V drift              | **PASS**         | integração ffprobe; E2E real; vídeo-only (áudio é WO-007/009)                                   |
| Corte seco, fade/crossfade, transição VHS e safe zone                    | **PASS parcial** | corte/xfade/VHS/scale-crop implementados; ajuste fino de safe zone por momento fica para WO-011 |
| Preview reproduz timing do manifesto                                     | **PARCIAL**      | preview reduzida/rendition ainda não gerada; o MP4 final segue o plano                          |
| VFR, rotacionados, codecs diferentes e fontes inválidas sem crash global | **PARCIAL**      | normalização fps/scale e ffprobe; fixtures VFR/rotação/codec dedicadas pendentes                |
| Retry com mesmo plano equivalente, sem sobrescrever mídia aprovada       | **PASS parcial** | saída determinística e objeto por job; idempotência de artefato/GC em WO-012/013                |

## 5. Correções da auditoria

- **B1 crossfade:** `settb=1/30` após cada `concat`/`xfade`; teste de integração real com 4 clipes, 2 crossfades e plano nominal de 90 s → 7 s.
- **B2 READY:** worker passa a operar real por padrão (`WORKER_STUB=1` só explícito); `complete_render_job` rejeita manifesto stub e exige objectKey/SHA-256/1080x1920/H.264/duração.
- **B3 temporários:** o worker cria o temp do job, passa `WORKER_RENDER_TMPDIR` e remove no `finally`, inclusive após cancelamento/kill.
- **B4 segredos:** ffmpeg e ffprobe (incluindo o probe de upload) recebem ambiente mínimo, sem service role/R2/Cloudinary; paths de mídia continuam allowlisted.
- **B5 duração:** a validação usa `max(timelineEndMs)` (não a duração nominal); teste real com 4 clipes, 2 crossfades e plano nominal de 90 s renderiza 7 s.
- **N1/N2/N6/N7:** hash do plano verificado no worker; clips ordenados por timeline/somente track de vídeo; gaps rejeitados; `noise` com seed fixa; profile/pix_fmt validados.
- **N4:** `tsx` movido para dependências de produção do worker.
- **NEW-1:** `sourceIn` é transportado do clipe ordenado, não de `plan.clips[planIndex]`; teste com array embaralhado.
- **B4-R:** `FfprobeVideoProbe` também usa ambiente mínimo; teste garante que nenhum segredo é repassado.

## 6. Limites e riscos

- **Sem áudio final:** vídeo-only; narração/mix/legendas em WO-007/008/009.
- **Sem deploy VPS:** worker real executado localmente/CI com ffmpeg 9.0.2; Oracle tem FFmpeg 7.0.2 e exige instalação/smoke aprovado.
- **R2 real:** caminho de download/upload implementado, mas E2E usa `WORKER_ASSET_DIR`/`WORKER_LOCAL_OUTPUT_DIR`; smoke R2 do worker fica para aprovação de instalação.
- **Processos:** kill tree implementado no worker; validação em Linux real fica para o smoke VPS.
- **Residual WO-005:** lease em start/fail, claim epoch e backoff/aging seguem para WO-013/014, salvo correção em auditoria.
- **Qualidade visual:** presets VHS são conservadores e determinísticos; revisão visual humana ainda necessária.

## 7. Gate

Auditoria independente, CI no head final, Evidence Bundle e checkpoint PROPOSED. WO-007+ bloqueado.
