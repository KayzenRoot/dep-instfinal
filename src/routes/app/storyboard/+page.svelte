<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data }: PageProps = $props();
	const format = (ms: number) =>
		`${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
</script>

<svelte:head><title>Storyboard · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="IMAGEM E MOVIMENTO"
	title="Storyboard"
	description="Oito segundos por cena, com prompts em inglês e narração em português."
/>
{#if data.episodes.length}<div class="episode-stack">
		{#each data.episodes as episode (episode.id)}<Panel
				eyebrow={`${episode.seasons?.series?.title ?? 'SÉRIE'} · ${episode.seasons?.title ?? 'TEMPORADA'}`}
				title={episode.title}
				description={`${episode.scenes?.length ?? 0} cenas · ${Math.floor(episode.duration_ms / 1000)} segundos`}
				><div class="scene-strip">
					{#each episode.scenes ?? [] as scene (scene.id)}<a
							class="scene-chip"
							href={resolve(`/app/episodes/[episodeId]#scene-${scene.scene_index}`, {
								episodeId: episode.id,
							})}
							aria-label={`Editar cena ${scene.scene_index} de ${episode.title}`}
							><span>C{String(scene.scene_index).padStart(2, '0')}</span><small
								>{format(scene.start_ms)}–{format(scene.end_ms)}</small
							></a
						>{/each}
				</div>
				<div class="panel-bottom">
					<StatusPill
						label={episode.status}
						tone={episode.status === 'PUBLISHED'
							? 'danger'
							: episode.status === 'READY'
								? 'phosphor'
								: 'neutral'}
					/><a href={resolve('/app/episodes/[episodeId]', { episodeId: episode.id })}
						>Abrir cenas →</a
					>
				</div></Panel
			>{/each}
	</div>{:else}<Panel eyebrow="STORYBOARD VAZIO" title="Crie um episódio para montar as cenas."
		><a href={resolve('/app/series')}>Escolher uma série</a></Panel
	>{/if}

<style>
	.episode-stack {
		display: grid;
		gap: 1rem;
	}
	.scene-strip {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding: 0.25rem 0 0.6rem;
	}
	.scene-chip {
		display: grid;
		min-width: 5.3rem;
		gap: 0.3rem;
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		text-decoration: none;
	}
	.scene-chip span {
		color: var(--phosphor);
		font: 0.65rem var(--mono);
	}
	.scene-chip small {
		color: var(--muted);
		font: 0.55rem var(--mono);
		white-space: nowrap;
	}
	.panel-bottom {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 0.5rem;
		padding-top: 0.7rem;
		border-top: 1px solid var(--line);
	}
	.panel-bottom a {
		font-size: 0.73rem;
		color: var(--phosphor);
	}
</style>
