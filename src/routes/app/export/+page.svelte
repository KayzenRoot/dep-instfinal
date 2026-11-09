<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Exportar · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="FLOW · CAPCUT · SOCIAL"
	title="Exportar produção"
	description="Prepare arquivos de apoio para o trabalho manual. O ZIP não publica nem renderiza vídeo."
/>
<Panel eyebrow="PACOTES DE EPISÓDIO" title="Escolha um episódio">
	{#if data.episodes.length}<div class="rows">
			{#each data.episodes as episode (episode.id)}<div class="row">
					<div>
						<strong>{episode.title}</strong><small
							>{episode.seasons?.series?.title ?? 'Série'} · {episode.seasons?.title ?? 'Temporada'} ·
							{Math.floor(episode.duration_ms / 1000)}s</small
						>
					</div>
					<a href={resolve('/app/export/[episodeId]', { episodeId: episode.id })}>Preparar ZIP ↗</a>
				</div>{/each}
		</div>{:else}<p>Crie um episódio para preparar a primeira entrega.</p>
		<a href={resolve('/app/series')}>Ir às séries</a>{/if}
</Panel>

<style>
	.rows {
		display: grid;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
	}
	.row div {
		display: grid;
		gap: 0.2rem;
	}
	.row strong {
		font-size: 0.82rem;
	}
	.row small {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.row a {
		color: var(--phosphor);
		font-size: 0.73rem;
		white-space: nowrap;
	}
</style>
