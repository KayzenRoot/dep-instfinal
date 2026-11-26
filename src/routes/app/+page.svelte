<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import ActionButton from '#lib/components/ActionButton.svelte';
	import InfoTooltip from '#lib/components/InfoTooltip.svelte';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import MetricCard from '#lib/components/MetricCard.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Painel · DIF Studio</title>
	<meta name="description" content="Arquivo privado de histórias e episódios do DIF Studio." />
</svelte:head>

<PageHeading
	eyebrow="ARQUIVO · VISÃO GERAL"
	title="O sinal continua."
	description="Planeje temporadas, escreva episódios e mantenha as decisões de continuidade sob revisão humana."
	stamp="SISTEMA 001"
>
	<svelte:fragment slot="actions"
		><form method="POST" action="/auth/logout" class="logout-form">
			<button class="text-button" type="submit">Encerrar sessão</button>
		</form></svelte:fragment
	>
</PageHeading>

<section class="metrics" aria-label="Resumo do arquivo">
	<MetricCard
		label="SÉRIES"
		value={data.series.length}
		detail="arquivos privados"
		helpKey="dashboardSeries"
		helpId="help-dashboard-series"
	/>
	<MetricCard
		label="EPISÓDIOS"
		value={data.metrics.episodes}
		detail="em todas as temporadas"
		helpKey="dashboardEpisodes"
		helpId="help-dashboard-episodes"
	/>
	<MetricCard
		label="VOTAÇÕES ABERTAS"
		value={data.metrics.openPolls}
		detail="resultado sempre manual"
		helpKey="openPolls"
		helpId="help-dashboard-polls"
	/>
	<MetricCard
		label="QUADROS"
		value={data.metrics.media}
		detail="arquivos privados"
		helpKey="mediaAssets"
		helpId="help-dashboard-media"
	/>
</section>

<div class="dashboard-grid">
	<Panel
		eyebrow="PRODUÇÃO"
		title="Séries em andamento"
		description="Abra um arquivo para revisar temporadas, personagens, lore e episódios."
	>
		{#if data.series.length}
			<div class="series-list">
				{#each data.series as series (series.id)}
					<a class="series-row" href={resolve('/app/series/[seriesId]', { seriesId: series.id })}>
						<span class="series-index"
							>DIF / {String(data.series.indexOf(series) + 1).padStart(2, '0')}</span
						>
						<span class="series-copy"
							><strong>{series.title}</strong><small
								>{series.subgenre || 'Subgênero não definido'} · {series.seasons?.length ?? 0} temporadas</small
							></span
						>
						<StatusPill
							label={series.status}
							tone={series.status === 'ACTIVE' ? 'phosphor' : 'neutral'}
						/>
						<span class="series-arrow" aria-hidden="true">↗</span>
					</a>
				{/each}
			</div>
		{:else}
			<EmptyState
				title="O primeiro arquivo ainda não existe."
				description="Crie uma série para começar a guardar premissa, temporadas, personagens e fatos de continuidade."
			/>
		{/if}
	</Panel>

	<Panel
		eyebrow="NOVO REGISTRO"
		title="Criar série"
		description="A série começa como rascunho. O cânone só muda com uma decisão explícita."
	>
		{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
		<form class="form-stack" method="POST" action="?/createSeries">
			<div class="field">
				<div class="field-heading">
					<label for="series-title">Título</label>
					<InfoTooltip helpKey="seriesTitle" id="help-series-title" />
				</div>
				<input id="series-title" name="title" maxlength="120" required placeholder="O Arquivo 17" />
			</div>
			<div class="field">
				<div class="field-heading">
					<label for="series-premise">Premissa</label>
					<InfoTooltip helpKey="seriesPremise" id="help-series-premise" />
				</div>
				<textarea
					id="series-premise"
					name="premise"
					maxlength="8000"
					rows="4"
					placeholder="Uma frase para o mistério central."></textarea>
			</div>
			<div class="form-row">
				<div class="field">
					<div class="field-heading">
						<label for="series-subgenre">Subgênero</label>
						<InfoTooltip helpKey="seriesSubgenre" id="help-series-subgenre" />
					</div>
					<input
						id="series-subgenre"
						name="subgenre"
						maxlength="120"
						placeholder="Horror analógico"
					/>
				</div>
				<div class="field">
					<div class="field-heading">
						<label for="series-tone">Tom</label>
						<InfoTooltip helpKey="seriesTone" id="help-series-tone" />
					</div>
					<input id="series-tone" name="tone" maxlength="120" placeholder="Investigativo, íntimo" />
				</div>
			</div>
			<div class="field">
				<div class="field-heading">
					<label for="series-audience">Público pretendido</label>
					<InfoTooltip helpKey="seriesAudience" id="help-series-audience" />
				</div>
				<input
					id="series-audience"
					name="audience"
					maxlength="500"
					placeholder="Quem deve acompanhar a série?"
				/>
			</div>
			<ActionButton type="submit" variant="primary" label="Abrir novo arquivo"
				>Abrir novo arquivo <span aria-hidden="true">↗</span></ActionButton
			>
		</form>
	</Panel>
</div>

<style>
	.metrics {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.8rem;
		margin-bottom: 1.2rem;
	}
	.dashboard-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 0.8fr);
		gap: 1.2rem;
		align-items: start;
	}
	.series-list {
		display: grid;
		gap: 0.35rem;
	}
	.series-row {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr) auto auto;
		gap: 0.8rem;
		align-items: center;
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
	}
	.series-row:last-child {
		border-bottom: 0;
	}
	.series-row:hover .series-copy strong {
		color: var(--phosphor);
	}
	.series-index {
		color: var(--dim);
		font: 0.62rem var(--mono);
		letter-spacing: 0.08em;
	}
	.series-copy {
		display: grid;
		gap: 0.15rem;
	}
	.series-copy strong {
		font-size: 0.92rem;
		font-weight: 600;
		transition: color 140ms ease;
	}
	.series-copy small {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.series-arrow {
		color: var(--dim);
	}
	.form-stack {
		display: grid;
		gap: 0.8rem;
	}
	.field {
		display: grid;
		gap: 0.3rem;
	}
	.field-heading {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.field-heading label {
		display: block;
		margin: 0;
		color: inherit;
		font-size: inherit;
	}
	.form-stack label {
		display: grid;
		gap: 0.3rem;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.form-stack input,
	.form-stack textarea {
		width: 100%;
		padding: 0.65rem 0.72rem;
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
		gap: 0.7rem;
	}
	.text-button {
		min-height: auto;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--muted);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}
	.form-error {
		padding: 0.7rem;
		border: 1px solid rgb(183 63 85 / 45%);
		border-radius: var(--radius-sm);
		color: #ed9aaa;
	}
	@media (max-width: 980px) {
		.dashboard-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 760px) {
		.metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 480px) {
		.series-row {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.series-index {
			display: none;
		}
		.series-row :global(.status-pill) {
			grid-column: 1;
			justify-self: start;
		}
		.series-arrow {
			grid-column: 2;
			grid-row: 1;
		}
		.form-row {
			grid-template-columns: 1fr;
		}
	}
</style>
