# ADR-V2-002 — Storage privado de vídeo (Cloudflare R2)

- **Work Order:** `DIF-V2-WO-003` · issue #20
- **Epic:** #17
- **Base:** `main` `b0f78064a2a5902acc98c20efc92648ec540b7e9` (WO-002 merge, 2026-11-12)
- **Status:** **ACCEPTED pelo owner em 2026-11-12** — escolha explícita de **Cloudflare R2 privado**. Bucket `dif-studio-video-private` criado no dashboard; token R2 escopado e CORS/lifecycle pendentes de conclusão manual. Nenhum gasto pago foi autorizado.
- **Substitui a decisão em aberto:** o item 3 da ADR-V2-001 (“provedor após WO-002”) fica resolvido por esta ADR.

## Estado do provisionamento (2026-11-12)

- [x] Conta Cloudflare autenticada; R2 habilitado.
- [x] Bucket privado `dif-studio-video-private` criado; acesso público não habilitado.
- [ ] Token R2 escopado ao bucket (Object Read & Write) criado e salvo somente no arquivo privado.
- [ ] CORS restrito a `APP_ORIGIN` com `PUT/GET/HEAD` e `ExposeHeaders: ETag`.
- [ ] Lifecycle de quarentena/multipart incompleto configurado.
- [ ] Upload/leitura live validados com 15 clipes sintéticos.

O widget de criação de token do dashboard usa um combobox customizado que não aceita seleção confiável por automação; o OAuth do wrangler não tem escopo para criar tokens. A criação do token é uma etapa manual única; as credenciais não devem ser coladas no chat, em issues, logs ou Git.

## Contexto

O WO-002 mediu a VPS Oracle ARM64 e retornou **GO CONDITIONAL** para render com concorrência 1. A V2 precisa armazenar clipes originais exportados manualmente do Flow, versões e artefatos de vídeo **fora do PostgreSQL** e **fora da política de imagens do Cloudinary**. O storage deve ser privado, owner-only, com URLs curtas, retenção, quota e recuperação.

A escolha do provedor é uma decisão de arquitetura importante. O owner escolheu **Cloudflare R2 privado** em 2026-11-12, após comparar R2, disco da VPS Oracle e Supabase Storage.

## Decisão

Usar **Cloudflare R2** como object storage privado S3-compatible para vídeo, com metadados no Supabase e acesso sempre mediado pelo servidor.

### 1. Bucket e isolamento

