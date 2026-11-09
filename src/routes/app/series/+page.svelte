<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Séries · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="ARQUIVO PRIVADO"
	title="Séries"
	description="Cada série reúne a bíblia, temporadas, personagens e regras de continuidade."
/>
<Panel eyebrow="CATÁLOGO" title={`${data.series.length} séries`}>
	{#if data.series.length}
		<div class="rows">
			{#each data.series as series (series.id)}<a
					class="row"
					href={resolve('/app/series/[seriesId]', { seriesId: series.id })}
					><span class="record-id">{series.status}</span><span class="row-copy"
						><strong>{series.title}</strong><small
							>{series.subgenre || 'Subgênero pendente'} · {series.seasons?.length ?? 0} temporadas</small
						></span
					><StatusPill
						label={series.status}
						tone={series.status === 'ACTIVE' ? 'phosphor' : 'neutral'}
					/><span aria-hidden="true">↗</span></a
				>{/each}
		</div>
	{:else}<p class="quiet">
			Ainda não há séries. Use o formulário no painel para abrir o primeiro arquivo.
		</p>
		<a class="link" href={resolve('/app')}>Ir ao painel</a>{/if}
</Panel>

<style>
	.rows {
		display: grid;
	}
	.row {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.8rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
	}
	.row:last-child {
		border: 0;
	}
	.row-copy {
		display: grid;
		gap: 0.15rem;
	}
	.row-copy strong {
		font-size: 0.85rem;
	}
	.row-copy small,
	.quiet {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.record-id {
		font: 0.6rem var(--mono);
		color: var(--dim);
	}
	.link {
		color: var(--phosphor);
		font-size: 0.78rem;
	}
	@media (max-width: 520px) {
		.row {
			grid-template-columns: 1fr auto;
		}
		.record-id {
			display: none;
		}
		.row :global(.status-pill) {
			grid-column: 1;
		}
		.row > span:last-child {
			grid-column: 2;
			grid-row: 1;
		}
	}
</style>
