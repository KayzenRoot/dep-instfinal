<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import { retimeClips, reorderClips, trimClip } from '#lib/domain/video-edit-plan.js';
	import type { EditPlanClip, VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
	import type { RenderJob } from '#lib/server/render-jobs.js';

	let { data, form }: { data: PageData; form: { success?: boolean; message?: string } | null } =
		$props();
	let clips = $state<EditPlanClip[]>([]);
	let editError = $state<string | null>(null);
	let editorKey = $state('');
	let changeNote = $state('');
	let renderJobs = $state<RenderJob[]>([]);
	let renderEpisodeKey = $state('');
	let renderError = $state<string | null>(null);
	let renderBusy = $state(false);

	$effect(() => {
		const key = `${data.selectedEpisode?.id ?? ''}:${data.storedPlan?.currentVersion ?? 0}:${data.plan?.episodeId ?? ''}`;
		if (key === editorKey) return;
		editorKey = key;
		clips = data.plan ? data.plan.clips.map((clip) => ({ ...clip })) : [];
		editError = null;
	});

	$effect(() => {
		const key = data.selectedEpisode?.id ?? '';
		if (key !== renderEpisodeKey) {
			renderEpisodeKey = key;
			renderJobs = [...(data.renderJobs ?? [])];
		}
	});

	$effect(() => {
		const active = renderJobs.some((job) => ['QUEUED', 'CLAIMED', 'RUNNING'].includes(job.status));
		if (!active) return;
		const timer = setInterval(() => void refreshRenderJobs(), 2000);
		return () => clearInterval(timer);
	});

	const sceneIndex = $derived(
		new Map((data.context?.scenes ?? []).map((scene) => [scene.id, scene.sceneIndex])),
	);
	const assetVersion = $derived(
		new Map((data.context?.assets ?? []).map((asset) => [asset.id, asset.assetVersion])),
	);
	const computedEndMs = $derived(
		clips.length > 0 ? Math.max(...clips.map((clip) => clip.timelineEndMs)) : 0,
	);
	const expectedVersion = $derived(data.storedPlan?.currentVersion ?? 0);
	const canRender = $derived(
		data.storedPlan?.currentStatus === 'APPROVED' && !data.planStale && !renderBusy,
	);
	const planForSave = $derived<VideoEditPlan | null>(data.plan ? { ...data.plan, clips } : null);

	function apply(next: EditPlanClip[], errorCode = 'Timeline inválida.') {
		try {
			clips = retimeClips(next);
			editError = null;
		} catch (cause) {
			editError = cause instanceof Error ? cause.message : errorCode;
		}
	}

	function move(index: number, delta: number) {
		try {
			const ordered = reorderClips(clips, index, index + delta).map((clip, position) =>
				position === 0 ? { ...clip, transition: 'cut' as const, transitionMs: 0 } : clip,
			);
			clips = retimeClips(ordered);
			editError = null;
		} catch (cause) {
			editError = cause instanceof Error ? cause.message : 'Não foi possível reordenar.';
		}
	}

	function updateTrim(index: number, field: 'sourceInMs' | 'sourceOutMs', raw: string) {
		const value = Number(raw);
		const clip = clips[index];
		if (!clip || !Number.isInteger(value)) return;
		const sourceInMs = field === 'sourceInMs' ? value : clip.sourceInMs;
		const sourceOutMs = field === 'sourceOutMs' ? value : clip.sourceOutMs;
		try {
			apply(
				clips.map((entry, position) =>
					position === index ? trimClip(entry, sourceInMs, sourceOutMs) : entry,
				),
			);
		} catch (cause) {
			editError = cause instanceof Error ? cause.message : 'Trim inválido.';
		}
	}

	function updateTransition(index: number, value: string) {
		const transition = value === 'crossfade' ? 'crossfade' : 'cut';
		apply(
			clips.map((clip, position) =>
				position === index
					? {
							...clip,
							transition,
							transitionMs:
								transition === 'cut'
									? 0
									: Math.max(
											1,
											Math.min(500, Math.floor((clip.sourceOutMs - clip.sourceInMs) / 4)),
										),
						}
					: clip,
			),
		);
	}

	function updateTransitionMs(index: number, raw: string) {
		const value = Number(raw);
		if (!Number.isInteger(value)) return;
		apply(
			clips.map((clip, position) => (position === index ? { ...clip, transitionMs: value } : clip)),
		);
	}

	async function refreshRenderJobs() {
		if (!data.selectedEpisode) return;
		const response = await fetch(
			`/api/render-jobs?episodeId=${encodeURIComponent(data.selectedEpisode.id)}`,
		);
		if (!response.ok) return;
		const payload = (await response.json()) as { jobs?: RenderJob[] };
		renderJobs = payload.jobs ?? [];
	}

	async function enqueueRender() {
		if (!data.selectedEpisode || !canRender) return;
		renderBusy = true;
		renderError = null;
		try {
			const response = await fetch('/api/render-jobs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					episodeId: data.selectedEpisode.id,
					idempotencyKey: `ui:${crypto.randomUUID()}`,
				}),
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => ({}))) as { message?: string };
				renderError = payload.message ?? 'Não foi possível enfileirar o render.';
				return;
			}
			await refreshRenderJobs();
		} catch {
			renderError = 'Não foi possível enfileirar o render.';
		} finally {
			renderBusy = false;
		}
	}

	function renderAudioLabel(job: RenderJob): string | null {
		const audio = job.output_manifest?.audio as
			{ paddedMs?: number; trimmedMs?: number } | undefined;
		if (!audio) return null;
		return `áudio: ${audio.paddedMs ?? 0} ms de pad, ${audio.trimmedMs ?? 0} ms de corte`;
	}

	async function cancelRender(jobId: string) {
		renderBusy = true;
		renderError = null;
		try {
			const response = await fetch(`/api/render-jobs/${jobId}`, { method: 'DELETE' });
			if (!response.ok) {
				const payload = (await response.json().catch(() => ({}))) as { message?: string };
				renderError = payload.message ?? 'Não foi possível cancelar o render.';
				return;
			}
			await refreshRenderJobs();
		} catch {
			renderError = 'Não foi possível cancelar o render.';
		} finally {
			renderBusy = false;
		}
	}
