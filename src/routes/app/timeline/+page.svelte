<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import { retimeClips, reorderClips, trimClip } from '#lib/domain/video-edit-plan.js';
	import type { EditPlanClip, VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
	import type { EditPlanAudioEvent } from '#lib/schemas/audio-library.js';
	import { buildSuspenseAudioTemplate } from '#lib/domain/audio-template.js';
	import type { RenderJob } from '#lib/server/render-jobs.js';

	let { data, form }: { data: PageData; form: { success?: boolean; message?: string } | null } =
		$props();
	let clips = $state<EditPlanClip[]>([]);
	let audioEvents = $state<EditPlanAudioEvent[]>([]);
	let masterGainDb = $state(0);
	let editError = $state<string | null>(null);
	let editorKey = $state('');
	let changeNote = $state('');
	let renderJobs = $state<RenderJob[]>([]);
	let renderEpisodeKey = $state('');
	let renderError = $state<string | null>(null);
	let renderBusy = $state(false);
	let renderProfile = $state<'1080p' | '720p'>('1080p');
	let renderQuality = $state<'standard' | 'high'>('standard');
	type RenderHealth = {
		queued: number;
		claimed: number;
		running: number;
		ready: number;
		failed: number;
		oldestQueuedSeconds: number;
		activeWorker: string | null;
		lastHeartbeatAt: string | null;
	};
	let renderHealth = $state<RenderHealth | null>(null);

	$effect(() => {
		const key = `${data.selectedEpisode?.id ?? ''}:${data.storedPlan?.currentVersion ?? 0}:${data.plan?.episodeId ?? ''}`;
		if (key === editorKey) return;
		editorKey = key;
		clips = data.plan ? data.plan.clips.map((clip) => ({ ...clip })) : [];
		audioEvents = data.plan?.audio?.events?.map((event) => ({ ...event })) ?? [];
		masterGainDb = data.plan?.audio?.masterGainDb ?? 0;
		editError = null;
	});

	$effect(() => {
		const key = data.selectedEpisode?.id ?? '';
		if (key !== renderEpisodeKey) {
			renderEpisodeKey = key;
			renderJobs = [...(data.renderJobs ?? [])];
			void refreshRenderHealth();
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
	const planForSave = $derived<VideoEditPlan | null>(
		data.plan
			? {
					...data.plan,
					clips,
					audio: { masterGainDb, events: audioEvents },
				}
			: null,
	);
	const exportableAudio = $derived(
		(data.audioAssets ?? []).filter(
			(asset) =>
				asset.licenseStatus === 'VERIFIED' && asset.commercialAllowed && asset.socialAllowed,
		),
	);
	const audioAssetById = $derived(
		new Map((data.audioAssets ?? []).map((asset) => [asset.id, asset])),
	);

	async function previewAudioEvent(event: EditPlanAudioEvent, spatial: boolean) {
		const asset = audioAssetById.get(event.assetId);
		if (!asset) return;
		try {
			const response = await fetch(`/api/audio/${asset.id}`);
			if (!response.ok) throw new Error('preview');
			const context = new AudioContext();
			const buffer = await context.decodeAudioData(await response.arrayBuffer());
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.loop = event.loop;
			const gain = context.createGain();
			const start = context.currentTime;
			const duration = event.durationMs / 1000;
			const baseGain = Math.max(0.0001, Math.pow(10, (event.gainDb + masterGainDb) / 20));
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.exponentialRampToValueAtTime(
				baseGain,
				start + Math.max(0.01, event.fadeInMs / 1000),
			);
			if (event.fadeOutMs > 0) {
				const fadeStart = Math.max(0.01, duration - event.fadeOutMs / 1000);
				gain.gain.setValueAtTime(baseGain, start + fadeStart);
				gain.gain.linearRampToValueAtTime(0.0001, start + duration);
			}
			source.connect(gain);
			const panner = context.createStereoPanner();
			panner.pan.value = event.pan;
			let node: AudioNode = gain;
			if (spatial && event.spatialPreset !== 'none') {
				const highpass = context.createBiquadFilter();
				highpass.type = 'highpass';
				highpass.frequency.value =
					event.spatialPreset === 'corridor'
						? 180
						: event.spatialPreset === 'radio'
							? 450
							: event.spatialPreset === 'whisper-side'
								? 700
								: 120;
				const lowpass = context.createBiquadFilter();
				lowpass.type = 'lowpass';
				lowpass.frequency.value =
					event.spatialPreset === 'corridor'
						? 6000
						: event.spatialPreset === 'radio'
							? 3000
							: event.spatialPreset === 'steps-behind'
								? 3500
								: 5000;
				node.connect(highpass);
				highpass.connect(lowpass);
				node = lowpass;
			}
			node.connect(panner);
			panner.connect(context.destination);
			if (
				spatial &&
				(event.spatialPreset !== 'none' || event.spatialMode === 'binaural_simulated')
			) {
				const echoDelay = context.createDelay(0.3);
				echoDelay.delayTime.value =
					event.spatialPreset === 'steps-behind'
						? 0.032
						: event.spatialPreset === 'corridor'
							? 0.018
							: event.spatialPreset === 'radio'
								? 0.012
								: 0.003 + event.distance * 0.012;
				const feedback = context.createGain();
				feedback.gain.value = event.spatialPreset === 'none' ? 0 : 0.16;
				panner.connect(echoDelay);
				echoDelay.connect(feedback);
				feedback.connect(echoDelay);
				echoDelay.connect(context.destination);
			}
			source.start(start, event.loop ? 0 : event.sourceInMs / 1000);
			source.stop(start + duration);
			setTimeout(() => void context.close(), event.durationMs + 300);
		} catch {
			editError = 'Não foi possível reproduzir a prévia deste áudio.';
		}
	}

	function addAudioEvent() {
		const asset = exportableAudio[0];
		if (!asset) return;
		const durationMs = Math.min(5_000, asset.durationMs);
		audioEvents = [
			...audioEvents,
			{
				id: crypto.randomUUID(),
				assetId: asset.id,
				kind: asset.kind,
				startMs: 0,
				durationMs,
				sourceInMs: 0,
				gainDb: asset.kind === 'MUSIC' ? -18 : -6,
				fadeInMs: 300,
				fadeOutMs: 300,
				pan: 0,
				distance: 0.5,
				loop: asset.kind === 'AMBIENCE',
				ducking: asset.kind !== 'SFX',
				spatialPreset: 'none',
				spatialMode: 'stereo_pan',
			},
		];
	}

	function changeAudioAsset(index: number, assetId: string) {
		const asset = audioAssetById.get(assetId);
		if (!asset) return;
		audioEvents = audioEvents.map((event, position) =>
			position === index
				? {
						...event,
						assetId,
						kind: asset.kind,
						durationMs: Math.min(event.durationMs, asset.durationMs),
						ducking: asset.kind !== 'SFX',
						spatialPreset: 'none',
						spatialMode: 'stereo_pan',
					}
				: event,
		);
	}

	function updateAudioEvent(index: number, patch: Partial<EditPlanAudioEvent>) {
		audioEvents = audioEvents.map((event, position) => {
			if (position !== index) return event;
			const next = { ...event, ...patch };
			if (patch.assetId !== undefined) return next;
			if (patch.spatialPreset !== undefined) {
				next.spatialMode = patch.spatialPreset === 'none' ? 'stereo_pan' : 'binaural_simulated';
			}
			return next;
		});
	}

	function removeAudioEvent(index: number) {
		audioEvents = audioEvents.filter((_, position) => position !== index);
	}

	function applySuspenseTemplate() {
		if (!data.plan) return;
		try {
			const template = buildSuspenseAudioTemplate({
				durationMs: data.plan.durationMs,
				assets: data.audioAssets ?? [],
			});
			audioEvents = template.events;
			masterGainDb = template.masterGainDb;
			editError = null;
		} catch (cause) {
			editError = cause instanceof Error ? cause.message : 'Template de áudio indisponível.';
		}
	}

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
		void refreshRenderHealth();
	}

	async function refreshRenderHealth() {
		const response = await fetch('/api/render-jobs/health');
		if (!response.ok) return;
		const payload = (await response.json()) as { health?: RenderHealth };
		renderHealth = payload.health ?? null;
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
					outputProfile: renderProfile,
					quality: renderQuality,
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

	function renderQaLabel(job: RenderJob): string | null {
		const qa = job.output_manifest?.qa as
			{ status?: string; summary?: { warn?: number; blocked?: number } } | undefined;
		if (!qa?.status) return null;
		const warnings = qa.summary?.warn ?? 0;
		return `QA: ${qa.status}${warnings ? ` · ${warnings} aviso(s)` : ''}`;
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
	{#if data.selectedEpisode}
		<a class="finale-link" href={resolve(`/app/finale?episodeId=${data.selectedEpisode.id}`)}>
			Montar final A/B do episódio <span aria-hidden="true">↗</span>
		</a>
	{/if}
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

		<section class="audio-editor" aria-label="Trilha e efeitos">
			<div class="audio-head">
				<div>
					<h2>Trilha e efeitos</h2>
					<p class="meta-label">
						Narração prioritária; música/ambiência com ducking; SFX limitados. Biblioteca
						licenciada:
						<a href={resolve('/app/audio')}>gerenciar áudio</a>
					</p>
				</div>
				<div class="audio-head-actions">
					<button type="button" onclick={applySuspenseTemplate}>Template suspense 120 s</button>
					<label
						>Ganho master (dB)
						<input
							type="number"
							min="-12"
							max="6"
							step="0.5"
							value={masterGainDb}
							oninput={(event) => (masterGainDb = Number(event.currentTarget.value))}
						/>
					</label>
				</div>
			</div>
			{#if !exportableAudio.length}
				<p class="notice warning">
					Nenhum áudio com licença verificada e direitos comercial/social. Importe na
					<a href={resolve('/app/audio')}>biblioteca de áudio</a> antes de adicionar eventos.
				</p>
			{:else}
				<button type="button" onclick={addAudioEvent}>Adicionar evento de áudio</button>
			{/if}
			{#if audioEvents.length}
				<ol class="audio-list">
					{#each audioEvents as event, index (event.id)}
						{@const asset = audioAssetById.get(event.assetId)}
						<li>
							<header>
								<strong>Evento {index + 1}</strong>
								<span class="meta-label">{event.kind}</span>
								<button type="button" class="link" onclick={() => removeAudioEvent(index)}>
									Remover
								</button>
							</header>
							<div class="audio-grid">
								<label
									>Áudio
									<select
										value={event.assetId}
										onchange={(changeEvent) =>
											changeAudioAsset(index, changeEvent.currentTarget.value)}
									>
										{#each exportableAudio as audioAsset (audioAsset.id)}
											<option value={audioAsset.id}>{audioAsset.title}</option>
										{/each}
									</select>
								</label>
								<label
									>Início (ms)
									<input
										type="number"
										min="0"
										max={data.plan.durationMs - 100}
										value={event.startMs}
										oninput={(changeEvent) =>
											updateAudioEvent(index, {
												startMs: Math.max(0, Number(changeEvent.currentTarget.value)),
											})}
									/>
								</label>
								<label
									>Duração (ms)
									<input
										type="number"
										min="100"
										max={data.plan.durationMs}
										value={event.durationMs}
										oninput={(changeEvent) =>
											updateAudioEvent(index, {
												durationMs: Math.max(100, Number(changeEvent.currentTarget.value)),
											})}
									/>
								</label>
								<label
									>Ganho (dB)
									<input
										type="number"
										min="-60"
										max="12"
										step="0.5"
										value={event.gainDb}
										oninput={(changeEvent) =>
											updateAudioEvent(index, { gainDb: Number(changeEvent.currentTarget.value) })}
									/>
								</label>
								<label
									>Fade in (ms)
									<input
										type="number"
										min="0"
										max="10000"
										value={event.fadeInMs}
										oninput={(changeEvent) =>
											updateAudioEvent(index, {
												fadeInMs: Math.max(0, Number(changeEvent.currentTarget.value)),
											})}
									/>
								</label>
								<label
									>Fade out (ms)
									<input
										type="number"
										min="0"
										max="10000"
										value={event.fadeOutMs}
										oninput={(changeEvent) =>
											updateAudioEvent(index, {
												fadeOutMs: Math.max(0, Number(changeEvent.currentTarget.value)),
											})}
									/>
								</label>
								<label
									>Pan <span class="meta-label">{event.pan.toFixed(2)}</span>
									<input
										type="range"
										min="-1"
										max="1"
										step="0.05"
										value={event.pan}
										oninput={(changeEvent) =>
											updateAudioEvent(index, { pan: Number(changeEvent.currentTarget.value) })}
									/>
								</label>
								<label
									>Distância <span class="meta-label">{event.distance.toFixed(2)}</span>
									<input
										type="range"
										min="0"
										max="1"
										step="0.05"
										value={event.distance}
										oninput={(changeEvent) =>
											updateAudioEvent(index, {
												distance: Number(changeEvent.currentTarget.value),
											})}
									/>
								</label>
								<label
									>Preset espacial
									<select
										value={event.spatialPreset}
										onchange={(changeEvent) =>
											updateAudioEvent(index, {
												spatialPreset: changeEvent.currentTarget
													.value as EditPlanAudioEvent['spatialPreset'],
											})}
									>
										<option value="none">Nenhum</option>
										<option value="corridor">Corredor estreito</option>
										<option value="radio">Rádio distante</option>
										<option value="steps-behind">Passos atrás</option>
										<option value="whisper-side">Sussurro lateral</option>
									</select>
								</label>
								<label class="check"
									><input
										type="checkbox"
										checked={event.loop}
										onchange={(changeEvent) =>
											updateAudioEvent(index, { loop: changeEvent.currentTarget.checked })}
									/> Loop</label
								>
								<label class="check"
									><input
										type="checkbox"
										checked={event.kind !== 'SFX' && event.ducking}
										disabled={event.kind === 'SFX'}
										onchange={(changeEvent) =>
											updateAudioEvent(index, { ducking: changeEvent.currentTarget.checked })}
									/> Ducking (música/ambiência)</label
								>
							</div>
							<div class="preview-row">
								<span class="meta-label">
									{asset
										? `${asset.durationMs} ms · ${asset.licenseName} · ${event.spatialMode}`
										: 'Áudio indisponível'}
								</span>
								<button type="button" onclick={() => void previewAudioEvent(event, false)}>
									A · normal
								</button>
								<button type="button" onclick={() => void previewAudioEvent(event, true)}>
									B · soundscape
								</button>
								<span class="meta-label"
									>prévia aproximada a partir dos mesmos parâmetros salvos; o render é a referência
									e não é 3D nativo</span
								>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
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
				{#if renderHealth}
					<p class="meta-label">
						Fila: {renderHealth.queued} na fila · {renderHealth.running} executando ·
						{renderHealth.failed} falha(s){renderHealth.oldestQueuedSeconds > 0
							? ` · mais antigo ${Math.round(renderHealth.oldestQueuedSeconds)}s`
							: ''}{renderHealth.activeWorker
							? ` · worker ${renderHealth.activeWorker}`
							: renderHealth.queued > 0
								? ' · worker sem lease'
								: ''}
					</p>
				{/if}
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
			<div class="render-options">
				<label
					>Saída
					<select bind:value={renderProfile}>
						<option value="1080p">1080×1920</option>
						<option value="720p">720×1280 (fallback)</option>
					</select>
				</label>
				<label
					>Qualidade
					<select bind:value={renderQuality}>
						<option value="standard">Padrão</option>
						<option value="high">Alta</option>
					</select>
				</label>
				<button class="primary" type="button" onclick={enqueueRender} disabled={!canRender}>
					Renderizar plano aprovado
				</button>
			</div>
			{#if renderProfile === '720p'}
				<p class="notice warning">
					Fallback 720×1280: use só quando o aparelho/player exigir; a qualidade final é menor que
					1080×1920.
				</p>
			{/if}
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
							<span>{job.output_profile} · {job.quality}</span>
							{#if renderQaLabel(job)}
								<span>{renderQaLabel(job)}</span>
							{/if}
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
	.finale-link {
		width: fit-content;
		color: var(--phosphor);
		font-size: 0.8rem;
		text-decoration: none;
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
	.render-options {
		display: flex;
		gap: 0.75rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.render-options label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.72rem;
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
	.audio-editor {
		display: grid;
		gap: 0.75rem;
		margin-block-start: 1.5rem;
		border-block-start: 1px solid var(--line);
		padding-block-start: 1rem;
	}
	.audio-head {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: end;
	}
	.audio-head input {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.55rem 0.7rem;
	}
	.audio-head-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: end;
	}
	.audio-list {
		display: grid;
		gap: 0.75rem;
		list-style: none;
		padding: 0;
	}
	.audio-list li {
		display: grid;
		gap: 0.6rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		padding: 0.85rem;
		background: var(--surface);
	}
	.audio-list header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
	}
	.audio-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.6rem;
		align-items: end;
	}
	.audio-grid label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.78rem;
	}
	.audio-grid input,
	.audio-grid select {
		background: var(--surface-strong, #191919);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.45rem 0.55rem;
	}
	.audio-grid .check {
		display: flex;
		flex-direction: row;
		gap: 0.4rem;
		align-items: center;
	}
	.preview-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	button.link {
		background: none;
		border: 0;
		color: var(--accent);
		padding: 0;
	}
	@media (max-width: 640px) {
		.clip-card header,
		.history li {
			flex-direction: column;
		}
	}
</style>
