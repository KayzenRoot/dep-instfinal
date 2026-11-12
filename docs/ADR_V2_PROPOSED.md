# ADR-V2-001 — Arquitetura de pós-produção da V2 (PROPOSED)

- **Work Order:** `DIF-V2-WO-001` · issue #18
- **Epic:** #17
- **Base:** `main` `13467ab009e0eaaee1be6ba2e35678228cfbdf32` (2026-11-12)
- **Status:** **PROPOSED — NÃO ACEITO, NÃO IMPLEMENTADO**
- **Aceite necessário:** o owner deve aceitar explicitamente esta ADR antes de qualquer WO-002 ou código de vídeo.

## Contexto

A V1 está em produção privada em `https://dif-studio.vercel.app`, com SvelteKit SSR, Supabase Auth/PostgreSQL owner-only + RLS, Cloudinary privado para imagens, Gemini opt-in e Flow/CapCut manual. A V2 adiciona pós-produção: importar clipes exportados manualmente do Flow, montar timeline, narrar, legendar, mixar áudio, aplicar cor/VHS, revisar, renderizar MP4 vertical e empacotar publicação manual.

A V2 não pode degradar a V1, não pode renderizar 120 s dentro de função HTTP serverless e não pode presumir Cloudinary gratuito para vídeo. O orçamento incremental alvo é **US$ 0**, condicionado a benchmark real de CPU, memória, disco, armazenamento e cotas.

## Decisões propostas

1. **UI e orquestração:** manter SvelteKit na Vercel; o browser só recebe publishable key e URLs curtas assinadas. Nenhum `service_role`, segredo de worker ou binário privado no cliente.
2. **Fonte de verdade:** Supabase PostgreSQL para metadados, timeline, versões, estado de job, votos e cânone; RLS owner-only em todas as tabelas novas. Nenhum vídeo em PostgreSQL.
3. **Vídeos:** armazenamento privado fora do Postgres e fora do Cloudinary de imagens. O provedor será escolhido **somente após WO-002**; candidatos: disco privado da VPS Oracle com links assinados pelo worker, ou object storage compatível com S3/R2 se a cota gratuita for comprovada. Nenhuma escolha é final nesta ADR.
4. **Render:** worker FFmpeg/ffprobe isolado, CPU-first, em ambiente separado da função HTTP. Candidato primário: VPS Oracle ARM64 existente, **sujeito a benchmark e autorização de acesso**. Alternativas: worker local no computador do owner (fallback operacional) ou container gerenciado pago (fora do escopo até autorização de gasto).
5. **Concorrência e recuperação:** um job por worker inicialmente; fila com lease, heartbeat, timeout, cancelamento de processo filho, retry limitado e idempotência. Jobs órfãos são reconciliados; artefatos parciais não viram `READY`.
6. **Qualidade de saída:** master 9:16 1080×1920, H.264/AAC, `yuv420p`; fallback 720p somente se o benchmark provar necessidade e o owner aceitar. QA por ffprobe, amostragem visual, análise de áudio e revisão humana.
7. **Direção:** motor determinístico offline para plano de edição; Gemini apenas opt-in, com JSON validado e guardrails. A IA sugere, não executa shell/SQL/FFmpeg, não canoniza e não inventa métricas.
8. **Áudio:** narração importada ou TTS local comprovado; SRT/ASS por alinhamento real; música/SFX com licença e atribuição; ducking/limiter; soundscape **estéreo espacial simulado**, nunca Dolby Atmos.
9. **Publicação:** somente pacote manual (MP4, capa, SRT, descrição, hashtags, atribuições, disclosure). Nenhuma postagem automática, login TikTok/Instagram ou scraping.
10. **V1 preservada:** V2 atrás de feature flag; migrações aditivas; episódios publicados, votos verificados, lore e histórico intocados; rollback para V1 sempre possível.

## Alternativas avaliadas

