<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';

	type SelectedFile = {
		key: string;
		file: File;
		sceneId: string;
		status: 'queued' | 'uploading' | 'done' | 'error';
		progress: number;
		message?: string;
		assetId?: string;
	};

	let { data }: PageProps = $props();
	let selectedFiles = $state<SelectedFile[]>([]);
	let uploadError = $state('');
	let uploading = $state(false);
	let resumeSessionId = $state('');
	let resumeInput = $state<HTMLInputElement | null>(null);
	let mounted = $state(false);

	onMount(() => {
		mounted = true;
	});

	const selectedEpisode = $derived(data.selectedEpisode);
	const scenes = $derived(data.scenes);
	const canUpload = $derived(Boolean(data.videoConfigured && selectedEpisode && scenes.length));

	function handleFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (!files.length) return;
		if (files.length > 15) {
			uploadError = 'Selecione no máximo 15 clipes por episódio.';
			input.value = '';
			return;
		}
		selectedFiles = files.map((file, index) => ({
			key: crypto.randomUUID(),
			file,
			sceneId: scenes[index]?.id ?? scenes[0]?.id ?? '',
			status: 'queued',
			progress: 0,
		}));
		input.value = '';
	}

	function moveFile(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= selectedFiles.length) return;
		const copy = [...selectedFiles];
		[copy[index], copy[target]] = [copy[target], copy[index]];
		selectedFiles = copy;
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, current) => current !== index);
	}

	async function sha256Hex(file: File): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
		return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
			'',
		);
	}

	async function uploadOne(item: SelectedFile): Promise<void> {
		if (!selectedEpisode) throw new Error('Selecione um episódio.');
		const idempotencyKey = crypto.randomUUID();
		const fileSha256 = await sha256Hex(item.file);
		const initResponse = await fetch('/api/video/uploads', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				episodeId: selectedEpisode.id,
				sceneId: item.sceneId,
				fileName: item.file.name,
				byteSize: item.file.size,
				contentType: item.file.type || 'video/mp4',
				fileSha256,
				idempotencyKey,
			}),
			signal: AbortSignal.timeout(30_000),
		});
		const init = (await initResponse.json().catch(() => ({}))) as {
			sessionId?: string;
			partSizeBytes?: number;
			parts?: Array<{ partNumber: number; url: string }>;
			message?: string;
		};
		if (!initResponse.ok || !init.sessionId || !init.partSizeBytes || !init.parts)
			throw new Error(init.message ?? 'Não foi possível iniciar o upload.');
		await uploadParts(item, init.sessionId, init.partSizeBytes, init.parts);
	}

	async function uploadParts(
		item: SelectedFile,
		sessionId: string,
		partSizeBytes: number,
		parts: Array<{ partNumber: number; url: string }>,
	): Promise<void> {
		const completed: Array<{ partNumber: number; etag: string }> = [];
		for (const part of parts) {
			const start = (part.partNumber - 1) * partSizeBytes;
			const end = Math.min(item.file.size, start + partSizeBytes);
			const response = await fetch(part.url, {
				method: 'PUT',
				body: item.file.slice(start, end),
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`Falha ao enviar a parte ${part.partNumber}.`);
			const etag = response.headers.get('etag');
			if (!etag) throw new Error('O storage não retornou o ETag da parte.');
			completed.push({ partNumber: part.partNumber, etag });
			const recorded = await fetch(`/api/video/uploads/${sessionId}/parts/${part.partNumber}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ etag }),
				signal: AbortSignal.timeout(15_000),
			});
			if (!recorded.ok) throw new Error('Não foi possível registrar a parte confirmada.');
			item.progress = Math.round((completed.length / parts.length) * 90);
		}
		const completeResponse = await fetch(`/api/video/uploads/${sessionId}/complete`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ parts: completed }),
			signal: AbortSignal.timeout(30_000),
		});
		const complete = (await completeResponse.json().catch(() => ({}))) as {
			asset?: { id?: string };
			validation?: string;
			message?: string;
		};
		if (!completeResponse.ok)
			throw new Error(complete.message ?? 'O upload não pôde ser concluído.');
		item.progress = 100;
		item.assetId = complete.asset?.id;
		if (complete.validation === 'pending_worker')
			item.message = 'Upload recebido e mantido em quarentena até a validação do worker.';
	}

	async function uploadAll() {
		if (uploading || !canUpload) return;
		uploading = true;
		uploadError = '';
		try {
			for (const item of selectedFiles) {
				if (item.status === 'done' || !item.sceneId) continue;
				item.status = 'uploading';
				item.progress = 0;
				item.message = undefined;
				try {
					await uploadOne(item);
					item.status = 'done';
				} catch (cause) {
					item.status = 'error';
					item.message = cause instanceof Error ? cause.message : 'Falha no upload.';
				}
			}
			await invalidateAll();
		} finally {
			uploading = false;
		}
	}

	async function resumeUpload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		const sessionId = resumeSessionId;
		input.value = '';
		if (!file || !sessionId) return;
		uploading = true;
		uploadError = '';
		try {
			const response = await fetch(`/api/video/uploads/${sessionId}`);
			const body = (await response.json().catch(() => ({}))) as {
				session?: { total_bytes?: number; part_size_bytes?: number; file_sha256?: string };
				parts?: Array<{ partNumber: number; url: string }>;
				message?: string;
			};
			if (
				!response.ok ||
				!body.session?.total_bytes ||
				!body.session.part_size_bytes ||
				!body.parts
			)
				throw new Error(body.message ?? 'Sessão não encontrada.');
			if (file.size !== body.session.total_bytes)
				throw new Error('O arquivo selecionado não tem o tamanho da sessão original.');
			const fileSha256 = await sha256Hex(file);
			if (body.session.file_sha256 && fileSha256 !== body.session.file_sha256)
				throw new Error('O arquivo selecionado não é o original desta sessão.');
			const item: SelectedFile = {
				key: crypto.randomUUID(),
				file,
				sceneId: '',
				status: 'uploading',
				progress: 0,
			};
			await uploadParts(item, sessionId, body.session.part_size_bytes, body.parts);
			resumeSessionId = '';
			await invalidateAll();
		} catch (cause) {
			uploadError = cause instanceof Error ? cause.message : 'Não foi possível retomar o upload.';
		} finally {
			uploading = false;
		}
	}

	function statusTone(status: string): 'good' | 'warning' | 'danger' | 'neutral' {
		if (status === 'READY') return 'good';
		if (status === 'QUARANTINED' || status === 'VALIDATING' || status === 'UPLOADING')
			return 'warning';
		if (status === 'REJECTED' || status === 'DELETED') return 'danger';
		return 'neutral';
	}
</script>

<svelte:head><title>Clipes · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="VÍDEO PRIVADO"
	title="Clipes do Flow"
	description="Importe os clipes exportados manualmente, associe cada um a uma cena e preserve o original com SHA-256. Nada é publicado automaticamente."
/>

{#if !data.videoConfigured}
	<div class="setup-note">
		<strong>Storage de vídeo não configurado</strong>
		<p>
			Configure R2 no servidor para habilitar uploads. O bucket é privado e o browser só recebe URLs
			curtas assinadas.
		</p>
	</div>
{/if}

<div class="video-grid">
	<Panel
		eyebrow="EPISÓDIO"
		title="Escolha a produção"
		description="Cada clipe é vinculado a uma cena e a uma versão."
	>
		{#if data.episodes.length}
			<label class="field"
				>Episódio<select
					value={selectedEpisode?.id ?? ''}
					onchange={(event) => goto(resolve(`/app/video?episodeId=${event.currentTarget.value}`))}
				>
					{#each data.episodes as episode (episode.id)}
						<option value={episode.id}>
							#{episode.episode_number} · {episode.title} · {episode.scene_duration_ms / 1000}s
						</option>
					{/each}
				</select></label
			>
			{#if selectedEpisode}
				<p class="muted">
					{scenes.length} cenas · storage {data.storageDriver} · validação {data.probeDriver}
				</p>
			{/if}
		{:else}
			<p class="muted">Crie um episódio e suas cenas antes de importar clipes.</p>
		{/if}
	</Panel>

	<Panel
		eyebrow="IMPORTAÇÃO"
		title="Selecionar clipes"
		description="MP4/MOV H.264, 9:16, 4/6/8 s, até 200 MB por clipe. O arquivo só fica READY após validação."
	>
		{#if !canUpload}
			<p class="muted">Selecione um episódio com cenas e configure o storage para continuar.</p>
		{:else}
			<label class="field"
				>Arquivos de vídeo{#if mounted}<input
						type="file"
						accept="video/mp4,video/quicktime"
						multiple
						onchange={handleFiles}
						disabled={uploading}
					/>{/if}</label
			>
			{#if selectedFiles.length}
				<ol class="upload-list">
					{#each selectedFiles as item, index (item.key)}
						<li>
							<div class="upload-main">
								<strong>{item.file.name}</strong>
								<span class="muted">{(item.file.size / 1024 / 1024).toFixed(1)} MB</span>
							</div>
							<label class="field compact"
								>Cena<select
									bind:value={item.sceneId}
									disabled={uploading || item.status === 'done'}
								>
									{#each scenes as scene (scene.id)}
										<option value={scene.id}>Cena {scene.scene_index}</option>
									{/each}
								</select></label
							>
							<div class="upload-actions">
								<button
									type="button"
									onclick={() => moveFile(index, -1)}
									disabled={uploading || index === 0}>↑</button
								>
								<button
									type="button"
									onclick={() => moveFile(index, 1)}
									disabled={uploading || index === selectedFiles.length - 1}>↓</button
								>
								<button type="button" onclick={() => removeFile(index)} disabled={uploading}
									>Remover</button
								>
							</div>
							{#if item.status === 'uploading'}
								<progress max="100" value={item.progress}></progress>
							{:else if item.status === 'done'}
								<span class="ok">Enviado{item.message ? ` · ${item.message}` : ''}</span>
							{:else if item.status === 'error'}
								<span class="error">{item.message}</span>
							{/if}
						</li>
					{/each}
				</ol>
				<button class="primary-button" type="button" onclick={uploadAll} disabled={uploading}>
					{uploading ? 'Enviando…' : 'Enviar clipes'}
				</button>
			{/if}
		{/if}
		{#if uploadError}<p class="error" role="alert">{uploadError}</p>{/if}
	</Panel>

	{#if data.sessions.length}
		<Panel
			eyebrow="RETOMADA"
			title="Uploads pendentes"
			description="Sessões multipart preservadas no servidor."
		>
			<ul class="session-list">
				{#each data.sessions as session (session.id)}
					<li>
						<span class="mono">{session.id.slice(0, 8)}…</span>
						<span>{session.status}</span>
						<span class="muted">{(session.total_bytes / 1024 / 1024).toFixed(1)} MB</span>
						<button
							type="button"
							onclick={() => {
								resumeSessionId = session.id;
								resumeInput?.click();
							}}
							disabled={uploading}>Retomar</button
						>
					</li>
				{/each}
			</ul>
			<input
				bind:this={resumeInput}
				class="hidden"
				type="file"
				accept="video/mp4,video/quicktime"
				onchange={resumeUpload}
			/>
		</Panel>
	{/if}
</div>

<Panel
	eyebrow="BIBLIOTECA"
	title="Clipes do episódio"
	description="Prévia privada; o original permanece no R2."
>
	{#if data.assets.length}
		<div class="asset-grid">
			{#each data.assets as asset (asset.id)}
				<article class="asset-card">
					<header>
						<div>
							<strong>Cena {asset.scenes?.scene_index ?? '—'} · v{asset.asset_version}</strong>
							<p class="mono">{asset.id.slice(0, 8)}…</p>
						</div>
						<StatusPill label={asset.status} tone={statusTone(asset.status)} />
					</header>
					{#if asset.status === 'READY'}
						<video
							class="video-preview"
							controls
							preload="metadata"
							src={`/api/video/${asset.id}`}
							poster={asset.poster_key ? `/api/video/${asset.id}?poster=1` : undefined}
						>
							<track
								kind="captions"
								srclang="pt"
								label="Sem legendas"
								src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A"
							/>
						</video>
					{:else}
						<div class="video-placeholder">
							{asset.status === 'QUARANTINED'
								? 'Aguardando validação do worker'
								: (asset.safe_error_code ?? 'Clipe indisponível')}
						</div>
					{/if}
					<dl>
						<div>
							<dt>Duração</dt>
							<dd>{asset.duration_ms ? `${asset.duration_ms} ms` : '—'}</dd>
						</div>
						<div>
							<dt>Tamanho</dt>
							<dd>{asset.byte_size ? `${(asset.byte_size / 1024 / 1024).toFixed(1)} MB` : '—'}</dd>
						</div>
						<div>
							<dt>SHA-256</dt>
							<dd class="mono">{asset.sha256 ? `${asset.sha256.slice(0, 12)}…` : '—'}</dd>
						</div>
					</dl>
				</article>
			{/each}
		</div>
	{:else}
		<p class="muted">Nenhum clipe importado para este episódio.</p>
	{/if}
</Panel>

<style>
	.video-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.setup-note {
		margin-bottom: 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid rgb(217 160 90 / 35%);
		border-radius: var(--radius-sm);
		background: rgb(217 160 90 / 8%);
	}

	.setup-note p {
		margin: 0.3rem 0 0;
		color: var(--muted);
	}

	.field {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
		color: var(--muted);
		font-size: 0.78rem;
	}

	.field select,
	.field input {
		width: 100%;
		padding: 0.6rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 3%);
		color: var(--ink);
	}

	.field.compact {
		margin: 0;
	}

	.muted {
		color: var(--muted);
		font-size: 0.78rem;
	}

	.mono {
		font-family: var(--mono);
		font-size: 0.68rem;
	}

	.upload-list,
	.session-list {
		display: grid;
		gap: 0.65rem;
		margin: 0.8rem 0;
		padding: 0;
		list-style: none;
	}

	.upload-list li,
	.session-list li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 2%);
	}

	.upload-main {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	.upload-main strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.upload-actions {
		display: flex;
		gap: 0.3rem;
	}

	.upload-actions button,
	.session-list button {
		min-height: 2rem;
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 3%);
		color: var(--ink);
		cursor: pointer;
	}

	.upload-list progress {
		grid-column: 1 / -1;
		width: 100%;
	}

	.ok {
		grid-column: 1 / -1;
		color: var(--phosphor);
		font-size: 0.76rem;
	}

	.error {
		grid-column: 1 / -1;
		color: #dd7889;
		font-size: 0.76rem;
	}

	.primary-button {
		padding: 0.65rem 0.9rem;
		border: 1px solid rgb(183 63 85 / 45%);
		border-radius: var(--radius-sm);
		background: rgb(183 63 85 / 18%);
		color: var(--ink);
		cursor: pointer;
	}

	.primary-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hidden {
		display: none;
	}

	.asset-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.9rem;
	}

	.asset-card {
		display: grid;
		gap: 0.65rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 2%);
	}

	.asset-card header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.asset-card header p {
		margin: 0.15rem 0 0;
		color: var(--muted);
	}

	.video-preview,
	.video-placeholder {
		width: 100%;
		aspect-ratio: 9 / 16;
		border-radius: var(--radius-sm);
		background: rgb(0 0 0 / 45%);
		object-fit: cover;
	}

	.video-placeholder {
		display: grid;
		place-items: center;
		padding: 0.75rem;
		color: var(--muted);
		font-size: 0.76rem;
		text-align: center;
	}

	.asset-card dl {
		display: grid;
		gap: 0.3rem;
		margin: 0;
	}

	.asset-card dl div {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.asset-card dt,
	.asset-card dd {
		margin: 0;
		font-size: 0.72rem;
	}

	.asset-card dt {
		color: var(--muted);
	}

	@media (max-width: 860px) {
		.video-grid {
			grid-template-columns: 1fr;
		}

		.upload-list li,
		.session-list li {
			grid-template-columns: 1fr;
		}
	}
</style>