</script>

<svelte:head><title>Timeline | DIF Studio</title></svelte:head>

<section class="page-head">
	<p class="eyebrow">MONTAGEM</p>
	<h1>Timeline canônica</h1>
	<p class="lede">Versione a montagem sem alterar o roteiro, as escolhas ou o cânone publicado.</p>
</section>

<form class="episode-picker" method="GET">
	<label for="timeline-episode">Episódio</label>
	<select
		id="timeline-episode"
		name="episodeId"
		onchange={(event) => event.currentTarget.form?.requestSubmit()}
	>
		{#each data.episodes as episode (episode.id)}
			<option value={episode.id} selected={episode.id === data.selectedEpisode?.id}>
				{episode.seasons?.series?.title ?? 'Série'} · T{episode.seasons?.title ?? '?'} · E
				{episode.episode_number} — {episode.title}
			</option>
		{/each}
	</select>
	<noscript><button type="submit">Carregar</button></noscript>
</form>

{#if form?.message}
	<p class="notice error" role="alert">{form.message}</p>
{:else if data.planError}
	<p class="notice error" role="alert">{data.planError}</p>
{:else if form?.success}
	<p class="notice success" role="status">Plano salvo.</p>
{/if}

{#if !data.episodes.length}
	<p class="empty">Crie um episódio antes de montar a timeline.</p>
{:else if !data.selectedEpisode}
	<p class="empty">Selecione um episódio.</p>
{:else if !data.plan || !planForSave}
	<p class="empty">
		Não foi possível montar o plano padrão. Verifique os clipes READY do episódio.
	</p>
{:else}
	<section class="plan-meta" aria-label="Estado do plano">
		<div>
			<span class="meta-label">Status</span>
			<strong>{data.storedPlan?.currentStatus ?? 'NÃO SALVO'}</strong>
		</div>
		<div>
			<span class="meta-label">Versão</span>
			<strong>{data.storedPlan?.currentVersion ?? 0}</strong>
		</div>
		<div>
			<span class="meta-label">Duração montada</span>
			<strong>{computedEndMs} ms / {data.plan.durationMs} ms</strong>
		</div>
		<div class="meta-hash">
			<span class="meta-label">Manifest hash</span>
			<code
				>{data.storedPlan?.manifestHash?.slice(0, 16) ?? 'será calculado no primeiro save'}…</code
			>
		</div>
	</section>

	{#if data.planStale}
		<div class="notice warning" role="status">
			<p>
				O plano está preso a uma revisão anterior do episódio. Reconstrua para adotar o roteiro
				atual; os ajustes manuais serão substituídos pelo plano padrão.
			</p>
			<form method="POST" action="?/rebuild">
				<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
				<input type="hidden" name="expectedVersion" value={expectedVersion} />
				<button type="submit">Reconstruir para a revisão atual</button>
			</form>
		</div>
	{/if}

	{#if editError}
		<p class="notice error" role="alert">{editError}</p>
	{/if}

	<form method="POST" action="?/save" class="editor-form">
		<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
		<input type="hidden" name="expectedVersion" value={expectedVersion} />
		<input type="hidden" name="plan" value={JSON.stringify(planForSave)} />
		<input type="hidden" name="changeNote" value={changeNote} />

		<div class="editor-toolbar">
			<label for="change-note">Nota da versão</label>
			<input
				id="change-note"
				type="text"
				maxlength="500"
				bind:value={changeNote}
				placeholder="Ex.: reordenei o plano de abertura"
			/>
			<button class="primary" type="submit" disabled={Boolean(editError) || data.planStale}>
				Salvar nova versão
			</button>
		</div>

		<ol class="clip-list">
			{#each clips as clip, index (clip.id)}
				<li class="clip-card" data-scene-index={sceneIndex.get(clip.sceneId) ?? '?'}>
					<header>
						<div>
							<p class="clip-kicker">CENA {sceneIndex.get(clip.sceneId) ?? '?'}</p>
							<h2>Clipe v{assetVersion.get(clip.assetId) ?? '?'}</h2>
						</div>
						<div class="clip-actions">
							<button type="button" onclick={() => move(index, -1)} disabled={index === 0}>
								↑
							</button>
							<button
								type="button"
								onclick={() => move(index, 1)}
								disabled={index === clips.length - 1}
							>
								↓
							</button>
						</div>
					</header>
					<div class="clip-grid">
						<label>
							Origem início (ms)
							<input
								type="number"
								min="0"
								value={clip.sourceInMs}
								onchange={(event) => updateTrim(index, 'sourceInMs', event.currentTarget.value)}
							/>
						</label>
						<label>
							Origem fim (ms)
							<input
								type="number"
								min="1"
								value={clip.sourceOutMs}
								onchange={(event) => updateTrim(index, 'sourceOutMs', event.currentTarget.value)}
							/>
						</label>
						<div>
							<span class="meta-label">Timeline</span>
							<p>{clip.timelineStartMs}–{clip.timelineEndMs} ms</p>
						</div>
						<label>
							Transição
							<select
								value={clip.transition}
								disabled={index === 0}
								onchange={(event) => updateTransition(index, event.currentTarget.value)}
							>
								<option value="cut">Corte</option>
								<option value="crossfade">Crossfade</option>
							</select>
						</label>
						<label>
							Transição (ms)
							<input
								type="number"
								min="0"
								max="1000"
								value={clip.transitionMs}
								disabled={clip.transition !== 'crossfade'}
								onchange={(event) => updateTransitionMs(index, event.currentTarget.value)}
							/>
						</label>
					</div>
				</li>
			{/each}
		</ol>
	</form>

	<section class="plan-actions" aria-label="Ações do plano">
		{#if data.storedPlan?.currentStatus === 'DRAFT'}
			<form method="POST" action="?/status">
				<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
				<input type="hidden" name="expectedVersion" value={expectedVersion} />
				<input type="hidden" name="status" value="APPROVED" />
				<button type="submit">Aprovar plano atual</button>
			</form>
		{:else if data.storedPlan?.currentStatus === 'APPROVED'}
			<form method="POST" action="?/status">
				<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
				<input type="hidden" name="expectedVersion" value={expectedVersion} />
				<input type="hidden" name="status" value="DRAFT" />
				<button type="submit">Reabrir como DRAFT</button>
			</form>
		{/if}
	</section>

	<section class="render-section" aria-label="Renderização">
		<div class="render-head">
			<div>
				<h2>Render</h2>
				<p class="meta-label">Fila owner-only, 1 job simultâneo, lease e retry.</p>
				{#if data.narration?.status === 'APPROVED' && data.narration.takeId}
					<p class="meta-label narration-ok">
						Narração aprovada v{data.narration.currentVersion} · take
						{data.narration.take?.source ?? '—'} · {data.narration.take?.duration_ms ?? 0} ms
					</p>
				{:else}
					<p class="meta-label">
						Sem narração aprovada: este render será vídeo-only.
						<a href={resolve(`/app/narration?episodeId=${data.selectedEpisode.id}`)}
							>Abrir narração</a
						>
					</p>
				{/if}
			</div>
			<button class="primary" type="button" onclick={enqueueRender} disabled={!canRender}>
				Renderizar plano aprovado
			</button>
		</div>
		{#if renderError}<p class="notice error" role="alert">{renderError}</p>{/if}
		{#if !renderJobs.length}
			<p class="empty">Nenhum render enfileirado.</p>
		{:else}
			<ul class="render-list">
				{#each renderJobs as job (job.id)}
					<li>
						<div>
							<strong>{job.status}</strong>
							<span>v{job.plan_version} · tentativa {job.attempts}/{job.max_attempts}</span>
							{#if renderAudioLabel(job)}
								<span>{renderAudioLabel(job)}</span>
							{/if}
							{#if job.error_code}<code>{job.error_code}</code>{/if}
						</div>
						{#if ['QUEUED', 'CLAIMED', 'RUNNING'].includes(job.status)}
							<button type="button" onclick={() => cancelRender(job.id)} disabled={renderBusy}>
								Cancelar
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="history" aria-label="Versões do plano">
		<h2>Versões</h2>
		{#if !data.versions.length}
			<p class="empty">A primeira versão será criada ao salvar.</p>
		{:else}
			<ul>
				{#each data.versions as version (version.id)}
					<li>
						<div>
							<strong>v{version.version}</strong>
							<span>{version.change_note || 'Sem nota'}</span>
							<time datetime={version.created_at}
								>{version.created_at.slice(0, 16).replace('T', ' ')}</time
							>
						</div>
						<form method="POST" action="?/restore">
							<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
							<input type="hidden" name="version" value={version.version} />
							<input type="hidden" name="expectedVersion" value={expectedVersion} />
							<button type="submit">Restaurar</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.page-head {
		display: grid;
		gap: 0.5rem;
		margin-block-end: 1.5rem;
	}
	.eyebrow {
		color: var(--accent);
		font-size: 0.75rem;
		letter-spacing: 0.18em;
	}
	h1 {
		font-size: clamp(2rem, 6vw, 3.5rem);
	}
	.lede {
		max-width: 62ch;
		color: var(--muted);
	}
	.episode-picker,
	.editor-toolbar,
	.plan-actions,
	.history {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-block: 1rem;
	}
	.episode-picker select,
	.editor-toolbar input,
	.clip-grid input,
	.clip-grid select {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.55rem 0.7rem;
	}
	.episode-picker select {
		min-width: min(34rem, 100%);
	}
	.plan-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.75rem;
		margin-block: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
	}
	.meta-label,
	.clip-kicker {
		display: block;
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.narration-ok {
		color: var(--accent);
	}
	.meta-hash code {
		word-break: break-all;
	}
	.notice {
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin-block: 0.75rem;
	}
	.notice.error {
		border: 1px solid #d55;
		color: #ffb4b4;
		background: #2a1212;
	}
	.notice.success {
		border: 1px solid #5a5;
		color: #b8f5c0;
		background: #102a16;
	}
	.notice.warning {
		border: 1px solid #b58a2a;
		color: #ffe4a3;
		background: #2a210f;
	}
	.notice.warning form {
		margin-block-start: 0.6rem;
	}
	.empty {
		color: var(--muted);
		margin-block: 1rem;
	}
	.clip-list {
		display: grid;
		gap: 0.75rem;
		list-style: none;
		padding: 0;
	}
	.clip-card {
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--surface);
	}
	.clip-card header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: start;
	}
	.clip-card h2 {
		font-size: 1.1rem;
	}
	.clip-actions {
		display: flex;
		gap: 0.35rem;
	}
	.clip-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
		margin-block-start: 0.75rem;
	}
	.clip-grid label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
	button {
		cursor: pointer;
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background: var(--surface-strong, #222);
		color: var(--ink);
		padding: 0.45rem 0.7rem;
	}
	button.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: #0b0b0b;
		font-weight: 700;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.history ul {
		display: grid;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
		width: 100%;
	}
	.history li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		border-block-end: 1px solid var(--line);
		padding-block: 0.5rem;
	}
	.history li div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.history time {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.render-section {
		margin-block: 1.5rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
	}
	.render-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.render-list {
		display: grid;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
		margin-block-start: 0.75rem;
	}
	.render-list li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		border-block-end: 1px solid var(--line);
		padding-block: 0.5rem;
	}
	.render-list div {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.render-list code {
		color: var(--muted);
	}
	@media (max-width: 640px) {
		.clip-card header,
		.history li {
			flex-direction: column;
		}
	}
</style>
