<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import type { CharacterIdentityProfile } from '#lib/schemas/character-identity.js';

	let { data, form }: PageProps = $props();

	function looksText(profile: CharacterIdentityProfile | null): string {
		if (!profile) return '';
		return profile.looks
			.map((look) =>
				[
					look.label,
					look.appliesFromEpisode,
					look.appliesToEpisode ?? '',
					look.wardrobe,
					look.hair,
					look.notes,
				].join(' | '),
			)
			.join('\n');
	}

	function lines(value: string[]): string {
		return value.join('\n');
	}

	const expectedVersion = $derived(data.detail?.version ?? 0);
</script>

<svelte:head><title>Identidade · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="CHARACTER KIT · FLOW"
	title="Identidade de personagem"
	description="Âncoras e checklists determinísticos para prompts no Flow. O perfil estende o personagem canônico; não altera lore, câmera ou episódios publicados."
/>

<form class="selector" method="GET">
	<label for="identity-series">Série</label>
	<select
		id="identity-series"
		name="seriesId"
		onchange={(event) => event.currentTarget.form?.requestSubmit()}
	>
		{#each data.series as series (series.id)}
			<option value={series.id} selected={series.id === data.selectedSeries?.id}>
				{series.title}
			</option>
		{/each}
	</select>
</form>

{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}
{#if data.notice}
	<p class="notice success" role="status">
		{#if data.notice.mode === 'approved'}
			Perfil aprovado na versão {data.notice.version}.
		{:else if data.notice.mode === 'restored'}
			Versão restaurada como DRAFT na versão {data.notice.version}.
		{:else}
			Perfil salvo na versão {data.notice.version}.
		{/if}
	</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

{#if data.selectedSeries && data.characters.length}
	<form class="selector" method="GET">
		<input type="hidden" name="seriesId" value={data.selectedSeries.id} />
		<label for="identity-character">Personagem</label>
		<select
			id="identity-character"
			name="characterId"
			onchange={(event) => event.currentTarget.form?.requestSubmit()}
		>
			{#each data.characters as character (character.characterId)}
				<option
					value={character.characterId}
					selected={character.characterId === data.selectedCharacter?.characterId}
				>
					{character.name}{character.version ? ` · v${character.version}` : ' · sem perfil'}
				</option>
			{/each}
		</select>
	</form>
{:else if data.selectedSeries}
	<p class="empty">
		Esta série ainda não tem personagens. Crie um personagem na série antes do kit.
	</p>
	<a href={resolve('/app/series/[seriesId]', { seriesId: data.selectedSeries.id })}>Abrir série</a>
{/if}

{#if data.detail}
	<div class="grid">
		<section class="panel">
			<h2>{data.detail.name} · perfil v{data.detail.version ?? 0}</h2>
			<p class="hint">
				Status atual: {data.detail.profileStatus ?? 'sem perfil'}. Salvar cria uma versão DRAFT.
				Aprovar registra o status aprovado; o export inclui o status atual e avisa quando há DRAFT.
				O personagem canônico não é editado.
			</p>
			<form method="POST" action="?/save" class="identity-form">
				<input type="hidden" name="characterId" value={data.detail.characterId} />
				<input type="hidden" name="expectedVersion" value={expectedVersion} />
				<label>
					Aliases (um por linha ou vírgula)
					<textarea name="aliases" rows="2">{lines(data.detail.profile?.aliases ?? [])}</textarea>
				</label>
				<div class="two">
					<label>
						Cabelo
						<input name="hair" value={data.detail.profile?.visualTraits.hair ?? ''} />
					</label>
					<label>
						Figurino base
						<input name="wardrobe" value={data.detail.profile?.visualTraits.wardrobe ?? ''} />
					</label>
					<label>
						Silhueta
						<input name="silhouette" value={data.detail.profile?.visualTraits.silhouette ?? ''} />
					</label>
					<label>
						Marcas
						<input name="marks" value={data.detail.profile?.visualTraits.marks ?? ''} />
					</label>
					<label>
						Acessórios visuais
						<input name="accessories" value={data.detail.profile?.visualTraits.accessories ?? ''} />
					</label>
					<label>
						Paleta
						<input name="palette" value={data.detail.profile?.palette ?? ''} />
					</label>
					<label>
						Iluminação preferida
						<input name="lighting" value={data.detail.profile?.lighting ?? ''} />
					</label>
				</div>
				<label>
					Acessórios imutáveis (um por linha)
					<textarea name="immutableAccessories" rows="2"
						>{lines(data.detail.profile?.immutableAccessories ?? [])}</textarea
					>
				</label>
				<label>
					Acessórios mutáveis (um por linha)
					<textarea name="mutableAccessories" rows="2"
						>{lines(data.detail.profile?.mutableAccessories ?? [])}</textarea
					>
				</label>
				<label>
					Negative prompts (um por linha)
					<textarea name="negativePrompts" rows="2"
						>{lines(data.detail.profile?.negativePrompts ?? [])}</textarea
					>
				</label>
				<label>
					Looks por capítulo (label | início | fim | figurino | cabelo | notas)
					<textarea name="looks" rows="4">{looksText(data.detail.profile)}</textarea>
				</label>
				<label>
					Âncora manual em inglês (vazio usa a âncora gerada)
					<textarea name="anchorOverrideEn" rows="3"
						>{data.detail.profile?.anchorOverrideEn ?? ''}</textarea
					>
				</label>
				<label>
					Notas internas
					<textarea name="notes" rows="2">{data.detail.profile?.notes ?? ''}</textarea>
				</label>
				<fieldset>
					<legend>Referências owner-only</legend>
					{#if data.detail.referenceAssets.length}
						<ul class="reference-list">
							{#each data.detail.referenceAssets as asset (asset.id)}
								<li class="reference-row">
									{#if asset.uploadStatus === 'READY'}
										<img
											src={`/api/media/${asset.id}?variant=thumb`}
											alt={`Referência ${asset.id.slice(0, 8)}`}
											loading="lazy"
											decoding="async"
										/>
									{:else}
										<span class="missing">indisponível</span>
									{/if}
									<label class="check">
										<input
											type="checkbox"
											name="referenceIds"
											value={asset.id}
											checked={data.detail.profile?.references.some(
												(reference) => reference.assetId === asset.id,
											) ?? false}
										/>
										{asset.assetKind} · {asset.width ?? '?'}×{asset.height ?? '?'} · {asset.id.slice(
											0,
											8,
										)}{asset.uploadStatus !== 'READY' ? ' · indisponível' : ''}
									</label>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint">
							Nenhuma imagem READY. Importe referências na biblioteca visual para vinculá-las.
						</p>
					{/if}
					<label>
						Foto-chave
						<select name="primaryReferenceAssetId">
							<option value="">Sem foto-chave</option>
							{#each data.detail.referenceAssets as asset (asset.id)}
								<option
									value={asset.id}
									selected={data.detail.profile?.primaryReferenceAssetId === asset.id}
								>
									{asset.assetKind} · {asset.id.slice(0, 8)}
								</option>
							{/each}
						</select>
					</label>
				</fieldset>
				<div class="actions">
					<button class="primary" type="submit">Salvar DRAFT</button>
					<button type="submit" formaction="?/approve">Salvar e aprovar</button>
				</div>
			</form>
			{#if data.detail.profile}
				<p class="hint export-links">
					Exportar perfil:
					<a
						href={resolve('/api/identity/[characterId]/export?format=json', {
							characterId: data.detail.characterId,
						})}>JSON</a
					>
					·
					<a
						href={resolve('/api/identity/[characterId]/export?format=md', {
							characterId: data.detail.characterId,
						})}>Markdown</a
					>
				</p>
			{/if}
			{#if data.detail.versions.length}
				<h3>Versões</h3>
				<ul class="versions">
					{#each data.detail.versions as version (version.version)}
						<li>
							<span>v{version.version} · {version.changeNote || 'sem nota'}</span>
							<form method="POST" action="?/restore">
								<input type="hidden" name="characterId" value={data.detail.characterId} />
								<input type="hidden" name="expectedVersion" value={expectedVersion} />
								<input type="hidden" name="version" value={version.version} />
								<button type="submit">Restaurar como DRAFT</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="panel">
			<h2>Prévia para o Flow</h2>
			{#if data.episodes.length}
				<form class="selector" method="GET">
					<input type="hidden" name="seriesId" value={data.selectedSeries?.id ?? ''} />
					<input type="hidden" name="characterId" value={data.detail.characterId} />
					<label for="identity-episode">Episódio de referência</label>
					<select
						id="identity-episode"
						name="episodeId"
						onchange={(event) => event.currentTarget.form?.requestSubmit()}
					>
						{#each data.episodes as episode (episode.id)}
							<option value={episode.id} selected={episode.id === data.episodeId}>
								E{episode.number} — {episode.title}
							</option>
						{/each}
					</select>
				</form>
			{/if}
			{#if data.anchorPreview}
				<h3>Âncora gerada</h3>
				<p class="anchor">{data.anchorPreview}</p>
				<h3>Checklist</h3>
				<ul class="checklist">
					{#each data.checklistPreview as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
				{#if data.episodeId}
					<a
						class="inline-link"
						href={resolve(`/app/continuity/visual?episodeId=${data.episodeId}`)}
					>
						Inspecionar continuidade visual deste episódio
					</a>
				{/if}
			{:else}
				<p class="hint">Salve o perfil para gerar a âncora e a checklist.</p>
			{/if}

			{#if data.bundle?.rows.length}
				<h3>Prompts por cena</h3>
				{#each data.bundle.rows as row (row.sceneId)}
					<article class="prompt-row">
						<header>
							<strong>Cena {row.sceneIndex}</strong>
							<span>{row.characterNames.join(', ')}</span>
						</header>
						<pre>{row.composedPrompt}</pre>
					</article>
				{/each}
			{/if}
			{#if data.bundle?.unmatchedScenes.length}
				<p class="hint">
					Cenas sem personagem reconhecido nas notas: {data.bundle.unmatchedScenes.join(', ')}. A
					correspondência usa nome/alias exato; revise manualmente.
				</p>
			{/if}
			{#if data.bundle?.missingProfiles.length}
				<p class="hint">
					Sem perfil: {data.bundle.missingProfiles.map((item) => item.name).join(', ')}.
				</p>
			{/if}
			{#if data.bundle?.limitations.length}
				<ul class="limitations">
					{#each data.bundle.limitations as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			{/if}
			<p class="hint">
				Os prompts existentes do episódio não são sobrescritos. Este material é uma camada derivada
				para copiar ao Flow; a aprovação humana continua obrigatória.
			</p>
		</section>
	</div>
{/if}

<style>
	.selector {
		display: grid;
		gap: 0.35rem;
		margin-block: 0.9rem;
		max-width: 34rem;
	}
	.selector select {
		width: 100%;
		min-width: 0;
		max-width: 100%;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
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
	.identity-form {
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
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.5rem;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		margin: 0;
		padding: 0.6rem;
	}
	.reference-list {
		display: grid;
		gap: 0.35rem;
		max-height: 14rem;
		overflow: auto;
		padding: 0;
		margin: 0 0 0.5rem;
		list-style: none;
	}
	.reference-row {
		display: grid;
		grid-template-columns: 3.2rem 1fr;
		gap: 0.45rem;
		align-items: center;
	}
	.reference-row img,
	.reference-row .missing {
		width: 3.2rem;
		height: 3.2rem;
		object-fit: cover;
		border-radius: var(--radius-sm);
		background: #050505;
	}
	.reference-row .missing {
		display: grid;
		place-items: center;
		font-size: 0.58rem;
		text-align: center;
	}
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.35rem;
		align-items: center;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.versions {
		display: grid;
		gap: 0.4rem;
		padding: 0;
		list-style: none;
	}
	.versions li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.75rem;
	}
	.anchor {
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #0b0b0b;
		font-size: 0.8rem;
	}
	.checklist,
	.limitations {
		display: grid;
		gap: 0.3rem;
		margin: 0;
		padding-left: 1.1rem;
		color: var(--muted);
		font-size: 0.78rem;
	}
	.prompt-row {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 0.6rem;
		background: #0b0b0b;
	}
	.prompt-row header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	pre {
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.72rem;
		margin: 0.4rem 0 0;
	}
	.inline-link {
		font-size: 0.78rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.empty {
		color: var(--muted);
		margin-block: 1rem;
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
</style>
