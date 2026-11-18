<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { EditPlanClip, VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
	import type {
		EditPlanPreview,
		PlatformProfileId,
		PreviewBox,
	} from '#lib/schemas/platform-preview.js';
	import { moveClips, setClipTransition, trimClips } from '#lib/domain/video-edit-plan.js';
	import { captionTextFitsBox, wrapCtaText } from '#lib/domain/caption-metrics.js';
	import {
		defaultPreview,
		detectPreviewCollisions,
		PLATFORM_PREVIEW_PROFILES,
		resolvePreviewLayout,
	} from '#lib/domain/platform-preview.js';

	let {
		data,
		form,
	}: {
		data: PageData;
		form: { success?: boolean; message?: string; version?: number } | null;
	} = $props();

	let clips = $state<EditPlanClip[]>([]);
	let preview = $state<EditPlanPreview>(defaultPreview());
	let masterGainDb = $state(0);
	let selectedClipIndex = $state(0);
	let playheadMs = $state(0);
	let showOverlay = $state(true);
	let showCover = $state(false);
	let editorKey = $state('');
	let editError = $state<string | null>(null);
	let changeNote = $state('');
	let waveform = $state<number[]>([]);
	let waveformState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let waveformError = $state<string | null>(null);
	let videoElement = $state<HTMLVideoElement | null>(null);
	let previewError = $state<string | null>(null);
	const boxKinds = ['captionBox', 'ctaBox'] as const;
	const boxFields = ['x', 'y', 'width', 'height'] as const;

	$effect(() => {
		const key = `${data.selectedEpisode?.id ?? ''}:${data.storedPlan?.currentVersion ?? 0}:${data.storedPlan?.manifestHash ?? ''}`;
		if (key === editorKey) return;
		editorKey = key;
		clips = data.plan ? data.plan.clips.map((clip) => ({ ...clip })) : [];
		masterGainDb = data.plan?.audio?.masterGainDb ?? 0;
		preview = data.plan?.preview ? structuredClone(data.plan.preview) : defaultPreview();
		selectedClipIndex = 0;
		playheadMs = 0;
		editError = null;
		waveform = [];
		waveformState = 'idle';
		waveformError = null;
	});

	const layout = $derived(resolvePreviewLayout(preview));
	const captionEnabled = $derived(data.plan ? data.plan.captions.template !== 'none' : true);
	const ctaEnabled = $derived(Boolean(data.plan?.cta?.enabled));
	const collisions = $derived(
		detectPreviewCollisions(preview, {
			caption: captionEnabled,
			cta: ctaEnabled,
		}),
	);
	const selectedClip = $derived(clips[selectedClipIndex] ?? clips[0] ?? null);
	const planForSave = $derived<VideoEditPlan | null>(
		data.plan
			? {
					...data.plan,
					clips,
					preview,
					audio: {
						masterGainDb,
						events: data.plan.audio?.events ?? [],
					},
				}
			: null,
	);
	const expectedVersion = $derived(data.storedPlan?.currentVersion ?? 0);
	const currentCue = $derived.by(() => {
		const cues = data.captions?.track.cues ?? [];
		return cues.find((cue) => playheadMs >= cue.startMs && playheadMs < cue.endMs) ?? null;
	});
	const captionCue = $derived(currentCue?.role === 'CTA' ? null : currentCue);
	const ctaCue = $derived(currentCue?.role === 'CTA' ? currentCue : null);
	const captionText = $derived(
		captionCue?.text ?? (ctaCue ? '' : 'Prévia da legenda nesta posição segura.'),
	);
	const ctaText = $derived(
		ctaCue?.text ?? (data.plan?.cta?.enabled ? data.plan.cta.text : 'CTA de duas escolhas'),
	);
	const fitIssues = $derived.by(() => {
		if (!data.plan || !captionEnabled) return [];
		const issues: string[] = [];
		if (captionCue && !captionTextFitsBox(captionCue.text, layout.captionBox))
			issues.push('O texto da legenda não cabe na caixa segura atual.');
		if (ctaCue && !captionTextFitsBox(ctaCue.text, layout.ctaBox))
			issues.push('O texto da CTA não cabe na caixa segura atual.');
		if (ctaEnabled && !ctaCue) {
			for (const chunk of wrapCtaText(ctaText, layout.ctaBox.width - 20))
				if (!captionTextFitsBox(chunk, layout.ctaBox))
					issues.push('O texto da CTA não cabe na caixa segura atual.');
		}
		return [...new Set(issues)];
	});
	const channelReport = $derived(
		Object.values(PLATFORM_PREVIEW_PROFILES).map((profile) => ({
			label: profile.label,
			issues: detectPreviewCollisions(
				{ ...preview, profileId: profile.id },
				{
					caption: captionEnabled,
					cta: ctaEnabled,
				},
			).length,
		})),
	);
	const previewIssues = $derived([
		...fitIssues.map((message) => ({ severity: 'HIGH' as const, message })),
		...collisions.map((collision) => ({
			severity: collision.severity,
			message: collision.message,
		})),
	]);
	const canSave = $derived(
		Boolean(planForSave) &&
			previewIssues.length === 0 &&
			(!captionEnabled || (layout.captionBox.width >= 600 && layout.captionBox.height >= 140)) &&
			(!ctaEnabled || (layout.ctaBox.width >= 500 && layout.ctaBox.height >= 120)),
	);

	function setProfile(profileId: PlatformProfileId) {
		const profile = PLATFORM_PREVIEW_PROFILES[profileId];
		preview = {
			profileId,
			profileVersion: 1,
			captionBox: { ...profile.captionBox },
			ctaBox: { ...profile.ctaBox },
		};
		editError = null;
	}

	function updateBox(kind: 'captionBox' | 'ctaBox', field: keyof PreviewBox, raw: string) {
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		const current = preview[kind] ?? layout[kind];
		const minimumWidth = kind === 'captionBox' ? 600 : 500;
		const minimumHeight = kind === 'captionBox' ? 140 : 120;
		const box: PreviewBox = {
			...current,
			[field]: Math.max(0, Math.round(value)),
		};
		if (field === 'x') box.x = Math.min(box.x, 1_080 - minimumWidth);
		if (field === 'y') box.y = Math.min(box.y, 1_920 - minimumHeight);
		if (field === 'width') box.width = Math.max(minimumWidth, Math.min(1_080 - box.x, box.width));
		if (field === 'height')
			box.height = Math.max(minimumHeight, Math.min(1_920 - box.y, box.height));
		if (box.x + box.width > 1_080) box.width = Math.max(minimumWidth, 1_080 - box.x);
		if (box.y + box.height > 1_920) box.height = Math.max(minimumHeight, 1_920 - box.y);
		preview = { ...preview, [kind]: box };
	}

	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= clips.length) return;
		try {
			clips = moveClips(clips, index, target);
			selectedClipIndex = target;
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
			clips = trimClips(clips, index, sourceInMs, sourceOutMs);
			editError = null;
		} catch (cause) {
			editError = cause instanceof Error ? cause.message : 'Trim inválido.';
		}
	}

	function updateTransition(index: number, value: string) {
		try {
			clips = setClipTransition(clips, index, value === 'crossfade' ? 'crossfade' : 'cut');
			editError = null;
		} catch (cause) {
			editError = cause instanceof Error ? cause.message : 'Transição inválida.';
		}
	}

	function updatePlayhead(event: Event) {
		const element = event.currentTarget as HTMLVideoElement;
		const clip = selectedClip;
		if (!clip) return;
		const sourceOutSeconds = clip.sourceOutMs / 1_000;
		if (element.currentTime >= sourceOutSeconds) {
			element.pause();
			element.currentTime = sourceOutSeconds;
			playheadMs = clip.timelineEndMs;
			return;
		}
		playheadMs =
			clip.timelineStartMs + Math.max(0, Math.round(element.currentTime * 1_000 - clip.sourceInMs));
	}

	function seekPreviewToTrim() {
		const clip = selectedClip;
		const element = videoElement;
		if (!clip || !element || !Number.isFinite(element.duration)) return;
		const start = clip.sourceInMs / 1_000;
		const end = clip.sourceOutMs / 1_000;
		if (element.currentTime < start || element.currentTime >= end) element.currentTime = start;
	}

	$effect(() => {
		seekPreviewToTrim();
	});

	async function loadWaveform() {
		const takeId = data.narration?.takeId;
		if (!takeId || waveformState === 'loading') return;
		waveformState = 'loading';
		waveformError = null;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 20_000);
		try {
			const response = await fetch(`/api/narration/takes/${takeId}`, {
				redirect: 'follow',
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const audioContext = new AudioContext();
			try {
				const decoded = await audioContext.decodeAudioData(await response.arrayBuffer());
				const samples = decoded.getChannelData(0);
				const bars = 96;
				const step = Math.max(1, Math.floor(samples.length / bars));
				const next: number[] = [];
				for (let bar = 0; bar < bars; bar += 1) {
					let peak = 0;
					const start = bar * step;
					const end = Math.min(samples.length, start + step);
					for (let index = start; index < end; index += 1)
						peak = Math.max(peak, Math.abs(samples[index] ?? 0));
					next.push(Math.max(0.04, Math.min(1, peak)));
				}
				waveform = next;
				waveformState = 'ready';
			} finally {
				await audioContext.close();
			}
		} catch (cause) {
			waveformState = 'error';
			waveformError =
				cause instanceof Error
					? `Waveform indisponível (${cause.message}); o render é a fonte de verdade.`
					: 'Waveform indisponível; o render é a fonte de verdade.';
		} finally {
			clearTimeout(timeout);
		}
	}

	function boxStyle(box: PreviewBox) {
		return `left:${(box.x / 1_080) * 100}%;top:${(box.y / 1_920) * 100}%;width:${(box.width / 1_080) * 100}%;height:${(box.height / 1_920) * 100}%`;
	}
</script>

<svelte:head><title>Editor | DIF Studio</title></svelte:head>

<section class="page-head">
	<p class="eyebrow">EDIÇÃO</p>
	<h1>Editor visual</h1>
	<p class="lede">
		Prévia do clipe selecionado com simulação de safe zones. O overlay não entra no MP4; as
		correções aprovadas são salvas no plano versionado.
	</p>
</section>

<form class="episode-picker" method="GET">
	<label for="editor-episode">Episódio</label>
	<select
		id="editor-episode"
		name="episodeId"
		onchange={(event) => event.currentTarget.form?.requestSubmit()}
	>
		{#each data.episodes as episode (episode.id)}
			<option value={episode.id} selected={episode.id === data.selectedEpisode?.id}>
				{episode.seasons?.series?.title ?? 'Série'} · E{episode.episode_number} — {episode.title}
			</option>
		{/each}
	</select>
</form>

{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}
{#if form?.success && form.version}
	<p class="notice success" role="status">Versão {form.version} salva.</p>
{/if}

{#if !data.plan || !planForSave}
	<p class="empty">Crie o episódio e salve a timeline antes de editar.</p>
{:else}
	<div class="editor-toolbar">
		<div>
			<span class="meta-label"
				>Plano v{data.storedPlan?.currentVersion ?? 0} · {data.storedPlan?.currentStatus ??
					'DRAFT'}</span
			>
			{#if data.captions}
				<span class="badge" class:warning={data.captions.status === 'DRAFT'}
					>{data.captions.status}</span
				>
			{/if}
		</div>
		<a class="button" href={resolve(`/app/director?episodeId=${data.selectedEpisode.id}`)}>
			Editar automaticamente
		</a>
		<a class="button" href={resolve(`/app/timeline?episodeId=${data.selectedEpisode.id}`)}>
			Timeline completa
		</a>
	</div>

	{#if editError}<p class="notice error" role="alert">{editError}</p>{/if}
	{#if data.planStale}
		<p class="notice warning" role="status">
			O plano está preso a uma revisão anterior do roteiro. Reconstrua/revise na timeline antes de
			renderizar.
		</p>
	{/if}
	{#if data.plan && !data.plan.preview}
		<p class="notice warning" role="status">
			Este plano é anterior às safe zones. O render mantém o layout histórico de legendas até você
			salvar uma nova versão com as caixas seguras.
		</p>
	{/if}
	{#if data.captions?.status === 'APPROVED'}
		<p class="notice warning" role="status">
			As legendas aprovadas pertencem a esta versão. Salvar correções cria uma nova versão e exige
			reaprovar as legendas antes do render.
		</p>
	{/if}

	<div class="editor-grid">
		<section class="preview-panel" aria-label="Prévia de safe zones">
			<div class="preview-frame">
				{#if selectedClip}
					<video
						bind:this={videoElement}
						src={`/api/video/${selectedClip.assetId}`}
						controls
						playsinline
						preload="metadata"
						ontimeupdate={updatePlayhead}
						onloadedmetadata={seekPreviewToTrim}
						onloadeddata={() => (previewError = null)}
						onerror={() => (previewError = 'Prévia indisponível; o render é a fonte de verdade.')}
					>
						<track
							kind="captions"
							srclang="pt-BR"
							label="Prévia de legendas"
							src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A"
						/>
					</video>
				{/if}
				{#if previewError}<p class="hint" role="alert">{previewError}</p>{/if}
				{#if showOverlay}
					<div class="safe-area" style={boxStyle(layout.profile.safeArea)} aria-hidden="true"></div>
					{#if showCover}
						<div class="cover-crop" style={boxStyle(layout.profile.coverBox)}>
							<span>Crop capa/feed</span>
						</div>
					{/if}
					{#each layout.profile.uiZones as zone (zone.label)}
						<div
							class="ui-zone"
							style={boxStyle(zone)}
							title={`Área simulada: ${zone.label}`}
						></div>
					{/each}
					<div class="caption-box" style={boxStyle(layout.captionBox)}>
						<span>{captionText}</span>
					</div>
					<div class="cta-box" style={boxStyle(layout.ctaBox)}>
						<span>{ctaText}</span>
					</div>
				{/if}
			</div>
			<div class="preview-controls">
				<label
					>Perfil
					<select
						value={preview?.profileId ?? 'tiktok'}
						onchange={(event) => setProfile(event.currentTarget.value as PlatformProfileId)}
					>
						{#each Object.values(PLATFORM_PREVIEW_PROFILES) as profile (profile.id)}
							<option value={profile.id}>{profile.label}</option>
						{/each}
					</select>
				</label>
				<label class="check"
					><input type="checkbox" bind:checked={showOverlay} /> Mostrar overlay</label
				>
				<label class="check"
					><input type="checkbox" bind:checked={showCover} /> Crop capa/feed 4:5</label
				>
			</div>
			<p class="hint">
				{layout.profile.disclaimer} O vídeo acima é o clipe selecionado, não o render composto. Fonte:
				{layout.profile.source} · v{layout.profile.version}.
			</p>
			{#if previewIssues.length}
				<ul class="collisions" aria-label="Colisões de safe zone">
					{#each previewIssues as issue, index (issue.message + index)}
						<li class:danger={issue.severity === 'HIGH'}>
							<span class="severity">{issue.severity}</span>
							{issue.message}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="notice success">Sem colisões de safe zone no perfil atual.</p>
			{/if}
			<ul class="channel-report" aria-label="Relatório por canal">
				{#each channelReport as channel (channel.label)}
					<li class:warning={channel.issues > 0}>
						{channel.label}: {channel.issues} risco(s)
					</li>
				{/each}
			</ul>
		</section>

		<div class="side-panel">
			<section class="panel">
				<h2>Caixas de texto</h2>
				<p class="hint">Coordenadas canônicas 1080 × 1920. Campos funcionam por teclado e touch.</p>
				{#each boxKinds as kind (kind)}
					<fieldset>
						<legend>{kind === 'captionBox' ? 'Legenda' : 'CTA'}</legend>
						<div class="box-grid">
							{#each boxFields as field (field)}
								<label
									>{field}
									<input
										type="number"
										min={field === 'x' || field === 'width' ? 0 : 0}
										max={field === 'x' || field === 'width' ? 1_080 : 1_920}
										value={(preview?.[kind] ?? layout[kind])[field]}
										onchange={(event) => updateBox(kind, field, event.currentTarget.value)}
									/>
								</label>
							{/each}
						</div>
					</fieldset>
				{/each}
			</section>

			<section class="panel">
				<h2>Correções de clipe</h2>
				<ol class="clip-list">
					{#each clips as clip, index (clip.id)}
						<li class:selected={index === selectedClipIndex}>
							<button type="button" class="clip-select" onclick={() => (selectedClipIndex = index)}>
								Cena {index + 1}
							</button>
							<div class="clip-actions">
								<button
									type="button"
									aria-label={`Mover cena ${index + 1} para cima`}
									disabled={index === 0}
									onclick={() => move(index, -1)}>↑</button
								>
								<button
									type="button"
									aria-label={`Mover cena ${index + 1} para baixo`}
									disabled={index === clips.length - 1}
									onclick={() => move(index, 1)}>↓</button
								>
							</div>
							<label
								>Entrada
								<input
									type="number"
									min="0"
									value={clip.sourceInMs}
									onchange={(event) => updateTrim(index, 'sourceInMs', event.currentTarget.value)}
								/>
							</label>
							<label
								>Saída
								<input
									type="number"
									min="100"
									value={clip.sourceOutMs}
									onchange={(event) => updateTrim(index, 'sourceOutMs', event.currentTarget.value)}
								/>
							</label>
							<label
								>Transição
								<select
									value={clip.transition}
									onchange={(event) => updateTransition(index, event.currentTarget.value)}
								>
									<option value="cut">Corte</option>
									<option value="crossfade">Crossfade</option>
								</select>
							</label>
						</li>
					{/each}
				</ol>
			</section>

			<section class="panel">
				<h2>Áudio e faixas</h2>
				<label
					>Ganho master ({masterGainDb.toFixed(1)} dB)
					<input type="range" min="-12" max="6" step="0.5" bind:value={masterGainDb} />
				</label>
				<div class="track-map" aria-label="Mapa simplificado de faixas">
					{#each clips as clip, index (clip.id)}
						<button
							type="button"
							class="clip-block"
							class:selected={index === selectedClipIndex}
							style={`width:${((clip.timelineEndMs - clip.timelineStartMs) / (data.plan.durationMs || 1)) * 100}%`}
							onclick={() => (selectedClipIndex = index)}
							aria-label={`Selecionar cena ${index + 1}`}
						>
							{index + 1}
						</button>
					{/each}
				</div>
				{#if data.narration?.takeId}
					<button type="button" onclick={loadWaveform} disabled={waveformState === 'loading'}>
						{waveformState === 'loading' ? 'Carregando waveform…' : 'Carregar waveform da narração'}
					</button>
					{#if waveformState === 'ready'}
						<div class="waveform" aria-label="Waveform simplificada da narração">
							{#each waveform as height, index (index)}
								<span style={`height:${Math.round(height * 100)}%`}></span>
							{/each}
						</div>
					{/if}
					{#if waveformError}<p class="hint" role="alert">{waveformError}</p>{/if}
				{:else}
					<p class="hint">Sem take de narração; a waveform aparece após a narração ser enviada.</p>
				{/if}
				<p class="hint">
					Mapa de clipes é uma referência de duração, não uma forma de onda de precisão. A fila
					completa e o retry ficam na timeline.
				</p>
				<ul class="track-list" aria-label="Faixas do plano">
					<li>
						Narração:
						<strong>{data.narration?.takeId ? data.narration.status : 'sem take'}</strong>
					</li>
					<li>
						Legendas:
						<strong
							>{data.captions
								? `${data.captions.status} · ${data.captions.track.cues.length} cues`
								: 'sem track nesta versão'}</strong
						>
					</li>
					<li>
						Música/ambiência:
						<strong
							>{(data.plan.audio?.events ?? []).filter((event) =>
								['MUSIC', 'AMBIENCE'].includes(event.kind),
							).length} eventos</strong
						>
					</li>
					<li>
						SFX:
						<strong
							>{(data.plan.audio?.events ?? []).filter((event) => event.kind === 'SFX').length} eventos</strong
						>
					</li>
				</ul>
			</section>

			{#if data.renderJobs.length}
				<section class="panel">
					<h2>Render</h2>
					<ul class="jobs">
						{#each data.renderJobs.slice(0, 3) as job (job.id)}
							<li>
								<span class:warning={['QUEUED', 'CLAIMED', 'RUNNING'].includes(job.status)}>
									{job.status}
								</span>
								v{job.plan_version} · {job.error_code ?? 'sem erro'}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	</div>

	<form method="POST" action="?/save" class="save-form">
		<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
		<input type="hidden" name="expectedVersion" value={expectedVersion} />
		<input type="hidden" name="plan" value={JSON.stringify(planForSave)} />
		<label>Nota da versão <input name="changeNote" maxlength="500" bind:value={changeNote} /></label
		>
		<button class="primary" type="submit" disabled={!canSave}> Salvar correções no plano </button>
		{#if !canSave}<span class="hint">Resolva as colisões HIGH antes de salvar.</span>{/if}
	</form>
{/if}

<style>
	.page-head {
		display: grid;
		gap: 0.5rem;
		margin-block-end: 1.25rem;
	}
	.eyebrow {
		color: var(--accent);
		font-size: 0.75rem;
		letter-spacing: 0.18em;
	}
	h1 {
		font-size: clamp(2rem, 6vw, 3.5rem);
	}
	.lede,
	.hint,
	.meta-label {
		color: var(--muted);
	}
	.lede {
		max-width: 72ch;
	}
	.episode-picker,
	.editor-toolbar,
	.preview-controls,
	.save-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-block: 1rem;
	}
	.editor-toolbar {
		justify-content: space-between;
	}
	select,
	input {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.5rem 0.65rem;
		max-width: 100%;
		min-width: 0;
	}
	.button,
	button {
		cursor: pointer;
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background: var(--surface-strong, #222);
		color: var(--ink);
		padding: 0.5rem 0.8rem;
		text-decoration: none;
	}
	.button {
		display: inline-flex;
		align-items: center;
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
	.editor-grid {
		display: grid;
		grid-template-columns: minmax(280px, 420px) minmax(320px, 1fr);
		gap: 1rem;
		align-items: start;
	}
	.preview-panel,
	.panel {
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
		padding: 0.9rem;
	}
	.preview-frame {
		position: relative;
		aspect-ratio: 9 / 16;
		max-height: 66vh;
		margin-inline: auto;
		background: #050505;
		border-radius: 0.75rem;
		overflow: hidden;
	}
	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.safe-area,
	.ui-zone,
	.caption-box,
	.cta-box {
		position: absolute;
		pointer-events: none;
	}
	.safe-area {
		border: 1px dashed rgb(255 255 255 / 55%);
	}
	.cover-crop {
		position: absolute;
		border: 2px solid #7dd3fc;
		background: rgb(125 211 252 / 8%);
		pointer-events: none;
	}
	.cover-crop span {
		position: absolute;
		top: 0.2rem;
		left: 0.2rem;
		color: #7dd3fc;
		font-size: 0.7rem;
	}
	.channel-report {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.channel-report .warning {
		color: #ffe4a3;
	}
	.ui-zone {
		background: rgb(183 63 85 / 22%);
		border: 1px solid rgb(255 160 174 / 55%);
	}
	.caption-box,
	.cta-box {
		display: grid;
		place-items: center;
		text-align: center;
		padding: 0.4rem;
		background: rgb(0 0 0 / 72%);
		border: 2px solid #f2d479;
		color: #fff;
		font-size: clamp(0.7rem, 2.2vw, 1rem);
		line-height: 1.2;
		overflow: hidden;
	}
	.cta-box {
		border-color: #7dd3fc;
	}
	.caption-box span,
	.cta-box span {
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.side-panel {
		display: grid;
		gap: 0.9rem;
	}
	.panel h2 {
		font-size: 1.05rem;
		margin-block-end: 0.35rem;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		margin-block: 0.6rem;
		padding: 0.5rem;
	}
	legend {
		color: var(--muted);
		font-size: 0.8rem;
		padding-inline: 0.3rem;
	}
	.box-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.4rem;
	}
	.box-grid label,
	.clip-list label,
	.preview-controls label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.72rem;
		min-width: 0;
	}
	.box-grid input,
	.clip-list input,
	.clip-list select,
	.save-form input {
		width: 100%;
		min-width: 0;
	}
	.clip-list {
		display: grid;
		gap: 0.4rem;
		list-style: none;
		padding: 0;
		max-height: 34vh;
		overflow: auto;
	}
	.clip-list li {
		display: grid;
		grid-template-columns: auto auto repeat(3, minmax(4.5rem, 1fr));
		gap: 0.35rem;
		align-items: end;
		border: 1px solid var(--line);
		border-radius: 0.45rem;
		padding: 0.35rem;
	}
	.clip-list li.selected {
		border-color: var(--accent);
	}
	.clip-actions {
		display: flex;
		gap: 0.2rem;
	}
	.clip-actions button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0.35rem 0.5rem;
	}
	.track-map {
		display: flex;
		gap: 2px;
		height: 2.75rem;
		margin-block: 0.6rem;
		background: #080808;
		border-radius: 0.4rem;
		overflow: hidden;
	}
	.clip-block {
		min-width: 1.6rem;
		border: 0;
		border-radius: 0;
		background: #2b2b2b;
		color: #ddd;
		font-size: 0.65rem;
	}
	.clip-block.selected {
		background: var(--accent);
		color: #0b0b0b;
	}
	.waveform {
		display: flex;
		gap: 1px;
		align-items: end;
		height: 4rem;
		background: #080808;
		border-radius: 0.4rem;
		padding: 0.25rem;
	}
	.waveform span {
		flex: 1;
		background: #7dd3fc;
		min-height: 3%;
	}
	.track-list {
		display: grid;
		gap: 0.3rem;
		margin: 0.6rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.track-list strong {
		color: var(--ink);
	}
	.collisions {
		display: grid;
		gap: 0.3rem;
		padding-inline-start: 1.1rem;
		color: #ffb4b4;
	}
	.severity {
		display: inline-block;
		border: 1px solid currentColor;
		border-radius: 0.25rem;
		padding: 0 0.25rem;
		font-size: 0.65rem;
		font-weight: 700;
	}
	.notice {
		padding: 0.65rem 0.8rem;
		border-radius: 0.5rem;
		margin-block: 0.6rem;
	}
	.notice.error,
	li.danger {
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
	.badge {
		margin-inline-start: 0.5rem;
		border: 1px solid #5a5;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		font-size: 0.68rem;
		color: #b8f5c0;
	}
	.badge.warning {
		border-color: #b58a2a;
		color: #ffe4a3;
	}
	.jobs {
		display: grid;
		gap: 0.3rem;
		list-style: none;
		padding: 0;
		font-size: 0.8rem;
	}
	.jobs .warning {
		color: #ffe4a3;
	}
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.4rem;
		align-items: center;
	}
	@media (max-width: 900px) {
		.editor-grid {
			grid-template-columns: 1fr;
		}
		.preview-frame {
			max-height: 70vh;
		}
		.clip-list li {
			grid-template-columns: 1fr 1fr;
		}
		.box-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			scroll-behavior: auto;
		}
	}
</style>
