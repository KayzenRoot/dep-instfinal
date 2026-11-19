<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import {
		COLOR_PRESET_LIST,
		colorPreviewCss,
		effectiveColorStrength,
	} from '#lib/domain/color-grade.js';
	import type { ColorGrade, ColorOverride } from '#lib/schemas/color-grade.js';

	let { data, form }: PageProps = $props();
	let presetId = $state<ColorGrade['presetId']>('neutral');
	let strength = $state(60);
	let referenceClipId = $state('');
	let overrides = $state<ColorOverride[]>([]);
	let loadedKey = $state('');

	$effect(() => {
		const key = `${data.selectedEpisode?.id ?? ''}:${data.plan?.version ?? 0}`;
		if (key === loadedKey) return;
		loadedKey = key;
		presetId = data.color?.presetId ?? 'neutral';
		strength = data.color?.strength ?? 60;
		referenceClipId = data.color?.referenceClipId ?? '';
		overrides = data.color ? data.color.overrides.map((override) => ({ ...override })) : [];
	});

	const grade = $derived<ColorGrade>({
		presetId,
		presetVersion: 1,
		strength,
		referenceClipId: referenceClipId || null,
		overrides,
	});
	const selectedPreset = $derived(COLOR_PRESET_LIST.find((preset) => preset.id === presetId));
	const referenceClip = $derived(
		data.clips.find((clip) => clip.id === referenceClipId) ?? data.clips[0] ?? null,
	);
	const previewCss = $derived(
		colorPreviewCss(
			referenceClip
				? { ...grade, strength: effectiveColorStrength(grade, referenceClip.id) }
				: grade,
		),
	);

	function overrideFor(clipId: string): ColorOverride | undefined {
		return overrides.find((override) => override.clipId === clipId);
	}

	function updateOverride(clipId: string, patch: Partial<ColorOverride>): void {
		const current = overrideFor(clipId) ?? { clipId, strength, exclude: false };
		const next = { ...current, ...patch };
		const without = overrides.filter((override) => override.clipId !== clipId);
		overrides = next.exclude || next.strength !== strength ? [...without, next] : without;
	}

	function clampStrength(value: number): number {
		return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : strength;
	}
</script>

<svelte:head><title>Color Match · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="COLOR MATCH · PRESETS"
	title="Cor e textura"
	description="Presets declarativos aplicados no render FFmpeg. A prévia lateral usa CSS aproximado; o MP4 renderizado é a referência."
/>