- Bucket privado dedicado, nome lógico configurável em `R2_BUCKET`; sugestão: `dif-studio-video-private`.
- **Sem** domínio público, **sem** `r2.dev` público e **sem** bucket público. Todo download passa por rota autenticada ou URL pré-assinada curta.
- Credenciais R2 somente server-side: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`. Nunca no browser, Git, logs, issues ou artefatos.
- Token R2 com escopo mínimo: Object Read & Write **apenas** no bucket de vídeo; sem acesso a outros buckets/contas.
- CORS do bucket restrito ao domínio da aplicação (`APP_ORIGIN`) e a `PUT/GET/HEAD` necessários; sem `*`.

### 2. Layout de objetos

Chaves opacas, sem nome de arquivo do usuário, sem `..`, sem path controlado pelo cliente:

```text
quarantine/{ownerUid}/{uploadId}/source
owners/{ownerUid}/episodes/{episodeId}/scenes/{sceneId}/v{version}/{assetId}.mp4
owners/{ownerUid}/episodes/{episodeId}/scenes/{sceneId}/v{version}/{assetId}.poster.jpg
owners/{ownerUid}/episodes/{episodeId}/manifests/{manifestId}.json
```

- `ownerUid`, `episodeId`, `sceneId`, `assetId`, `uploadId` são UUIDs validados no servidor.
- O cliente nunca escolhe a chave final; o servidor monta a chave a partir de IDs autorizados.
- O objeto nasce em `quarantine/`; só é copiado para `owners/` após validação e transição atômica de status.

### 3. Upload multipart com retomada e idempotência

- `POST /api/video/uploads` cria `video_upload_sessions` e um multipart upload R2 na chave de quarentena.
- O servidor devolve URLs pré-assinadas de `UploadPart` com TTL curto (15 min) e o `uploadId`; o browser envia as partes diretamente ao R2, sem passar pelo corpo da função Vercel.
- Tamanho de parte padrão: 8 MiB; mínimo 5 MiB (exceto última); máximo 200 MiB por clipe; máximo 15 clipes por episódio; máximo 2 GiB por episódio.
- `Idempotency-Key` obrigatório no início; repetição com a mesma chave e o mesmo owner/episódio/cena retorna a mesma sessão, sem duplicar objeto.
- `POST /api/video/uploads/{id}/complete` valida número/tamanho das partes, chama `CompleteMultipartUpload`, calcula SHA-256 do objeto final e cria o `video_assets` em `QUARANTINED`.
- Sessões expiradas são abortadas (`AbortMultipartUpload`) por rotina de reconciliação; partes órfãs não viram asset.
- O browser pode retomar após recarregar a página consultando a sessão e as partes já enviadas; nunca reenvia partes confirmadas.

### 4. Validação antes de publicar

Estados: `UPLOADING → QUARANTINED → VALIDATING → READY` ou `REJECTED`; `DELETED` é tombstone.

- **Magic bytes:** exigir container MP4/MOV reconhecido (`ftyp` em offset 4) e extensão coerente; nunca confiar em MIME/nome do cliente.
- **ffprobe:** executar em ambiente isolado (worker/validator server-side, sem shell), com timeout, path canônico, limites de bytes/tempo/frames e sem rede.
- **Duração:** 4/6/8 s conforme `episode_scenes`/`scene_duration_ms`, tolerância proposta de **±500 ms**; rejeitar zero-byte, truncado, VFR extremo, codec não suportado, resolução não vertical ou dimensões acima do limite.
- **Dimensões:** 9:16 (1080×1920 ou 720×1280), tolerância de 1%; rotação aplicada antes da checagem.
- **SHA-256:** calculado no servidor sobre o objeto final; hash divulgado ao owner e usado em manifesto/backup.
- **Quarentena:** asset `QUARANTINED` não aparece como pronto, não entra em render/export e não tem URL pública.
- **Falha:** `REJECTED` com código seguro e mensagem acionável; objeto de quarentena é removido após retenção curta; nunca deixa referência órfã irrecuperável.
- **WO-003 vs WO-005:** o WO-003 implementa o contrato `VideoProbe` e o fluxo de quarentena; o worker/validador assíncrono com ffprobe real é integrado no WO-005. Até lá, o caminho de produção mantém assets em `QUARANTINED` em vez de marcá-los `READY` sem prova.

### 5. Leitura e miniaturas

- `GET /api/video/{assetId}` verifica owner via Supabase/RLS e responde:
  - `302` para URL pré-assinada R2 com TTL de 60 s, ou
  - stream server-side com `Content-Type` validado, `Content-Length`, `Content-Disposition` seguro, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
- `GET /api/video/{assetId}/poster` segue o mesmo contrato para o poster JPEG.
- Nenhuma URL R2 permanente é devolvida ao browser; logs não registram a URL assinada completa.
- `401/403/404` conforme contrato: não autenticado, não-owner e inexistente não revelam a existência do asset.

### 6. Metadados e RLS

Tabelas aditivas no Supabase:

- `video_upload_sessions`: owner, asset draft, episode/scene, `r2_upload_id`, `object_key` de quarentena, parte/tamanho, status, expiração, `idempotency_key`, timestamps.
- `video_assets`: owner, episode/scene, provider `r2`, bucket, `object_key`, `poster_key`, SHA-256, bytes, duração, codec, container, largura/altura, versão, status, retenção, timestamps, `deleted_at`.
- RLS owner-only em `SELECT/INSERT/UPDATE/DELETE`; `WITH CHECK` garante `owner_id = auth.uid()`; anon sem policy; `service_role` só no servidor/worker.
- Constraint de versão por `(owner_id, episode_id, scene_id, version)`; `scene_id` referencia `episode_scenes`; `episode_id` coerente com o owner.
- Nenhum binário no Postgres; nenhum `service_role` no frontend.

### 7. Retenção, GC e backup

- Originais de cena: retenção padrão **30 dias** após o master aprovado; masters e artefatos de publicação: **90 dias** ou política do owner.
- Exclusão sempre por tombstone (`DELETED` + `deleted_at`), com GC após janela de segurança; nunca `rm` destrutivo sem manifesto/backup.
- Quarentena: abortar multipart incompleto após 24 h; remover objetos rejeitados após 7 dias.
- Backup/restore: metadados no Supabase + manifesto de objetos/SHA-256; restore testado em bucket isolado antes de release.
- Lifecycle R2 para expirar quarentena e multipart incompleto; lifecycle não apaga masters sem política explícita.

### 8. Quotas e custo

- Free tier R2 (verificar no dashboard antes de provisionar): **10 GB-month**, 1 milhão de Class A e 10 milhões de Class B por mês, egress zero. O benchmark de 120 s gerou ~99 MiB por master; clipes originais podem chegar a ~300 MiB/episódio.
- Guardas: 200 MiB/clipe, 2 GiB/episódio, 10 GB/conta; alertar em 80% e bloquear novos uploads em 95% sem upgrade pago.
- **Nenhum upgrade pago, cartão ou cobrança** pode ser ativado sem autorização separada. Se a cota não couber, o WO-003 retorna `BLOCKED` e o owner decide (retenção menor, outro provedor ou upgrade explícito).
- Egress de download é zero no R2; o custo de compute da VPS é o medido no WO-002 (US$ 0 incremental estimado).

### 9. Rollback

- V2 atrás de feature flag; upload/leitura V2 pode ser desligado sem afetar a V1.
- Migrações aditivas; nenhuma alteração destrutiva em tabelas V1.
- Bucket R2 é independente; rollback não apaga objetos. Exclusão em massa exige backup verificado e autorização.
- Se R2 falhar, o upload fica `BLOCKED`/`QUARANTINED`; não há fallback público automático.

## Alternativas e por que não foram escolhidas

| Opção                     | Prós                                              | Contras                                                                                          | Decisão                 |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| **Cloudflare R2 privado** | 10 GB grátis, egress zero, S3, desacoplado da VPS | Exige conta/token R2, CORS, lifecycle; cota finita                                               | **Escolhida**           |
| Disco da VPS Oracle       | 177 GB livres, zero serviço externo               | Sem redundância gerenciada/backup automático; acopla storage ao worker; falha da VPS perde mídia | Rejeitada para produção |
| Supabase Storage          | Auth/RLS integrados                               | Free tier ~1 GB; poucos episódios; Pro pago não autorizado                                       | Rejeitada para produção |
| Cloudinary vídeo          | Já existe conta de imagem                         | Contrato/cota de vídeo não comprovado; política de imagem não é storage de vídeo                 | Rejeitada               |

## Contrato de código (WO-003)

Interface server-side, sem detalhes de R2 vazando para UI:

```ts
interface VideoStorage {
	createMultipart(input: CreateMultipartInput): Promise<MultipartSession>;
	signPart(input: SignPartInput): Promise<SignedPart>;
	completeMultipart(input: CompleteMultipartInput): Promise<StoredObject>;
	abortMultipart(input: AbortMultipartInput): Promise<void>;
	statObject(key: string): Promise<StoredObject>;
	copyToFinal(input: CopyToFinalInput): Promise<StoredObject>;
	signDownload(key: string, ttlSeconds: number): Promise<string>;
	deleteObject(key: string): Promise<void>;
}