| Opção                                                           | Custo incremental                         | Disponibilidade                      | Segurança/isolamento                       | Esforço | Adequação                                         |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ | ------------------------------------------ | ------- | ------------------------------------------------- |
| A. Vercel UI + Supabase + worker Oracle ARM64 + storage privado | US$ 0 se a VPS existente tiver capacidade | Depende da VPS e da rede             | Alta, se o worker for isolado e owner-only | Médio   | **Proposta primária, sujeita a WO-002**           |
| B. Worker no computador do owner                                | US$ 0                                     | Baixa (máquina precisa estar ligada) | Média (segredos locais, sem exposição)     | Baixo   | Fallback operacional, não produção assíncrona     |
| C. Container/serviço gerenciado                                 | Potencialmente pago                       | Alta                                 | Alta                                       | Médio   | Fora do escopo até autorização de gasto           |
| D. Render dentro da função Vercel                               | US$ 0 no Hobby, mas inviável              | Baixa                                | Baixa para jobs longos                     | Baixo   | **Rejeitada**: timeout/memória/resposta           |
| E. Cloudinary para vídeo                                        | Não comprovado no Free                    | Média                                | Média                                      | Médio   | **Rejeitada por ora**: não presumir cota/contrato |

## Consequências

**Positivas:** mantém a V1 intacta; separa UI de render; permite custo zero condicionado a benchmark; mantém mídia privada e owner-only; permite rollback.

**Negativas:** adiciona um worker e uma fila; exige benchmark ARM64 e contrato de storage; aumenta a superfície de segurança; a disponibilidade depende da VPS/máquina; o limite de resposta da Vercel continua afetando downloads grandes.

## Contratos de segurança obrigatórios

- Owner único: UID allowlist + claim assinada `app_metadata.dif_studio_owner=true`; RLS `USING`/`WITH CHECK` em todas as tabelas V2.
- Worker com credencial server-side de escopo mínimo; nenhum segredo no browser, em logs, artefatos ou issues.
- Upload de vídeo: validação real de container/codec/PTS, limites de tamanho/duração/dimensões, nomes gerados, path-safe, rejeição de mídia maliciosa e SSRF.
- FFmpeg: argumentos montados por allowlist, sem interpolação de shell; paths canônicos; timeout; kill do processo filho; logs sem fala privada.
- Storage: links curtos assinados, `private, no-store`, autorização em toda leitura/download, retenção e remoção verificável.
- Filas: token de job de curta duração, idempotency key, lease/heartbeat, retry limitado, cancelamento e reconciliação de órfãos.
- Quotas: limite por owner, tamanho total, jobs simultâneos, retenção e alerta antes de esgotar disco/cota.
- Backup/restore: metadados no Supabase, binários no storage, manifesto por hash; restore testado antes de release.

## Riscos e mitigação

| Risco                                      | Impacto                   | Mitigação                                                                     |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------- |
| VPS Oracle sem CPU/RAM/disco suficientes   | Render lento ou inviável  | WO-002 mede 3 execuções; fallback 720p ou worker local; BLOCKED se não passar |
| FFmpeg ARM64 sem build/filtros necessários | Falha de render           | Benchmark de filtros reais; build oficial/verificado; registrar licença       |
| Storage gratuito insuficiente              | Perda de clipes/artefatos | Medir consumo; retenção; escolher provedor só após benchmark                  |
| Vazamento de segredo do worker             | Acesso a mídia privada    | Credencial server-side, escopo mínimo, rotação, logs sanitizados              |
| Job preso/órfão                            | Fila travada              | Lease/heartbeat/timeout/cancel/retry/reconciliação                            |
| Vercel response limit em ZIP/MP4           | Download falha            | Download por arquivo/lite; MP4 fora da função; limites explícitos             |
| Licença de música/SFX                      | Bloqueio de publicação    | Biblioteca licenciada, atribuições e checklist                                |
| TTS local indisponível                     | Sem narração automática   | Narração importada manual; fallback honesto                                   |
| Métricas fabricadas                        | Decisão errada            | Somente agregados manuais com data/denominador; sem causalidade               |
| Escopo criativo crescer                    | Atraso/duplicidade        | 28 WOs e 20 melhorias com ownership 1:1; sem WOs extras                       |

## Gate de aceite

Esta ADR só sai de **PROPOSED** quando o owner declarar aceite explícito de:

- [ ] arquitetura UI/orquestração + worker separado + storage privado;
- [ ] meta US$ 0 condicionada ao benchmark e proibição de gasto não autorizado;
- [ ] FFmpeg CPU-first, sem GPU obrigatória, com fallback 720p somente se aprovado;
- [ ] Gemini estritamente opt-in, sem custo obrigatório e sem executar comandos;
- [ ] V1 preservada e V2 atrás de feature flag;
- [ ] WO-002 autorizada a medir a VPS Oracle ARM64 (sem alterar firewall/Portainer de produção sem autorização separada).

Até esse aceite, **nenhuma WO-002+ pode começar** e nenhuma migração/tabela de vídeo pode ser criada.