<form class="episode-picker" method="GET">
	<label for="color-episode">Episódio</label>
	<select
		id="color-episode"
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
{#if data.notice?.kind === 'saved'}
	<p class="notice success" role="status">
		Cor salva na versão {data.notice.version}. Aprove o plano e reaprove as legendas antes do
		render.
	</p>
{:else if data.notice?.kind === 'cleared'}
	<p class="notice success" role="status">
		Cor removida na versão {data.notice.version}. A nova versão é DRAFT: aprove o plano e reaprove
		as legendas antes do render. O vídeo original continua preservado no histórico.
	</p>
{/if}

{#if !data.plan || !data.clips.length}
	{#if !data.loadError}
		<p class="empty">Salve uma timeline com clipes READY antes de usar o Color Match.</p>
		<a href={resolve('/app/timeline')}>Abrir timeline</a>
	{/if}
{:else}
	<div class="grid">
		<section class="panel" aria-label="Prévia antes e depois">
			<h2>Antes / depois</h2>
			{#if referenceClip}
				<div class="compare">
					<figure>
						<video
							src={`/api/video/${referenceClip.assetId}`}
							controls
							playsinline
							preload="metadata"
						>
							<track
								kind="captions"
								srclang="pt-BR"
								label="Prévia"
								src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A"
							/>
						</video>
						<figcaption>Original</figcaption>
					</figure>
					<figure>
						<video
							src={`/api/video/${referenceClip.assetId}`}
							controls
							playsinline
							preload="metadata"
							style={`filter:${previewCss}`}
						>
							<track
								kind="captions"
								srclang="pt-BR"
								label="Prévia"
								src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A"
							/>
						</video>
						<figcaption>Preset aproximado (CSS)</figcaption>
					</figure>
				</div>
			{/if}
			<p class="hint">
				Prévia por CSS para comparação rápida; o FFmpeg aplica eq/colorbalance/noise/vignette no
				render e também mantém a camada VHS global do episódio, que não aparece nesta prévia. A
				fonte nunca é alterada.
			</p>
		</section>

		<section class="panel">
			<h2>Preset</h2>
			<form method="POST" action="?/save" class="grade-form">
				<input type="hidden" name="episodeId" value={data.selectedEpisode?.id ?? ''} />
				<input type="hidden" name="expectedVersion" value={data.plan?.version ?? 0} />
				<input type="hidden" name="overrides" value={JSON.stringify(overrides)} />
				<label>
					Preset
					<select name="presetId" bind:value={presetId}>
						{#each COLOR_PRESET_LIST as preset (preset.id)}
							<option value={preset.id}>{preset.label} · v{preset.version}</option>
						{/each}
					</select>
				</label>
				<p class="hint">{selectedPreset?.description}</p>
				<label>
					Intensidade global: {strength}%
					<input type="range" name="strength" min="0" max="100" step="5" bind:value={strength} />
				</label>
				<label>
					Referência criativa
					<select name="referenceClipId" bind:value={referenceClipId}>
						<option value="">Primeira cena (sem referência fixa)</option>
						{#each data.clips as clip (clip.id)}
							<option value={clip.id}>{clip.label}</option>
						{/each}
					</select>
				</label>
				<p class="hint">
					A referência ancora a comparação antes/depois; não copia histograma de outra cena nem
					altera o clipe fonte.
				</p>
				<fieldset>
					<legend>Ajuste por cena</legend>
					<ul class="scene-list">
						{#each data.clips as clip (clip.id)}
							{@const override = overrideFor(clip.id)}
							<li>
								<strong>{clip.label}</strong>
								<label class="check">
									<input
										type="checkbox"
										aria-label={`Excluir ${clip.label} da correção`}
										checked={override?.exclude ?? false}
										onchange={(event) =>
											updateOverride(clip.id, { exclude: event.currentTarget.checked })}
									/>
									Excluir
								</label>
								<label>
									Força
									<input
										type="number"
										min="0"
										max="100"
										aria-label={`Força da correção em ${clip.label}`}
										value={override?.strength ?? strength}
										onchange={(event) => {
											const raw = event.currentTarget.value;
											if (raw.trim() === '') {
												event.currentTarget.value = String(override?.strength ?? strength);
												return;
											}
											updateOverride(clip.id, { strength: clampStrength(Number(raw)) });
										}}
									/>
								</label>
							</li>
						{/each}
					</ul>
				</fieldset>
				<button class="primary" type="submit" disabled={!data.plan}
					>Salvar correção cromática</button
				>
			</form>
			<form method="POST" action="?/clear" class="clear-form">
				<input type="hidden" name="episodeId" value={data.selectedEpisode?.id ?? ''} />
				<input type="hidden" name="expectedVersion" value={data.plan?.version ?? 0} />
				<button type="submit" disabled={!data.color}>Remover correção (voltar ao original)</button>
			</form>
			<p class="hint">
				Salvar ou remover cria nova versão DRAFT; aprove o plano e reaprove as legendas antes de
				renderizar.
			</p>
		</section>
	</div>
{/if}

<style>
	.episode-picker {
		display: grid;
		gap: 0.35rem;
		margin-block: 1rem;
	}
	.episode-picker select {
		width: 100%;
		max-width: 100%;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1rem;
		align-items: start;
	}
	.panel {
		display: grid;
		gap: 0.7rem;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.compare {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	figure {
		margin: 0;
		display: grid;
		gap: 0.25rem;
	}
	video {
		width: 100%;
		max-height: 20rem;
		background: #050505;
		border-radius: var(--radius-sm);
	}
	figcaption {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.grade-form,
	.clear-form {
		display: grid;
		gap: 0.6rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		margin: 0;
		padding: 0.6rem;
	}
	.scene-list {
		display: grid;
		gap: 0.4rem;
		padding: 0;
		margin: 0;
		list-style: none;
		max-height: 20rem;
		overflow: auto;
	}
	.scene-list li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.75rem;
	}
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.3rem;
		align-items: center;
	}
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.notice {
		padding: 0.65rem 0.8rem;
		border-radius: var(--radius-sm);
		margin-block: 0.6rem;
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
	.empty {
		color: var(--muted);
		margin-block: 1rem;
	}
</style>