interface VideoProbe {
	probe(input: ProbeInput): Promise<ProbeResult>; // container, codec, duration, width, height, rotation, frames
}
```

Implementações: `R2VideoStorage` (produção) e `InMemoryVideoStorage`/fake (testes); `FfprobeVideoProbe` (worker/CI) e `FixtureVideoProbe` (testes). Nenhuma rota aceita chave R2 do cliente.

## Gate de aceite

- [x] Owner escolheu Cloudflare R2 privado em 2026-11-12.
- [ ] Bucket privado, token escopado, CORS e lifecycle provisionados e verificados.
- [ ] Upload multipart com retry/idempotência, quarentena e SHA-256 demonstrados.
- [ ] `video_assets`/`video_upload_sessions` com RLS owner-only e PgTAP.
- [ ] ffprobe/validação com fixtures válidas/inválidas; assets inválidos nunca `READY`.
- [ ] URLs assinadas curtas, `private, no-store`, 401/403/404 e miniaturas protegidas.
- [ ] Quota/GC/retention e restore documentados e testados.
- [ ] Nenhum gasto pago, bucket público, segredo no Git ou deploy de produção.

**Bloqueio atual:** login Cloudflare ausente no ambiente; bucket/token ainda não criados. O código e os testes locais podem avançar com fake storage/probe; a aceitação live do WO-003 fica `BLOCKED` até o provisionamento autorizado.
