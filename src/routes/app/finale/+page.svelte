<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import { END_CARD_TEMPLATES, END_CARD_TEMPLATE_LIST } from '#lib/domain/choice-end-card.js';
	import { CHOICE_END_CARD_LAYOUTS, CHOICE_END_CARD_SFX } from '#lib/schemas/choice-end-card.js';

	let { data, form }: PageProps = $props();
	const defaults = untrack(() => data.defaults);
	let templateId = $state(defaults.templateId);
	let layout = $state<'split' | 'stacked'>(defaults.layout);
	let durationMs = $state(defaults.durationMs);
	let prompt = $state(defaults.prompt);
	let footer = $state(defaults.footer);
	let reveal = $state(defaults.reveal);
	let reducedMotion = $state(defaults.reducedMotion);
	let sfx = $state(defaults.sfx);
	let sfxVolumeDb = $state(defaults.sfxVolumeDb);
	let narration = $state(defaults.narration);
	let previewProfile = $state<'tiktok' | 'reels'>('tiktok');

	const selectedTemplate = $derived(END_CARD_TEMPLATES[templateId]);
	const choices = $derived(data.context?.choices ?? []);
	const latestRevision = $derived(data.context?.latestRevision ?? 0);
	const stale = $derived(new Set(data.staleRevisionIds));
	const approved = $derived(data.context?.approved ?? null);
	const attached = $derived(Boolean(data.plan?.endCardId));

	function templateLabel(id: string): string {
		return END_CARD_TEMPLATES[id as keyof typeof END_CARD_TEMPLATES]?.label ?? id;
	}
</script>

<svelte:head><title>Final A/B · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="FINAIS · CTA A/B · CÂNONE"
	title="Final A/B do episódio"
	description="Duas portas, um bip e nenhuma escolha inventada. O card usa as escolhas aprovadas do episódio, entra no fim da timeline e bloqueia o export quando o roteiro muda."
/>

<form class="selector" method="GET">
	<label for="finale-episode">Episódio</label>
	<select
		id="finale-episode"
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
			{data.notice.value} layout(s) de final A/B gerados e versionados.
		{:else if data.notice.mode === 'approved'}
			Final A/B aprovado na revisão {data.notice.value}.
		{:else if data.notice.mode === 'restored'}
			Revisão restaurada como DRAFT na revisão {data.notice.value}.
		{:else if data.notice.mode === 'attached'}
			Final A/B anexado à timeline na versão {data.notice.value}.
		{:else}
			Final A/B removido da timeline.
		{/if}
	</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

