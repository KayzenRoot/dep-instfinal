<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Episódios · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="PRODUÇÃO NARRATIVA"
	title="Episódios"
	description="Roteiros, opções e revisões da biblioteca de produção."
/>
<Panel eyebrow="BIBLIOTECA" title={`${data.episodes.length} episódios`}>
	{#if data.episodes.length}<div class="episode-list">
			{#each data.episodes as episode (episode.id)}<a
					class="episode-row"
					href={resolve('/app/episodes/[episodeId]', { episodeId: episode.id })}
					><span class="mono">E{String(episode.episode_number).padStart(2, '0')}</span><span
						class="copy"
						><strong>{episode.title}</strong><small
							>{episode.seasons?.series?.title ?? 'Série'} · {episode.seasons?.title ??
								'Temporada'}</small
						></span
					><span class="duration"
						>{Math.floor(episode.duration_ms / 1000)}s{episode.is_season_finale
							? ' · FINAL'
							: ''}</span
					><StatusPill
						label={episode.status}
						tone={episode.status === 'PUBLISHED'
							? 'danger'
							: episode.status === 'READY'
								? 'phosphor'
								: 'neutral'}
					/></a
				>{/each}
		</div>{:else}<p class="quiet">
			Nenhum episódio foi criado. Abra uma série e planeje sua primeira temporada.
		</p>
		<a href={resolve('/app/series')}>Ver séries</a>{/if}
</Panel>

<style>
	.episode-list {
		display: grid;
	}
	.episode-row {
		display: grid;
		grid-template-columns: 3.2rem minmax(0, 1fr) 5rem auto;
		gap: 0.8rem;
		align-items: center;
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
	}
	.episode-row:last-child {
		border: 0;
	}
	.mono {
		color: var(--phosphor);
		font: 0.65rem var(--mono);
	}
	.copy {
		display: grid;
		gap: 0.15rem;
	}
	.copy strong {
		font-size: 0.82rem;
	}
	.copy small,
	.duration,
	.quiet {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.duration {
		font-family: var(--mono);
	}
	@media (max-width: 620px) {
		.episode-row {
			grid-template-columns: 2.7rem minmax(0, 1fr) auto;
		}
		.episode-row :global(.status-pill) {
			grid-column: 2;
		}
		.duration {
			grid-column: 3;
			grid-row: 1;
		}
	}
</style>
