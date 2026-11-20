<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, untrack } from 'svelte';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import StyleConfigFields from './StyleConfigFields.svelte';
	import { DEFAULT_STYLE_CONFIG, STYLE_FIELDS } from '#lib/domain/style-bible.js';

	let { data, form }: PageProps = $props();
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let scopeType = $state<'SERIES' | 'SEASON'>(untrack(() => data.scopeType));
	let scopeId = $state(untrack(() => data.scopeId));
	const scopeOptions = $derived(
		scopeType === 'SERIES'
			? data.context.series.map((series) => ({ id: series.id, label: series.title }))
			: data.context.seasons.map((season) => ({
					id: season.id,
					label: `${season.seriesTitle} · ${season.title}`,
				})),
	);

	const selectedPreset = $derived(data.selectedPreset);
	const latest = $derived(selectedPreset?.revisions[0] ?? null);
	const approved = $derived(selectedPreset?.approved ?? null);
	const selectedEpisode = $derived(
		data.context.episodes.find((episode) => episode.id === data.episodeId) ?? null,
	);
	const episodeOverride = $derived(
		data.context.episodeOverrides.find((entry) => entry.episodeId === data.episodeId) ?? null,
	);
	const sceneOverride = $derived(
		data.context.sceneOverrides.find(
			(entry) => entry.episodeId === data.episodeId && entry.sceneId === data.selectedSceneId,
		) ?? null,
	);
	const selectedScene = $derived(
		data.scenes.find((scene) => scene.id === data.selectedSceneId) ?? null,
	);
	const sourceLabels: Record<string, string> = {
		DEFAULT: 'padrão',
		SERIES: 'série',
		SEASON: 'temporada',
		EPISODE: 'episódio',
		SCENE: 'cena',
	};
	const fieldLabels: Record<string, string> = {
		paletteBackground: 'Fundo',
		paletteForeground: 'Texto',
		paletteAccent: 'Accent',
		paletteMuted: 'Secundário',
		colorPresetId: 'Color grade',
		colorStrength: 'Força da cor',
		fontFamily: 'Tipografia',
		captionTemplate: 'Legenda',
		captionSafeZone: 'Área segura',
		motion: 'Movimento',
		reducedMotion: 'Movimento reduzido',
		vhsIntensity: 'Intensidade VHS',
		sfxCategory: 'SFX',
		sfxAssetIds: 'Assets de SFX',
		voiceStyle: 'Voz',
		openingHookKind: 'Abertura',
		coverTemplateId: 'Capa',
		endCardTemplateId: 'Final A/B',
		ctaPrompt: 'CTA',
	};
	const warningLabels: Record<string, string> = {
		STYLE_PRESET_MISSING:
			'Nenhum preset aprovado na série/temporada: o plano usará apenas overrides e padrões.',
		STYLE_SFX_UNAVAILABLE: 'Um SFX do preset não está mais disponível.',
		STYLE_SFX_LICENSE: 'Um SFX do preset perdeu licença comercial/social.',
	};

	function noticeText(value: string): string {
		const labels: Record<string, string> = {
			preset: 'Preset salvo como DRAFT.',
			approved: 'Preset aprovado em nova revisão.',
			restored: 'Revisão anterior restaurada como DRAFT.',
			duplicated: 'Preset duplicado para o escopo escolhido.',
			imported: 'Preset importado como DRAFT.',
			override: 'Override do episódio salvo.',
			'scene-override': 'Override da cena salvo.',
		};
		return labels[value] ?? 'Alteração salva.';
	}

	function scopeName(type: string, id: string): string {
		if (type === 'SERIES')
			return data.context.series.find((row) => row.id === id)?.title ?? 'Série';
		const season = data.context.seasons.find((row) => row.id === id);
		return season ? `${season.seriesTitle} · ${season.title}` : 'Temporada';
	}

	function onScopeTypeChange(): void {
		const options =
			scopeType === 'SERIES'
				? data.context.series.map((series) => series.id)
				: data.context.seasons.map((season) => season.id);
		scopeId = options[0] ?? '';
	}
</script>

<svelte:head><title>Estilo · DIF Studio</title></svelte:head>
<span hidden data-testid="style-hydrated" data-hydrated={hydrated}></span>
<PageHeading
	eyebrow="BÍBLIA AUDIOVISUAL · PRESETS · HERANÇA"
	title="Estilo da série"
	description="Paleta, tipografia, legenda, movimento, SFX e voz vivem numa camada única. Série → temporada → episódio → cena, sem defaults vazando entre camadas. O plano de edição carrega um snapshot do estilo no momento em que foi salvo."