{#if data.context && choices.length === 2}
	<div class="grid">
		<section class="panel">
			<h2>Configurar card</h2>
			<p class="choices">
				{#each choices as choice (choice.id)}
					<span><b>{choice.optionKey === '1' ? 'A' : 'B'}</b> {choice.label}</span>
				{/each}
			</p>
			<form method="POST" action="?/generate" class="finale-form">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<input type="hidden" name="expectedRevision" value={latestRevision} />
				<div class="two">
					<label>
						Preset
						<select name="templateId" bind:value={templateId}>
							{#each END_CARD_TEMPLATE_LIST as template (template.id)}
								<option value={template.id}>{template.label}</option>
							{/each}
						</select>
					</label>
					<label>
						Duração
						<select name="durationMs" bind:value={durationMs}>
							{#each [4000, 6000, 8000, 10000, 12000] as duration (duration)}
								<option value={duration}>{duration / 1000}s</option>
							{/each}
						</select>
					</label>
				</div>
				<label>
					Prompt
					<input name="prompt" maxlength="80" bind:value={prompt} required />
				</label>
				<label>
					Rodapé
					<input name="footer" maxlength="80" bind:value={footer} required />
				</label>
				<div class="two">
					<label>
						Revelação
						<select name="reveal" bind:value={reveal}>
							<option value="progressive">Progressiva</option>
							<option value="instant">Instantânea</option>
						</select>
					</label>
					<label>
						SFX
						<select name="sfx" bind:value={sfx}>
							{#each CHOICE_END_CARD_SFX as effect (effect)}
								<option value={effect}>{effect}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="two">
					<label>
						Volume do SFX ({sfxVolumeDb} dB)
						<input
							type="range"
							name="sfxVolumeDb"
							min="-30"
							max="-3"
							step="1"
							bind:value={sfxVolumeDb}
						/>
					</label>
					<label>
						Narração sob o card
						<select name="narration" bind:value={narration}>
							<option value="mute">Silenciar (padrão)</option>
							<option value="keep">Manter (explícito)</option>
						</select>
					</label>
				</div>
				<label class="check">
					<input type="checkbox" name="reducedMotion" bind:checked={reducedMotion} />
					Reduzir movimento (sem fades/deslocamentos)
				</label>
				<fieldset>
					<legend>Layouts</legend>
					{#each CHOICE_END_CARD_LAYOUTS as option (option)}
						<label class="check">
							<input
								type="checkbox"
								name="layouts"
								value={option}
								checked={layout === option}
								onchange={(event) => {
									if (event.currentTarget.checked) layout = option;
								}}
							/>
							{option === 'split' ? 'Lado a lado' : 'Empilhado'}
						</label>
					{/each}
				</fieldset>
				<p class="hint">
					O card é renderizado como ASS sobre o fim do MP4. O SFX é sintetizado localmente e passa
					pelo loudnorm/alimiter do mix.
				</p>
				<button type="submit">Gerar layouts selecionados</button>
			</form>
		</section>

		<section class="panel">
			<h2>Prévia segura</h2>
			<div class="profile-toggle" role="group" aria-label="Perfil de prévia">
				{#each [{ id: 'tiktok', label: 'TikTok' }, { id: 'reels', label: 'Reels' }] as profile (profile.id)}
					<button
						type="button"
						class:active={previewProfile === profile.id}
						onclick={() => (previewProfile = profile.id as 'tiktok' | 'reels')}
					>
						{profile.label}
					</button>
				{/each}
			</div>
			<div
				class="endcard-preview tpl-{selectedTemplate.id} profile-{previewProfile}"
				style={`--card-bg:${selectedTemplate.background};--card-panel:${selectedTemplate.panel};--card-accent:${selectedTemplate.accent};--card-text:${selectedTemplate.text}`}
			>
				<div class="safe-outline" aria-hidden="true"></div>
				<div class="ui-mock" aria-hidden="true">
					<span class="ui-top">{previewProfile === 'tiktok' ? 'Para você' : 'Reels'}</span>
					<span class="ui-actions">♡ 💬 ↗</span>
					<span class="ui-caption">@arquivo · som original</span>
				</div>
				<header>{prompt}</header>
				<div class="choices-preview {layout}">
					{#each choices as choice (choice.id)}
						<div class="choice-panel">
							<strong>{choice.optionKey === '1' ? 'A' : 'B'}</strong>
							<span>{choice.label}</span>
						</div>
					{/each}
				</div>
				<footer>{footer}</footer>
				<small
					>{durationMs / 1000}s · {reveal} · {sfx} · {narration === 'mute'
						? 'narração muda'
						: 'narração mantida'}</small
				>
			</div>
			<p class="hint">
				{selectedTemplate.description} A simulação mostra a área segura de {previewProfile ===
				'tiktok'
					? 'TikTok'
					: 'Reels'}; o ASS final usa a geometria conservadora do perfil TikTok.
			</p>
			{#if approved}
				<div class="attach">
					<p>
						Aprovado: v{approved.revision} · {templateLabel(approved.config.templateId)} ·
						{approved.config.layout}
					</p>
					{#if attached}
						<form method="POST" action="?/detach">
							<input type="hidden" name="episodeId" value={data.context.episode.id} />
							<input type="hidden" name="expectedVersion" value={data.plan?.version ?? 0} />
							<button type="submit" class="quiet">Remover da timeline</button>
						</form>
					{:else}
						<form method="POST" action="?/attach">
							<input type="hidden" name="episodeId" value={data.context.episode.id} />
							<input type="hidden" name="revisionId" value={approved.id} />
							<input type="hidden" name="expectedVersion" value={data.plan?.version ?? 0} />
							<button type="submit">Anexar à timeline</button>
						</form>
					{/if}
				</div>
			{:else}
				<p class="hint">Aprove uma revisão para anexar o card à timeline.</p>
			{/if}
		</section>
	</div>

	<section class="panel revisions-panel">
		<h2>Revisões</h2>
		{#if data.context.revisions.length}
			<div class="revision-grid">
				{#each data.context.revisions as revision (revision.id)}
					<article class="revision" data-revision-id={revision.id}>
						<header>
							<strong>v{revision.revision} · {templateLabel(revision.config.templateId)}</strong>
							<span class:approved={revision.status === 'APPROVED'}>{revision.status}</span>
						</header>
						<small>
							{revision.config.layout === 'split' ? 'lado a lado' : 'empilhado'} ·
							{revision.config.durationMs / 1000}s · {revision.config.sfx}
						</small>
						{#if stale.has(revision.id)}
							<p class="stale" role="status">
								Escolhas mudaram: esta revisão não pode ser aprovada nem anexada. Regenere.
							</p>
						{/if}
						<div class="revision-actions">
							{#if revision.status !== 'APPROVED' && !stale.has(revision.id)}
								<form method="POST" action="?/approve">
									<input type="hidden" name="revisionId" value={revision.id} />
									<input type="hidden" name="expectedRevision" value={latestRevision} />
									<button type="submit">Aprovar</button>
								</form>
							{/if}
							{#if revision.revision !== latestRevision}
								<form method="POST" action="?/restore">
									<input type="hidden" name="revisionId" value={revision.id} />
									<input type="hidden" name="expectedRevision" value={latestRevision} />
									<button type="submit" class="quiet">Restaurar DRAFT</button>
								</form>
							{/if}
							<a
								href="{resolve('/api/end-cards/[revisionId]', {
									revisionId: revision.id,
								})}?format=ass">ASS</a
							>
							<a
								href="{resolve('/api/end-cards/[revisionId]', {
									revisionId: revision.id,
								})}?format=json">JSON</a
							>
							<a
								href="{resolve('/api/end-cards/[revisionId]', {
									revisionId: revision.id,
								})}?format=zip">ZIP</a
							>
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<p class="hint">Nenhum final A/B gerado para este episódio.</p>
		{/if}
		{#if data.plan}
			<p class="hint">
				Timeline v{data.plan.version} ({data.plan.status}) ·
				{data.plan.endCardId
					? `card ${data.plan.endCardId.slice(0, 8)}@${data.plan.endCardRevision}`
					: 'sem card anexado'}
			</p>
		{/if}
	</section>
{/if}

<style>
	.selector {
		display: grid;
		gap: 0.35rem;
		margin-block: 0.9rem;
		max-width: 34rem;
	}
	select,
	input {
		width: 100%;
		min-width: 0;
		max-width: 100%;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
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
	.finale-form {
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
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.35rem;
		align-items: center;
		width: auto;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.75rem;
	}
	.choices span {
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
	}
	.endcard-preview {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr auto auto;
		gap: 0.5rem;
		aspect-ratio: 9 / 16;
		max-height: 30rem;
		padding: 11% 7% 8%;
		background: var(--card-bg);
		color: var(--card-text);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.profile-toggle {
		display: flex;
		gap: 0.35rem;
	}
	.profile-toggle button {
		font-size: 0.7rem;
		padding: 0.2rem 0.5rem;
	}
	.profile-toggle button.active {
		border-color: var(--phosphor);
		color: var(--phosphor);
	}
	.safe-outline {
		position: absolute;
		inset: 9.4% 4.4% 12.5%;
		border: 1px dashed rgb(255 255 255 / 30%);
		pointer-events: none;
	}
	.profile-reels .safe-outline {
		inset: 11.5% 4.4% 14%;
	}
	.ui-mock {
		position: absolute;
		inset: 0;
		pointer-events: none;
		font-size: 0.58rem;
		opacity: 0.75;
	}
	.ui-top {
		position: absolute;
		top: 4.5%;
		left: 8%;
		font-weight: 700;
	}
	.ui-actions {
		position: absolute;
		right: 3.5%;
		bottom: 28%;
		display: grid;
		gap: 0.6rem;
		text-align: center;
	}
	.ui-caption {
		position: absolute;
		left: 8%;
		right: 18%;
		bottom: 5%;
		line-height: 1.3;
	}
	.profile-reels .ui-actions {
		bottom: 30%;
	}
	.endcard-preview header {
		font-weight: 700;
		text-align: center;
		font-size: 0.85rem;
	}
	.choices-preview {
		display: grid;
		gap: 0.4rem;
		align-content: center;
	}
	.choices-preview.split {
		grid-template-columns: 1fr 1fr;
	}
	.choice-panel {
		display: grid;
		place-items: center;
		gap: 0.25rem;
		padding: 0.6rem;
		border: 2px solid var(--card-accent);
		background: var(--card-panel);
		min-height: 6rem;
	}
	.choice-panel strong {
		font-size: 2rem;
		line-height: 1;
		color: var(--card-accent);
	}
	.choice-panel span {
		text-align: center;
		font-size: 0.72rem;
		line-height: 1.15;
		overflow-wrap: anywhere;
		display: -webkit-box;
		line-clamp: 4;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.endcard-preview footer {
		text-align: center;
		color: var(--card-accent);
		font-weight: 700;
		font-size: 0.8rem;
	}
	.endcard-preview small {
		text-align: center;
		font-size: 0.6rem;
		opacity: 0.7;
	}
	.tpl-stamped {
		letter-spacing: 0.02em;
	}
	.tpl-cctv,
	.tpl-signal {
		font-family: 'DejaVu Sans Mono', monospace;
	}
	.attach {
		display: grid;
		gap: 0.4rem;
		font-size: 0.75rem;
	}
	.revisions-panel {
		margin-top: 1rem;
	}
	.revision-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
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
		gap: 0.35rem;
		align-items: center;
		font-size: 0.68rem;
	}
	.revision-actions form {
		display: flex;
	}
	.revision-actions button,
	.revision-actions a {
		font-size: 0.66rem;
		padding: 0.18rem 0.35rem;
	}
	.stale {
		color: #ffb4b4;
		font-size: 0.68rem;
		margin: 0;
	}
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.quiet {
		background: transparent;
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
</style>
