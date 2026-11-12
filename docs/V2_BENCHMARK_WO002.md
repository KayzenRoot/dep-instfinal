# DIF-V2-WO-002 — Benchmark da VPS Oracle ARM64

**Work Order:** `DIF-V2-WO-002` · issue #19 · epic #17
**Status:** benchmark executado; evidência **APPROVED** por auditoria independente em 2026-11-12, com achados não bloqueantes corrigidos neste PR. Checkpoint V2 permanece **PROPOSED — NOT PROMOTED**; WO-003+ segue **BLOCKED** até o contrato de storage/ADR-V2-002 e aprovação do owner.
**Base:** `main` `01405cbb641e7814cbd964157d0814ba4e23d7c7` (após squash-merge do WO-001/PR #46).
**Branch:** `bench/dif-v2-wo-002`.
**Decisão:** **GO CONDICIONAL** para worker FFmpeg na VPS Oracle ARM64 existente, com **concurrency = 1**, `nice`/`ionice`, timeout, cota de disco e fallback 720p. Não é GO para múltiplos renders simultâneos.

## 1. Objetivo e resultado

Medir se a VPS Oracle ARM64 já existente monta um episódio típico 9:16 de 120 s com custo incremental zero, sem degradar os serviços atuais, e decidir GO/NO-GO para o worker em VPS.

O benchmark usou 15 clipes sintéticos de 8 s (1080×1920, 30 fps) e narração/música/SFX sintéticos de 120 s. Foram feitas três execuções completas em 1080×1920 e uma comparação em 720×1280, todas validadas com `ffprobe` e decodificação integral com `-xerror`. Nenhum dado privado, credencial, serviço pago, GPU, daemon ou porta exposta foi usado.

**Resultado:** uma execução 1080×1920 levou **69,65–70,53 s** (média **70,02 s**; RTF **0,58**; **1,72×** realtime), com **364.572 KB** de pico de RSS, **188–191%** de CPU média do processo (2 vCPU = 200% máximo) e **103.939.130 bytes** de saída. A comparação 720×1280 levou **46,55 s** e gerou **31.557.798 bytes**. O VPS tinha **177 GB livres**, **11.924 MB** de RAM e **sem swap**. Os serviços existentes permaneceram ativos e o `9router` healthy; a latência local máxima subiu de 2–3 ms para 5–7 ms durante a carga e voltou ao baseline.

## 2. Ambiente inventariado

| Item     | Valor observado                                                                           |
| -------- | ----------------------------------------------------------------------------------------- |
| Host     | Oracle VPS existente, `Linux nexlabs-server 7.0.0-1015-oracle #16-Ubuntu SMP ... aarch64` |
| CPU      | ARM Neoverse-N1, 2 vCPU, 1 thread/core, 2 cores, 1 socket                                 |
| RAM      | 11.924 MB total; 9.846 MB disponíveis no inventário; **sem swap**                         |
| Disco    | `/dev/sda1` 193 GB; 177 GB livres (9% usado)                                              |
| Limites  | `ulimit -n` 1024; `ulimit -f` ilimitado; sem sudo usado                                   |
| Serviços | `nginx`, `docker`, `containerd`, `code-server@ubuntu` ativos; container `9router` healthy |
| FFmpeg   | 7.0.2-static, aarch64, build johnvansickle, GPLv3 (`--enable-gpl --enable-version3`)      |
| Codecs   | libx264, libx265, AAC nativo, entre outros; sem GPU                                       |
| Acesso   | SSH somente; nenhuma porta nova exposta; nenhum daemon instalado                          |

O FFmpeg/ffprobe estático foi baixado para `$HOME/v2-bench/ffmpeg` (102 MB) e removido ao final. Nenhum pacote de sistema foi instalado ou alterado.

## 3. Metodologia reproduzível

Harness: [`scripts/v2-bench/benchmark.sh`](../scripts/v2-bench/benchmark.sh). Ele aceita `BENCH_ROOT`, `FFMPEG` e `FFPROBE` por ambiente e só remove o próprio `BENCH_ROOT`.

### 3.1 Inputs sintéticos

- 15 clipes `testsrc2` 1080×1920, 30 fps, 8,000 s cada, H.264 `ultrafast` CRF 23, sem áudio.
- `narration.wav`: tom senoidal 210 Hz com tremolo, 120 s, 48 kHz, estéreo.
- `music.wav`: mistura de 330 Hz + 440 Hz, 120 s, 48 kHz, estéreo.
- `sfx.wav`: ruído rosa com bursts a cada 4 s, 120 s, 48 kHz, estéreo.
- Total: **305.106.717 bytes** (291 MiB); geração em **30 s**.
- Manifesto: [`logs/inputs.sha256`](evidence/wo-002/logs/inputs.sha256).

### 3.2 Render

- Concat demuxer dos 15 clipes; escala/pad para o alvo; `setsar=1`, 30 fps, `yuv420p`.
- Mixagem `amix` das três trilhas, `alimiter=0.95`.
- `libx264 -preset veryfast -crf 21`, AAC 192 kbps, 48 kHz, estéreo, `+faststart`, `-t 120`.
- Execução com `nice -n 10`, sem `sudo`, em diretório descartável.
- Medição: `/usr/bin/time -v`, amostragem de `/proc/<pid>/status` a cada 0,5 s, `vmstat 1`, deltas de `/proc/diskstats`, `df`, `free` e `loadavg` antes/depois.
- Validação: `ffprobe` JSON + `ffmpeg -v error -xerror -i output.mp4 -f null -`; falha se duração fora de 120 ± 1 s, proporção diferente de 9:16, áudio ausente/indecodificável ou qualquer stderr de decodificação.

### 3.3 Execuções

- 3 execuções completas em 1080×1920 (`run1`, `run2`, `run3`).
- 1 comparação em 720×1280 (`run720`).
- Testes destrutivos contidos: timeout/kill, input truncado, limite de escrita simulado (`ulimit -f`), saturação de CPU com dois `yes`, e recuperação com render curto válido.

## 4. Resultados

| Run      | Resolução | Wall | Elapsed (`time -v`) |    RTF | Speed |    Max RSS | CPU média |         Saída | Validação |
| -------- | --------- | ---: | ------------------: | -----: | ----: | ---------: | --------: | ------------: | --------- |
| `run1`   | 1080×1920 | 70 s |             69,89 s | 0,5824 | 1,72× | 358.512 KB |      188% | 103.939.130 B | PASS      |
| `run2`   | 1080×1920 | 70 s |             69,65 s | 0,5804 | 1,72× | 362.072 KB |      189% | 103.939.130 B | PASS      |
| `run3`   | 1080×1920 | 71 s |             70,53 s | 0,5877 | 1,71× | 364.572 KB |      188% | 103.939.130 B | PASS      |
| `run720` | 720×1280  | 46 s |             46,55 s | 0,3879 | 2,58× | 214.264 KB |      191% |  31.557.798 B | PASS      |

- Média 1080p: **70,02 s**; variação de **0,88 s** (1,3%).
- CPU do processo: **188–191%** de um máximo de 200% (≈94–95% de 2 vCPU). `vmstat` do sistema: média **88,2–88,6%** por run incluindo a primeira amostra since-boot (**89,3–90,4%** excluindo-a), pico **100%**. A CPU do processo é a média cumulativa do `time -v`; o pico instantâneo do processo não foi medido.
- RAM: pico de RSS **364.572 KB** (356 MiB); HWM consistente. Sobram ~9,5 GB para o sistema.
- Saída 1080p: **99,1 MiB** por episódio; vídeo 6,74 Mbps + áudio 192 kbps; 720p: **30,1 MiB**.
- Determinismo: as três saídas 1080p têm o mesmo SHA-256 `1f0b31a40d3123a670982a0ae1a3d157206036851fe6bd148b931b294ee6f73a`; a 720p tem `f4c624dc98a4c893d4d85708bb8c44eb47c3cd672ed2e7aded3e27c3ee5de28c`.
- `ffprobe`: duração **120,000000 s**, 1 stream de vídeo H.264 1080×1920 a 30/1, 1 stream AAC 48 kHz estéreo; `decode_rc=0` e `decode_log_bytes=0` nas quatro saídas.

## 5. Disco e I/O

- Espaço livre: **177 GB** antes e depois; o benchmark inteiro ocupou **747 MB** e foi removido.
- Throughput de escrita (`dd` 512 MiB, `conv=fdatasync`): **112 MB/s** antes e **111 MB/s** depois.
- Leitura com `O_DIRECT` não é suportada neste FS (`dd: IO error: Invalid input`); a leitura por page cache marcou 9,9 GB/s, número não representativo de disco. A leitura real foi observada por `diskstats`.
- Deltas agregados dos quatro renders: **180,0 MiB lidos** e **592,5 MiB escritos**. A atribuição por run é ruidosa por page cache/writeback (run1 leu 0,2 MiB; run3 leu 124,2 MiB), mas o agregado é compatível com inputs + saídas.
- Reserva recomendada por job: **2 GB** de disco temporário, com verificação antes de iniciar e limpeza em `finally`/trap.

## 6. Falhas e recuperação

| Ensaio                 | Comando/condição                       | Resultado                                                            | Interpretação                                                 |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Timeout/kill           | `timeout -s TERM 8` em render de 120 s | rc **124**; **0 órfãos**; log “Immediate exit requested”             | Processo encerra e não deixa filho; parcial deve ser removido |
| Input truncado         | `head -c 100000 clip_01.mp4`           | rc **183**; “moov atom not found”                                    | Erro claro e não silencioso                                   |
| Disco baixo (simulado) | `ulimit -f 2048` (limite de 2 MiB)     | rc **153** (SIGXFSZ); parcial **2.097.152 B**; log vazio             | Falha segura sem preencher o disco real; parcial removido     |
| Recuperação            | render curto válido após as falhas     | duração **10,000000 s**; PASS                                        | Pipeline volta a operar sem reinício manual                   |
| CPU saturada           | 2× `yes` + render curto                | baseline 6 s; carregado **43 s** (7,17×); recuperado **5 s** (0,83×) | CPU é o gargalo; concorrência >1 não é segura                 |
| Saúde sob carga        | curl local 20128/36401                 | máx. **7 ms** (20128) e **5 ms** (36401); 9router healthy            | Serviços não caíram; latência subiu alguns ms                 |

O teste de “disco baixo” foi uma **simulação segura** com limite de tamanho de arquivo, não o preenchimento do disco real. Preencher 177 GB seria destrutivo e está fora do escopo; o comportamento de erro e a limpeza do parcial foram observados.

> **Nota de rerun:** a primeira execução do teste de timeout (15:25:08) abortou o harness por `pipefail` no `pgrep` (não por falha do FFmpeg). Após corrigir o `pgrep`, o teste foi repetido às 15:26:59; os artefatos retidos são da segunda execução. A primeira tentativa não teve log retido e não deixou processo órfão; a segunda é a evidência preservada.

## 7. Serviços e não degradação

Antes, durante e depois: `nginx`, `docker`, `containerd` e `code-server@ubuntu` ativos; `9router` `running/healthy`; nenhum `ffmpeg` ou `yes` residual; load final **0,43** após ~3 min 19 s de repouso. A latência dos endpoints locais ficou em poucos milissegundos. Não foram usados Portainer, Netdata, portas públicas, nem qualquer alteração de produção.

## 8. FFmpeg, licença e presets

- Binário: **FFmpeg 7.0.2-static**, aarch64, johnvansickle, compilado com GCC 8; configuração inclui `--enable-gpl --enable-version3`, `libx264`, `libx265`, AAC nativo.
- Licença: **GPLv3** por causa de `--enable-gpl --enable-version3` e x264. O benchmark executa o binário como processo separado e **não o distribui**. Se o worker V2 empacotar/distribuir FFmpeg, as obrigações GPL precisam ser tratadas no WO de packaging/licenças; isso não foi decidido aqui.
- Presets medidos: `libx264 veryfast`, CRF 21, `yuv420p`, 30 fps, AAC 192 kbps/48 kHz/estéreo, `+faststart`. Inputs: `ultrafast` CRF 23. O preset final de produto pode mudar após avaliação de qualidade/tamanho; o benchmark fixa uma baseline reproduzível.
- ARM64: o build estático funciona sem dependências; o gargalo é a codificação x264 em CPU, não a arquitetura. Não há GPU.

## 9. Orçamento, limites e concorrência

- **Custo incremental estimado: US$ 0** para compute: VPS Oracle já existente, inputs sintéticos, nenhum serviço pago/GPU/armazenamento novo.
- **Concurrency inicial: 1 job.** Um render já usa ~94% dos 2 vCPU; dois jobs simultâneos tendem a dobrar o wall time e degradar serviços interativos.
- Timeout sugerido: **10 min por episódio** (margem ~8,5× sobre 70 s), com kill do grupo de processos e limpeza de parcial.
- `nice -n 10` e `ionice -c3` (idle) para reduzir impacto; não executar junto de tarefas pesadas.
- Cota de disco: **2 GB** por job; verificar espaço antes; remover inputs/saídas temporárias em sucesso e falha.
- 720p é fallback operacional: 46,55 s e 30,1 MiB, mas ainda satura CPU de forma semelhante.
- Armazenamento/egress do vídeo final **não** está incluído neste custo; depende do ADR-V2-002 (provider/contrato fora do Postgres e fora da política de imagens Cloudinary).
- **Guardas não exercitadas:** o render principal usou apenas `nice -n 10`. `ionice`, timeout de 10 min com kill de grupo, cota/checagem de 2 GB, limite de memória e trap de limpeza de parcial são requisitos do worker (WO-003+) e **não** foram exercitados neste benchmark. O GO mede capacidade bruta; a implementação deve testar essas guardas.
- **Pico de CPU:** `ps -o pcpu` é média cumulativa desde o início do processo, não pico instantâneo. O pico system-wide do `vmstat` foi 100%; o pico do processo não foi medido.
- **Billing:** não consultado. O US$ 0 é uma estimativa de compute sobre a VPS existente; storage/egress e quotas não foram verificados.
- **Hash do FFmpeg:** o SHA-256 do binário não foi registrado antes da remoção. Versão, URL, arquitetura, build e configuração estão no inventário; o hash/supply-chain check fica para o WO de packaging.
- **Probes e `dd`:** as medições de latência (`curl`) e throughput (`dd`) foram comandos manuais, reproduzidos no relatório; não estão no harness. Comandos: `curl -s -o /dev/null -w '%{http_code} %{time_total}' http://127.0.0.1:<porta>/`; escrita `dd if=/dev/zero of=<arquivo> bs=1M count=512 conv=fdatasync`; leitura direta `dd if=<arquivo> of=/dev/null bs=1M iflag=direct` (falhou com “Invalid input” neste FS) e leitura por page cache `dd if=<arquivo> of=/dev/null bs=1M`.
- **Conteúdo do tar:** o tar contém `logs/` e `runs/`; `cleanup.txt` e `script.sha256` ficam no repositório e são cobertos pelo `SHA256SUMS`. Não há vídeos, WAVs ou binários no tar.
- **Cleanup:** o `cleanup()` calcula e imprime o tamanho antes de `rm -rf`; o `bench.log` é parte do diretório descartável e está preservado no tar de evidência; o transcript `cleanup.txt` é a evidência retida da remoção manual.

## 10. Riscos e mitigação

| Risco                           | Evidência                                                    | Mitigação                                                                     |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Saturação de CPU afeta serviços | 2 vCPU; 188–191% do processo; 7,17× de slowdown sob 2× `yes` | Concurrency 1, `nice`/`ionice`, agendamento, timeout, monitorar load          |
| Memória                         | 365 MB de pico; sem swap; 9,8 GB disponíveis                 | Limite de 1 job; monitorar; não elevar concorrência sem novo benchmark        |
| Disco                           | 177 GB livres; 747 MB no teste; escrita 111 MB/s             | Cota 2 GB/job, checagem prévia, limpeza em trap                               |
| Saída grande                    | 99,1 MiB/1080p; 30,1 MiB/720p                                | Decidir preset/bitrate e storage no ADR-V2-002; 720p fallback                 |
| FFmpeg GPL                      | build GPLv3                                                  | Revisão de licença/packaging antes de distribuir; manter processo separado    |
| Falha de input/timeout          | rc 183/124, sem órfãos                                       | Validar inputs, timeout, retry limitado, limpar parcial                       |
| Baixo disco real                | apenas simulado com `ulimit -f`                              | Guard de espaço livre + falha explícita; teste real destrutivo não autorizado |
| Rede/egress                     | não medido                                                   | Medir no WO de storage/integração; não assumir custo zero de tráfego          |

## 11. Fallback sem custo

Se o worker na VPS não for aprovado ou a saturação for inaceitável:

1. **720p na mesma VPS** (46,55 s; 30,1 MiB), mantendo concurrency 1.
2. **Máquina do usuário/offline** com FFmpeg estático (Windows/Linux), sem novo servidor; requer instalação local e script de transferência.
3. **Render assíncrono em horário ocioso** na mesma VPS, com fila e limite de 1 job.
4. **Não contratar GPU/servidor pago** sem autorização separada; nenhuma dessas alternativas foi implementada neste WO.

## 12. Matriz de aceitação

| Critério                                                                                    | Status                       | Evidência                                                                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 3 execuções com tempo, RAM pico, CPU, disco e saída validada por `ffprobe`                  | **PASS**                     | `logs/summary.csv`; `runs/run1..3/{time.txt,ps.log,vmstat.log,diskstats.*,ffprobe.json,validation.txt}`            |
| Orçamento incremental, limites/concurrency e riscos                                         | **PASS (capacidade bruta)**  | Seções 9–10; US$ 0 estimado; concurrency 1; timeout/cota recomendados; guardas não exercitadas no render principal |
| GO com justificativa quantitativa ou NO-GO com alternativa                                  | **PASS**                     | GO condicional; 70 s/120 s, RTF 0,58, 365 MB, 177 GB                                                               |
| Nenhum serviço degradado; temporários removidos                                             | **PASS**                     | `logs/health-*`; latência sob carga; `cleanup.txt`; 747 MB removidos                                               |
| Duração 120 ± 1 s, 9:16, áudio decodificável, sem frames corrompidos                        | **PASS**                     | Quatro `validation.txt` com `pass=1`, `decode_rc=0`, `decode_log_bytes=0`                                          |
| Input defeituoso, timeout/kill, low disk, CPU saturada e recuperação                        | **PASS (low disk simulado)** | `runs/failures/*`; rc 183/124/153; recovery 10 s PASS; stress 7,17×/0,83×                                          |
| CPU/RAM/I/O antes/depois, hashes, scripts e logs completos                                  | **PASS**                     | `logs/inputs.sha256`; hashes de saída; `time.txt`; `vmstat.log`; `diskstats.*`; tar de evidência                   |
| Deliverables: código do escopo, docs, Evidence Bundle, Checkpoint PROPOSED, branch/PR Draft | **PASS**                     | Este documento; `docs/EVIDENCE_BUNDLE.md`; `docs/CHECKPOINT_DELTA.md`; PR Draft                                    |
| Sem secrets, produção, gasto ou provisionamento                                             | **PASS**                     | Nenhum segredo em logs; apenas VPS existente; sem sudo/daemon/porta; US$ 0 estimado                                |
| Auditoria independente                                                                      | **PASS**                     | **APPROVED** em 2026-11-12; achados MEDIUM/LOW não bloqueantes corrigidos ou declarados neste PR                   |

## 13. Evidência e hashes

- Pacote bruto: [`wo-002/wo002-evidence.tar.gz`](evidence/wo-002/wo002-evidence.tar.gz), SHA-256 `8c2a524bdbbeaaefa9977c5c4bb95957cc6c9082e8141a440e140dd9d6c50543`. O pacote foi reempacotado localmente após a correção do `summary.csv`; os logs brutos não foram alterados.
- Logs extraídos: [`wo-002/logs/`](evidence/wo-002/logs/) e [`wo-002/runs/`](evidence/wo-002/runs/).
- `summary.csv` corrigido: colunas `peak_hwm_kb` e `final_pcpu_avg_pct`; a métrica `ps -o pcpu` é média cumulativa, não pico instantâneo. A versão anterior rotulava o HWM como CPU.
- Hashes de saída: `1f0b31a4…ee6f73a` (1080p, três execuções idênticas) e `f4c624dc…5de28c` (720p).
- Hashes dos inputs: `logs/inputs.sha256` (15 clipes + 3 WAVs).
- Script: `scripts/v2-bench/benchmark.sh`, hash `16081535…5ed958` em `evidence/wo-002/script.sha256` (também coberto pelo `SHA256SUMS`).
- Logs de falha: `runs/failures/{timeout,corrupt,disklimit,recovery,stress}.*`.
- `cleanup.txt`: remoção de 747 MB, ausência de processos e serviços ativos.

## 14. Veredito

**GO CONDICIONAL** para o worker FFmpeg na VPS Oracle ARM64 existente, com **1 job concorrente**, `nice`/`ionice`, timeout de 10 min, cota de 2 GB, validação de input e limpeza obrigatória. A decisão é quantitativa: 120 s 9:16 em ~70 s (1,72× realtime), RTF 0,58, 365 MB de pico, 177 GB livres, CPU ~94% de 2 vCPU e custo incremental estimado US$ 0 (sem billing consultado). O ambiente suporta o worker, mas **não** suporta concorrência >1 nem garantia de latência para serviços interativos durante o render. As guardas operacionais (timeout 10 min, kill de grupo, cota 2 GB, limite de memória, `ionice`) **não foram exercitadas** neste benchmark; devem ser implementadas e testadas no WO-003+ antes de produção.

**WO-002 evidência APPROVED**; **WO-003+ permanece BLOCKED** até o contrato de storage/ADR-V2-002 ser aprovado e o owner autorizar o próximo incremento. Este documento não promove checkpoint, não faz deploy de produção (o preview automático do PR não é produção), não cria worker, não altera schema nem contrata serviço. O checkpoint V2 continua **PROPOSED — NOT PROMOTED**.
