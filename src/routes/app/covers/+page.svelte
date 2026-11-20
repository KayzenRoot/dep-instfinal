<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import { COVER_TEMPLATES } from '#lib/domain/cover.js';
	import { COVER_FORMATS } from '#lib/schemas/cover.js';

	let { data, form }: PageProps = $props();
	let failedPreviews = $state<Set<string>>(new Set());

	const latestRevision = $derived(data.context?.revisions[0]?.revision ?? 0);
	const selectedFrame = $derived(
		data.context?.frames.find(
			(frame) => frame.assetId === data.context?.revisions[0]?.config.frameAssetId,
		) ?? null,
	);

	function markPreviewFailed(id: string): void {
		failedPreviews = new Set([...failedPreviews, id]);
	}

	function templateLabel(id: string): string {
		return COVER_TEMPLATES[id as keyof typeof COVER_TEMPLATES]?.label ?? id;
	}
</script>

<svelte:head><title>Capas · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="CAPAS · POSTERS · CARDS"
	title="Capas do episódio"
	description="Composição determinística sobre frames privados. Título, foco e preset são versionados; os frames originais e o cânone não são alterados."
/>

<form class="selector" method="GET">
	<label for="cover-episode">Episódio</label>
	<select
		id="cover-episode"
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
{#if data.notice}
	<p class="notice success" role="status">
		{#if data.notice.mode === 'generated'}
			{data.notice.value} capa(s) geradas e versionadas.
		{:else if data.notice.mode === 'approved'}
			Capa aprovada na versão {data.notice.value}.
		{:else}
			Versão restaurada como DRAFT na revisão {data.notice.value}.
		{/if}
	</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

{#if data.context}
	<div class="grid">
		<section class="panel">
			<h2>Gerar capas</h2>
			<form method="POST" action="?/generate" class="cover-form">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<input type="hidden" name="expectedRevision" value={latestRevision} />
				<label>
					Título
					<input name="title" maxlength="120" value={data.defaultTitle} required />
				</label>
				<label>
					Subtítulo
					<input name="subtitle" maxlength="200" value={data.defaultSubtitle} />
				</label>
				<div class="two">
					<label>
						Selo
						<input name="badge" maxlength="40" value={data.defaultBadge} />
					</label>
					<label>
						Formato
						<select name="format">
							{#each Object.entries(COVER_FORMATS) as [id, format] (id)}
								<option value={id} selected={id === '9:16'}>{format.label}</option>
							{/each}
						</select>
					</label>
				</div>
				<label>
					Frame privado (opcional; sem frame usa fundo do preset)
					<select name="frameAssetId">
						<option value="">Sem frame</option>
						{#each data.context.frames as frame (frame.assetId)}
							<option value={frame.assetId} selected={frame.assetId === selectedFrame?.assetId}>
								{frame.label}
							</option>
						{/each}
					</select>
				</label>
				<fieldset>
					<legend>Presets</legend>
					<div class="template-list">
						{#each Object.values(COVER_TEMPLATES) as template (template.id)}
							<label class="check">
								<input
									type="checkbox"
									name="templates"
									value={template.id}
									checked={['noir', 'vhs_polaroid', 'archive'].includes(template.id)}
								/>
								{template.label}
							</label>
						{/each}
					</div>
					<p class="hint">
						Cada preset selecionado cria uma revisão DRAFT no mesmo formato, com a identidade da
						série.
					</p>
				</fieldset>
				<div class="two">
					<label>
						Foco horizontal
						<input
							type="range"
							name="focusX"
							min="0"
							max="1"
							step="0.05"
							value={data.context.revisions[0]?.config.focusX ?? 0.5}
						/>
					</label>
					<label>
						Foco vertical
						<input
							type="range"
							name="focusY"
							min="0"
							max="1"
							step="0.05"
							value={data.context.revisions[0]?.config.focusY ?? 0.5}
						/>
					</label>
				</div>
				<label class="check">
					<input type="checkbox" name="watermark" checked />
					Incluir assinatura DIF STUDIO
				</label>
				<button class="primary" type="submit">Gerar capas</button>
			</form>
			<p class="hint">
				O recorte usa foco e preenche o formato. O texto é limitado a três linhas e fica dentro das
				margens seguras; o grid do Instagram usa o recorte central 4:5.
			</p>
		</section>

		<section class="panel">
			<h2>Revisões</h2>
			{#if data.context.revisions.length}
				<div class="revision-grid">
					{#each data.context.revisions as revision (revision.id)}
						<article class="revision" data-revision-id={revision.id}>
							<div class="cover-preview">
								<img
									src={`/api/covers/${revision.id}?format=${revision.format}&preview=1`}
									alt={`Capa ${templateLabel(revision.templateId)} ${revision.format}`}
									loading="lazy"
									decoding="async"
									onerror={() => markPreviewFailed(revision.id)}
								/>
								{#if failedPreviews.has(revision.id)}
									<span class="preview-error" role="alert"
										>Prévia indisponível. Gere uma variante sem frame ou baixe o arquivo.</span
									>
								{/if}
								{#if revision.format === '9:16'}
									<span class="grid-crop" title="Recorte central 4:5 do grid do Instagram">4:5</span
									>
								{/if}
							</div>
							<header>
								<strong>v{revision.revision} · {templateLabel(revision.templateId)}</strong>
								<span class:approved={revision.status === 'APPROVED'}>{revision.status}</span>
							</header>
							<small
								>{revision.format} · {new Date(revision.createdAt).toLocaleString('pt-BR')}</small
							>
							<div class="revision-actions">
								<form
									method="GET"
									action={resolve('/api/covers/[revisionId]', { revisionId: revision.id })}
								>
									<input type="hidden" name="format" value={revision.format} />
									<input type="hidden" name="download" value="1" />
									<button type="submit" name="output" value="png">PNG</button>
									<button type="submit" name="output" value="jpeg">JPEG</button>
								</form>
								<form
									method="GET"
									action={resolve('/api/covers/[revisionId]', { revisionId: revision.id })}
								>
									<input type="hidden" name="format" value="zip" />
									<input type="hidden" name="download" value="1" />
									<button type="submit">ZIP 3 formatos</button>
								</form>
								<form method="POST" action="?/approve">
									<input type="hidden" name="revisionId" value={revision.id} />
									<input type="hidden" name="expectedRevision" value={latestRevision} />
									<button type="submit">Aprovar</button>
								</form>
								<form method="POST" action="?/restore">
									<input type="hidden" name="revisionId" value={revision.id} />
									<input type="hidden" name="expectedRevision" value={latestRevision} />
									<button type="submit">Restaurar DRAFT</button>
								</form>
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<p class="hint">Gere ao menos um preset para ver prévias e downloads.</p>
			{/if}
		</section>
	</div>
	<p class="hint">
		Prévias e downloads são servidos por rota owner-only e renderizados sob demanda; nenhum frame ou
		capa ganha URL pública permanente. A publicação continua manual.
	</p>
{/if}

<style>
	.selector {
		display: grid;
		gap: 0.35rem;
		margin-block: 0.9rem;
		max-width: 34rem;
	}
	.selector select,
	input {
		width: 100%;
		min-width: 0;
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
	.cover-form {
		display: grid;
		gap: 0.6rem;
	}
	label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.5rem;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		margin: 0;
		padding: 0.6rem;
	}
	.template-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
	}
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.35rem;
		align-items: center;
		width: auto;
	}
	.revision-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.7rem;
	}
	.revision {
		display: grid;
		gap: 0.3rem;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #0b0b0b;
	}
	.cover-preview {
		position: relative;
		display: grid;
	}
	.revision img {
		width: 100%;
		aspect-ratio: 9 / 16;
		object-fit: contain;
		background-color: #000;
		border-radius: var(--radius-sm);
	}
	.preview-error {
		position: absolute;
		inset: auto 0 0;
		padding: 0.35rem;
		background: rgb(40 10 15 / 90%);
		color: #ffb4b4;
		font-size: 0.65rem;
	}
	.grid-crop {
		position: absolute;
		top: 14.8%;
		left: 0;
		right: 0;
		height: 70.4%;
		border-top: 1px dashed rgb(255 255 255 / 55%);
		border-bottom: 1px dashed rgb(255 255 255 / 55%);
		color: #fff;
		font-size: 0.62rem;
		text-align: right;
		padding-right: 0.3rem;
		pointer-events: none;
	}
	.revision header {
		display: flex;
		justify-content: space-between;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.74rem;
	}
	.revision header span {
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.05rem 0.35rem;
		font-size: 0.62rem;
	}
	.revision header span.approved {
		border-color: #5a5;
		color: #b8f5c0;
	}
	.revision small {
		color: var(--muted);
		font-size: 0.65rem;
	}
	.revision-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.revision-actions form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.revision-actions button {
		font-size: 0.66rem;
		padding: 0.18rem 0.35rem;
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
	@media (max-width: 640px) {
		.revision img {
			aspect-ratio: 4 / 5;
		}
	}
</style>