/>

{#if data.notice}
	<p class="notice success" role="status">{noticeText(data.notice)}</p>
{/if}
{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}

<form class="scope-selector" method="GET">
	<label>
		Escopo
		<select name="scopeType" bind:value={scopeType} onchange={onScopeTypeChange}>
			<option value="SERIES">Série</option>
			<option value="SEASON">Temporada</option>
		</select>
	</label>
	<label>
		Alvo
		<select name="scopeId" bind:value={scopeId}>
			{#each scopeOptions as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
	</label>
	<button type="submit">Abrir escopo</button>
</form>

<div class="grid">
	<section class="panel">
		<header class="panel-head">
			<h2>{scopeName(data.scopeType, data.scopeId)}</h2>
			{#if selectedPreset}
				<span class:ok={Boolean(approved)}>
					{approved ? `aprovado v${approved.revision}` : 'sem versão aprovada'}
				</span>
			{:else}
				<span class="warn">sem preset</span>
			{/if}
		</header>
		{#if selectedPreset}
			<p class="hint">
				{selectedPreset.name} · {selectedPreset.revisions.length} revisão(ões) · hash
				{latest?.configHash.slice(0, 12) ?? '—'}
			</p>
			{#if !approved}
				<p class="notice warnbox" role="status">
					Este preset só tem DRAFT. Episódios herdam do escopo pai até você aprovar uma revisão.
				</p>
			{/if}
		{:else}
			<p class="hint">
				Nenhum preset nesta camada. Salvar cria a revisão 1 como DRAFT; aprovar publica a herança.
			</p>
		{/if}
		{#key `${data.scopeType}:${data.scopeId}:${latest?.revision ?? 0}`}
			<StyleConfigFields
				mode="full"
				action="?/save"
				scopeType={data.scopeType}
				scopeId={data.scopeId}
				episodeId={data.episodeId}
				presetName={selectedPreset?.name ?? scopeName(data.scopeType, data.scopeId)}
				expectedRevision={selectedPreset?.latestRevision ?? 0}
				config={latest?.config ?? DEFAULT_STYLE_CONFIG}
				submitLabel={selectedPreset ? 'Salvar nova revisão DRAFT' : 'Criar preset DRAFT'}
			/>
		{/key}
	</section>

	<section class="panel">
		<header class="panel-head">
			<h2>Prévia efetiva</h2>
			{#if data.preview}<span>{data.preview.sources ? 'resolvido' : ''}</span>{/if}
		</header>
		<form class="episode-selector" method="GET">
			<input type="hidden" name="scopeType" value={data.scopeType} />
			<input type="hidden" name="scopeId" value={data.scopeId} />
			<label>
				Episódio
				<select name="episodeId" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
					{#each data.context.episodes as episode (episode.id)}
						<option value={episode.id} selected={episode.id === data.episodeId}>
							{episode.seriesTitle} · E{episode.number} — {episode.title}
						</option>
					{/each}
				</select>
			</label>
		</form>
		{#if data.preview}
			<div
				class="effective-preview font-{data.preview.config.fontFamily}"
				style={`--bg:${data.preview.config.paletteBackground};--fg:${data.preview.config.paletteForeground};--accent:${data.preview.config.paletteAccent};--muted:${data.preview.config.paletteMuted}`}
			>
				<div class="swatches" aria-hidden="true">
					<span style={`background:${data.preview.config.paletteBackground}`}></span>
					<span style={`background:${data.preview.config.paletteForeground}`}></span>
					<span style={`background:${data.preview.config.paletteAccent}`}></span>
					<span style={`background:${data.preview.config.paletteMuted}`}></span>
				</div>
				<strong>A casa não responde</strong>
				<p>{data.preview.config.ctaPrompt}</p>
				<small>
					{data.preview.config.captionTemplate} · {data.preview.config.captionSafeZone} ·
					{data.preview.config.motion} · {data.preview.config.colorPresetId} ·
					{Math.round(data.preview.config.colorStrength * 100)}%
				</small>
			</div>
			{#each data.preview.warnings as warning (warning)}
				<p class="notice warnbox" role="status">{warningLabels[warning] ?? warning}</p>
			{/each}
			<dl class="style-facts">
				<div>
					<dt>Cor</dt>
					<dd>
						{data.preview.config.colorPresetId} · {Math.round(
							data.preview.config.colorStrength * 100,
						)}%
					</dd>
				</div>
				<div>
					<dt>SFX</dt>
					<dd>
						{data.preview.config.sfxCategory} · {data.preview.config.sfxAssetIds.length} asset(s)
					</dd>
				</div>
				<div>
					<dt>Voz</dt>
					<dd>{data.preview.config.voiceStyle}</dd>
				</div>
				<div>
					<dt>Abertura</dt>
					<dd>{data.preview.config.openingHookKind}</dd>
				</div>
				<div>
					<dt>Capa</dt>
					<dd>
						{data.preview.config.coverTemplateId} ·
						<a href={resolve(`/app/covers?episodeId=${data.episodeId}`)}>abrir capas</a>
					</dd>
				</div>
				<div>
					<dt>Final A/B</dt>
					<dd>
						{data.preview.config.endCardTemplateId} ·
						<a href={resolve(`/app/finale?episodeId=${data.episodeId}`)}>abrir final</a>
					</dd>
				</div>
				<div>
					<dt>CTA</dt>
					<dd>{data.preview.config.ctaPrompt}</dd>
				</div>
			</dl>
			<div class="source-table">
				{#each STYLE_FIELDS as field (field)}
					<span>{fieldLabels[field] ?? field}</span>
					<strong>{sourceLabels[data.preview.sources[field]] ?? data.preview.sources[field]}</strong
					>
				{/each}
			</div>
			{#if data.preview.scenes?.length}
				<details class="scene-snapshot">
					<summary>{data.preview.scenes.length} cena(s) com override congelado</summary>
					<ul>
						{#each data.preview.scenes as scene (scene.sceneId)}
							<li>
								Cena {scene.sceneIndex}: {scene.config.captionTemplate} /
								{scene.config.captionSafeZone} · {scene.config.motion} ·
								{sourceLabels[scene.sources.captionTemplate] ?? scene.sources.captionTemplate}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			<p class="hint">
				Preset {data.preview.presetId
					? `${data.preview.presetId.slice(0, 8)} @ v${data.preview.presetRevision}`
					: 'ausente'}. O snapshot é gravado no plano ao salvar a timeline; editar o preset depois
				não muda planos antigos.
			</p>
		{:else}
			<p class="hint">
				{data.previewError ?? 'Selecione um episódio para resolver a herança.'}
			</p>
		{/if}
	</section>
</div>

{#if selectedPreset && selectedPreset.revisions.length}
	<section class="panel revisions-panel">
		<header class="panel-head"><h2>Revisões do preset</h2></header>
		<div class="revision-grid">
			{#each selectedPreset.revisions as revision (revision.id)}
				<article class="revision">
					<header>
						<strong>v{revision.revision} · {revision.status}</strong>
						<small>{new Date(revision.createdAt).toLocaleString('pt-BR')}</small>
					</header>
					<p class="hint">
						{revision.config.fontFamily} · {revision.config.captionTemplate} ·
						{revision.config.motion} · {revision.config.sfxCategory} ·
						{revision.config.voiceStyle}
					</p>
					<code>{revision.configHash.slice(0, 16)}</code>
					<div class="actions">
						{#if revision.status !== 'APPROVED'}
							<form method="POST" action="?/approve">
								<input type="hidden" name="scopeType" value={data.scopeType} />
								<input type="hidden" name="scopeId" value={data.scopeId} />
								<input type="hidden" name="episodeId" value={data.episodeId} />
								<input type="hidden" name="presetId" value={selectedPreset.id} />
								<button type="submit">Aprovar</button>
							</form>
						{/if}
						{#if revision.revision !== selectedPreset.latestRevision}
							<form method="POST" action="?/restore">
								<input type="hidden" name="scopeType" value={data.scopeType} />
								<input type="hidden" name="scopeId" value={data.scopeId} />
								<input type="hidden" name="episodeId" value={data.episodeId} />
								<input type="hidden" name="presetId" value={selectedPreset.id} />
								<input type="hidden" name="revision" value={revision.revision} />
								<button type="submit" class="quiet">Restaurar DRAFT</button>
							</form>
						{/if}
						{#if approved?.id === revision.id}
							<a href={resolve('/api/style/[presetId]', { presetId: selectedPreset.id })}>JSON</a>
							<a
								href="{resolve('/api/style/[presetId]', {
									presetId: selectedPreset.id,
								})}?download=1">baixar</a
							>
						{/if}
					</div>
				</article>
			{/each}
		</div>
	</section>
{/if}

{#if data.episodeId}
	<div class="grid">
		<section class="panel">
			<header class="panel-head">
				<h2>Override do episódio</h2>
				{#if episodeOverride}<span>ativo</span>{:else}<span>herdando</span>{/if}
			</header>
			<p class="hint">
				{selectedEpisode
					? `${selectedEpisode.seriesTitle} · E${selectedEpisode.number} — ${selectedEpisode.title}`
					: 'Episódio'}
				vence a série e a temporada, campo por campo.
			</p>
			{#key `episode:${data.episodeId}:${JSON.stringify(episodeOverride?.config ?? {})}`}
				<StyleConfigFields
					mode="override"
					action="?/override"
					scopeType={data.scopeType}
					scopeId={data.scopeId}
					episodeId={data.episodeId}
					override={episodeOverride?.config ?? null}
					submitLabel="Salvar override do episódio"
				/>
			{/key}
		</section>

		<section class="panel">
			<header class="panel-head">
				<h2>Override da cena</h2>
				{#if sceneOverride}<span>ativo</span>{:else}<span>sem override</span>{/if}
			</header>
			{#if data.scenes.length}
				<form class="scene-selector" method="GET">
					<input type="hidden" name="scopeType" value={data.scopeType} />
					<input type="hidden" name="scopeId" value={data.scopeId} />
					<input type="hidden" name="episodeId" value={data.episodeId} />
					<label>
						Cena
						<select name="sceneId" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
							{#each data.scenes as scene (scene.id)}
								<option value={scene.id} selected={scene.id === data.selectedSceneId}>
									Cena {scene.index}
								</option>
							{/each}
						</select>
					</label>
				</form>
				{#key `scene:${data.selectedSceneId}:${JSON.stringify(sceneOverride?.config ?? {})}`}
					<StyleConfigFields
						mode="scene"
						action="?/sceneOverride"
						scopeType={data.scopeType}
						scopeId={data.scopeId}
						episodeId={data.episodeId}
						sceneId={data.selectedSceneId}
						override={sceneOverride?.config ?? null}
						submitLabel="Salvar override da cena"
					/>
				{/key}
				<p class="hint">
					A cena {selectedScene?.index} vence todas as outras camadas apenas neste campo; o preset da
					série permanece intacto. Um override vazio limpa a camada.
				</p>
			{:else}
				<p class="hint">Este episódio ainda não tem cenas.</p>
			{/if}
		</section>
	</div>
{/if}

<div class="grid">
	<section class="panel">
		<header class="panel-head"><h2>Importar preset</h2></header>
		<form method="POST" action="?/import" class="stack">
			<input type="hidden" name="scopeType" value={data.scopeType} />
			<input type="hidden" name="scopeId" value={data.scopeId} />
			<input type="hidden" name="episodeId" value={data.episodeId} />
			<label>
				JSON <code>dif-studio-style-preset/v1</code>
				<textarea
					name="json"
					rows="7"
					required
					placeholder={'{"format":"dif-studio-style-preset/v1","name":"…","scopeType":"SERIES","scopeId":"…","config":{…}}'}
				></textarea>
			</label>
			<button type="submit">Importar como DRAFT</button>
		</form>
	</section>

	<section class="panel">
		<header class="panel-head"><h2>Duplicar para outro escopo</h2></header>
		{#if selectedPreset}
			<form method="POST" action="?/duplicate" class="stack">
				<input type="hidden" name="scopeType" value={data.scopeType} />
				<input type="hidden" name="scopeId" value={data.scopeId} />
				<input type="hidden" name="episodeId" value={data.episodeId} />
				<input type="hidden" name="presetId" value={selectedPreset.id} />
				<label>
					Nome no destino
					<input name="targetName" maxlength="80" value={`${selectedPreset.name} (cópia)`} />
				</label>
				<div class="two">
					<label>
						Tipo
						<select name="targetScopeType">
							<option value="SERIES">Série</option>
							<option value="SEASON">Temporada</option>
						</select>
					</label>
					<label>
						Destino
						<select name="targetScopeId">
							<optgroup label="Séries">
								{#each data.context.series as series (series.id)}
									<option value={series.id}>{series.title}</option>
								{/each}
							</optgroup>
							<optgroup label="Temporadas">
								{#each data.context.seasons as season (season.id)}
									<option value={season.id}>{season.seriesTitle} · {season.title}</option>
								{/each}
							</optgroup>
						</select>
					</label>
				</div>
				<p class="hint">
					Escolha um destino do tipo correspondente. O preset entra como DRAFT no escopo escolhido;
					a aprovação continua explícita.
				</p>
				<button type="submit">Duplicar como DRAFT</button>
			</form>
		{:else}
			<p class="hint">Abra um escopo com preset para duplicar.</p>
		{/if}
	</section>
</div>

<style>
	.scope-selector {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: end;
		margin-block: 0.9rem;
	}
	.scope-selector label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.75rem;
		min-width: min(14rem, 100%);
	}
	.scope-selector select,
	.episode-selector select,
	.panel select,
	.panel textarea {
		width: 100%;
		min-width: 0;
		max-width: 100%;
	}
	.panel input,
	.panel label {
		min-width: 0;
		max-width: 100%;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
		align-items: start;
	}
	.grid > *,
	.panel {
		min-width: 0;
	}
	.panel {
		display: grid;
		gap: 0.7rem;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.panel-head h2 {
		margin: 0;
		font-size: 0.95rem;
	}
	.panel-head span {
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		font-size: 0.62rem;
		color: var(--muted);
	}
	.panel-head span.ok {
		border-color: #5a5;
		color: #b8f5c0;
	}
	.panel-head span.warn {
		border-color: #875;
		color: #ffd0a0;
	}
	.episode-selector label,
	.stack label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.stack {
		display: grid;
		gap: 0.55rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
		gap: 0.5rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.notice {
		padding: 0.65rem 0.8rem;
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
	}
	.notice.error {
		border: 1px solid #833;
		background: #1a0c0c;
		color: #ffb4b4;
	}
	.notice.success {
		border: 1px solid #385;
		background: #0c1a10;
		color: #b8f5c0;
	}
	.warnbox {
		border: 1px solid #875;
		background: #1a140c;
		color: #ffd0a0;
	}
	.effective-preview {
		display: grid;
		gap: 0.45rem;
		padding: 1rem;
		background: var(--bg);
		color: var(--fg);
		border-radius: var(--radius-sm);
		text-align: center;
	}
	.effective-preview strong {
		font-size: 1.2rem;
		letter-spacing: 0.04em;
	}
	.effective-preview p {
		margin: 0;
		color: var(--accent);
		font-weight: 700;
		font-size: 0.8rem;
	}
	.effective-preview small {
		color: var(--muted);
		font-size: 0.65rem;
	}
	.swatches {
		display: flex;
		justify-content: center;
		gap: 0.3rem;
	}
	.swatches span {
		width: 1.1rem;
		height: 1.1rem;
		border: 1px solid rgb(255 255 255 / 25%);
		border-radius: 999px;
	}
	.style-facts {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		font-size: 0.7rem;
	}
	.style-facts div {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.15rem 0.6rem;
		min-width: 0;
		border-bottom: 1px dotted var(--line);
	}
	.style-facts dt {
		color: var(--muted);
	}
	.style-facts dd {
		margin: 0;
		text-align: right;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.source-table {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.15rem 0.6rem;
		font-size: 0.7rem;
		color: var(--muted);
	}
	.source-table strong {
		color: var(--fg);
		font-weight: 600;
		text-align: right;
	}
	.scene-selector label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.scene-snapshot {
		font-size: 0.7rem;
		color: var(--muted);
	}
	.scene-snapshot summary {
		cursor: pointer;
	}
	.scene-snapshot ul {
		margin: 0.35rem 0 0;
		padding-left: 1rem;
	}
	.revisions-panel {
		margin-top: 1rem;
	}
	.revision-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 0.7rem;
	}
	.revision {
		display: grid;
		gap: 0.35rem;
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #0b0b0b;
	}
	.revision header {
		display: flex;
		justify-content: space-between;
		gap: 0.4rem;
		font-size: 0.72rem;
	}
	.revision header small {
		color: var(--muted);
		font-size: 0.62rem;
	}
	.revision code {
		font-size: 0.62rem;
		color: var(--muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.actions form {
		display: flex;
	}
	.actions button,
	.actions a {
		font-size: 0.66rem;
		padding: 0.18rem 0.35rem;
	}
	.quiet {
		background: transparent;
	}
	.font-serif {
		font-family: Georgia, 'Times New Roman', serif;
	}
	.font-sans {
		font-family: 'Inter', 'Helvetica Neue', sans-serif;
	}
	.font-mono {
		font-family: 'DejaVu Sans Mono', monospace;
	}
	.font-display {
		font-family: 'Impact', 'Arial Black', sans-serif;
	}
</style>
