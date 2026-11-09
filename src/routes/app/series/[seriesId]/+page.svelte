<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data, form }: PageProps = $props();
	const seasonEpisodes = (seasonId: string) =>
		data.episodes.filter((episode) => episode.season_id === seasonId);
</script>

<svelte:head><title>{data.series.title} · DIF Studio</title></svelte:head>

<PageHeading
	eyebrow="SÉRIE · BÍBLIA"
	title={data.series.title}
	description="Mantenha premissa, personagens e fatos consistentes. Cada temporada pode planejar de 10 a 15 episódios."
	stamp="ARQUIVO PRIVADO"
>
	<svelte:fragment slot="actions"
		><a class="back-link" href={resolve('/app/series')}>← Séries</a></svelte:fragment
	>
</PageHeading>

{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
{#if form?.saved || form?.seasonCreated || form?.characterCreated || form?.loreCreated || form?.loreUpdated}<p
		class="form-success"
		role="status"
	>
		Registro salvo.
	</p>{/if}

<div class="series-grid">
	<Panel eyebrow="BÍBLIA" title="Identidade da série">
		<form method="POST" action="?/saveSeries" class="form-stack">
			<label>Título<input name="title" maxlength="120" required value={data.series.title} /></label>
			<label
				>Premissa<textarea name="premise" rows="4" maxlength="8000">{data.series.premise}</textarea
				></label
			>
			<div class="form-row">
				<label
					>Subgênero<input name="subgenre" maxlength="120" value={data.series.subgenre} /></label
				><label>Tom<input name="tone" maxlength="120" value={data.series.tone} /></label>
			</div>
			<label>Público<input name="audience" maxlength="500" value={data.series.audience} /></label>
			<button class="primary-button" type="submit">Salvar bíblia</button>
		</form>
	</Panel>
	<Panel
		eyebrow="NOVA TEMPORADA"
		title="Planejar temporada"
		description="A contagem do plano deve ficar entre 10 e 15 episódios."
	>
		<form method="POST" action="?/createSeason" class="form-stack">
			<div class="form-row">
				<label
					>Número<input
						name="seasonNumber"
						type="number"
						min="1"
						max="99"
						required
						value={data.seasons.length + 1}
					/></label
				><label
					>Episódios planejados<input
						name="plannedEpisodeCount"
						type="number"
						min="10"
						max="15"
						value="12"
						required
					/></label
				>
			</div>
			<label>Título<input name="title" maxlength="120" required placeholder="Temporada 1" /></label>
			<label>Resumo<textarea name="summary" rows="3" maxlength="8000"></textarea></label>
			<button class="secondary-button" type="submit">Adicionar temporada</button>
		</form>
	</Panel>
</div>

<section class="collection-section" aria-labelledby="seasons-title">
	<header class="section-heading">
		<div>
			<p class="eyebrow">PLANEJAMENTO</p>
			<h2 id="seasons-title">Temporadas e episódios</h2>
		</div>
		<span class="count-tag">{data.seasons.length} TEMPORADAS</span>
	</header>
	{#if data.seasons.length === 0}<p class="empty-note">
			Nenhuma temporada foi criada neste arquivo.
		</p>{/if}
	<div class="season-list">
		{#each data.seasons as season (season.id)}
			<Panel
				eyebrow={`TEMPORADA ${String(season.season_number).padStart(2, '0')}`}
				title={season.title}
				description={`${seasonEpisodes(season.id).length} / ${season.planned_episode_count} episódios planejados`}
			>
				{#if season.summary}<p class="season-summary">{season.summary}</p>{/if}
				{#if seasonEpisodes(season.id).length}
					<div class="episode-list">
						{#each seasonEpisodes(season.id) as episode (episode.id)}
							<a
								class="episode-row"
								href={resolve('/app/episodes/[episodeId]', { episodeId: episode.id })}
								><span class="episode-number"
									>E{String(episode.episode_number).padStart(2, '0')}</span
								><strong>{episode.title}</strong><StatusPill
									label={episode.status}
									tone={episode.status === 'PUBLISHED'
										? 'danger'
										: episode.status === 'READY'
											? 'phosphor'
											: 'neutral'}
								/><span>{Math.floor(episode.duration_ms / 1000)}s</span></a
							>
						{/each}
					</div>
				{/if}
				<div class="new-episode">
					<h3>Novo episódio</h3>
					<form method="POST" action="?/createEpisode" class="form-row episode-form">
						<input type="hidden" name="seasonId" value={season.id} />
						<label
							>Número<input
								name="episodeNumber"
								type="number"
								min="1"
								max="99"
								required
								value={seasonEpisodes(season.id).length + 1}
							/></label
						>
						<label
							>Título<input
								name="title"
								maxlength="180"
								required
								placeholder="Título do episódio"
							/></label
						>
						<label
							>Duração<input
								name="durationSeconds"
								type="number"
								min="90"
								max="150"
								required
								value="120"
							/></label
						>
						<label class="check-label"
							><input type="checkbox" name="isSeasonFinale" /> Final de temporada</label
						>
						<button class="secondary-button" type="submit">Criar rascunho</button>
					</form>
				</div>
			</Panel>
		{/each}
	</div>
</section>

<div class="series-grid">
	<Panel eyebrow="ELENCO" title="Personagens">
		{#if data.characters.length}<div class="fact-list">
				{#each data.characters as character (character.id)}<article class="fact-row">
						<strong>{character.name}</strong><span>{character.role || 'Papel não definido'}</span>
						<p>{character.description || character.arc_notes || 'Descrição pendente.'}</p>
						{#if character.visual_description}<small>VISUAL · {character.visual_description}</small
							>{/if}
					</article>{/each}
			</div>{:else}<p class="quiet-copy">Nenhum personagem cadastrado.</p>{/if}
		<form method="POST" action="?/createCharacter" class="form-stack create-form">
			<h3>Adicionar personagem</h3>
			<label>Nome<input name="name" maxlength="120" required /></label>
			<label>Papel na história<input name="role" maxlength="120" /></label>
			<label>Descrição<textarea name="description" rows="2" maxlength="4000"></textarea></label>
			<label
				>Descrição visual<textarea name="visualDescription" rows="2" maxlength="4000"
				></textarea></label
			>
			<label>Notas de voz<textarea name="voiceNotes" rows="2" maxlength="2000"></textarea></label>
			<label>Arco narrativo<textarea name="arcNotes" rows="2" maxlength="4000"></textarea></label>
			<button class="secondary-button" type="submit">Salvar personagem</button>
		</form>
	</Panel>

	<Panel
		eyebrow="MEMÓRIA"
		title="Fatos de continuidade"
		description="Regras, pistas e marcos ficam registrados para consulta durante a escrita."
	>
		{#if data.lore.length}<div class="fact-list">
				{#each data.lore as fact (fact.id)}<article class="fact-row">
						<div class="fact-title">
							<strong>{fact.title}</strong><StatusPill
								label={fact.status}
								tone={fact.status === 'ACTIVE' ? 'phosphor' : 'neutral'}
							/>
						</div>
						<small>{fact.category} · IMPORTÂNCIA {fact.importance}/5</small>
						<p>{fact.fact}</p>
						<form method="POST" action="?/setLoreStatus" class="status-form">
							<input type="hidden" name="id" value={fact.id} /><label
								>Estado<select name="status" value={fact.status}
									><option value="ACTIVE">Ativo</option><option value="SUPERSEDED">Superado</option
									><option value="ARCHIVED">Arquivado</option></select
								></label
							><button type="submit">Atualizar</button>
						</form>
					</article>{/each}
			</div>{:else}<p class="quiet-copy">
				Nenhum fato ainda. Registre aqui as regras e pistas que precisam permanecer consistentes.
			</p>{/if}
		<form method="POST" action="?/createLore" class="form-stack create-form">
			<h3>Adicionar fato</h3>
			<label
				>Categoria<select name="category"
					><option value="RULE">Regra</option><option value="CLUE">Pista</option><option
						value="TIMELINE">Linha do tempo</option
					><option value="OBJECT">Objeto</option><option value="PLACE">Lugar</option><option
						value="RELATIONSHIP">Relação</option
					><option value="OTHER">Outro</option></select
				></label
			>
			<label>Título<input name="title" maxlength="160" required /></label>
			<label>Fato<textarea name="fact" rows="3" maxlength="8000" required></textarea></label>
			<label
				>Importância<select name="importance"
					><option value="1">1 · referência</option><option value="2">2</option><option
						value="3"
						selected>3 · relevante</option
					><option value="4">4</option><option value="5">5 · regra central</option></select
				></label
			>
			<button class="secondary-button" type="submit">Registrar fato</button>
		</form>
	</Panel>
</div>

<style>
	.series-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		align-items: start;
		margin-bottom: 1.2rem;
	}
	.collection-section {
		margin: 2.5rem 0;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.section-heading h2 {
		margin: 0;
	}
	.count-tag {
		color: var(--muted);
		font: 0.62rem var(--mono);
		letter-spacing: 0.09em;
	}
	.season-list {
		display: grid;
		gap: 1rem;
	}
	.season-summary,
	.quiet-copy,
	.empty-note {
		color: var(--muted);
		font-size: 0.83rem;
	}
	.episode-list {
		display: grid;
		border-top: 1px solid var(--line);
		margin-bottom: 1.1rem;
	}
	.episode-row {
		display: grid;
		grid-template-columns: 3.1rem minmax(0, 1fr) auto 3rem;
		gap: 0.7rem;
		align-items: center;
		padding: 0.75rem 0.25rem;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
		font-size: 0.75rem;
	}
	.episode-row strong {
		font-size: 0.83rem;
	}
	.episode-number {
		color: var(--phosphor);
		font: 0.68rem var(--mono);
	}
	.new-episode {
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.new-episode h3,
	.create-form h3 {
		margin: 0;
		font-size: 1.2rem;
	}
	.episode-form {
		grid-template-columns: 5rem minmax(10rem, 1fr) 6rem auto auto;
		align-items: end;
		margin-top: 0.7rem;
	}
	.check-label {
		display: flex !important;
		align-items: center;
		gap: 0.5rem !important;
		min-height: 2.7rem;
		white-space: nowrap;
	}
	.check-label input {
		accent-color: var(--phosphor);
	}
	.fact-list {
		display: grid;
	}
	.fact-row {
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
	}
	.fact-row > span,
	.fact-row small {
		color: var(--muted);
		font-size: 0.68rem;
	}
	.fact-row p {
		margin: 0.4rem 0;
		color: var(--ink);
		font-size: 0.8rem;
	}
	.fact-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
	}
	.status-form {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}
	.status-form label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.65rem;
	}
	.status-form select,
	.status-form button {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
	}
	.status-form button {
		cursor: pointer;
	}
	.form-stack {
		display: grid;
		gap: 0.7rem;
	}
	.form-stack label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.74rem;
	}
	.form-stack input,
	.form-stack textarea,
	.form-stack select,
	.episode-form input {
		width: 100%;
		padding: 0.58rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
	}
	.form-stack textarea {
		resize: vertical;
	}
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.65rem;
	}
	.create-form {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.primary-button,
	.secondary-button {
		min-height: 2.6rem;
		padding: 0.55rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 3%);
		color: var(--ink);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary-button {
		border-color: rgb(169 197 108 / 48%);
		background: linear-gradient(145deg, #a9c56c, #7f9c4a);
		color: #10130b;
	}
	.form-error,
	.form-success {
		padding: 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
	}
	.form-error {
		border-color: rgb(183 63 85 / 45%);
		color: #ed9aaa;
	}
	.form-success {
		color: var(--phosphor);
	}
	.back-link {
		color: var(--muted);
		text-decoration: none;
	}
	@media (max-width: 1050px) {
		.episode-form {
			grid-template-columns: 1fr 2fr 1fr;
		}
	}
	@media (max-width: 760px) {
		.series-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 520px) {
		.episode-row {
			grid-template-columns: 2.7rem minmax(0, 1fr) auto;
		}
		.episode-row > span:last-child {
			display: none;
		}
		.episode-form {
			grid-template-columns: 1fr 1fr;
		}
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
