<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Continuidade · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="ESCOLHAS · HISTÓRICO"
	title="Votações e cânone"
	description="Nenhuma enquete é publicada ou contabilizada automaticamente. Cada decisão mantém seu histórico."
/>
{#if data.polls.length}<div class="poll-list">
		{#each data.polls as poll (poll.id)}<Panel
				eyebrow={`${poll.episodes?.seasons?.series?.title ?? 'SÉRIE'} · EPISÓDIO ${String(poll.episodes?.episode_number ?? 0).padStart(2, '0')}`}
				title={poll.episodes?.title ?? 'Episódio'}
				description={`Regra de empate: ${poll.tie_break_rule} · vence opção ${poll.tie_break_option}`}
				><div class="poll-meta">
					<StatusPill
						label={poll.status}
						tone={poll.status === 'OPEN' ? 'danger' : 'phosphor'}
					/><span>Prazo final · {new Date(poll.closes_at).toLocaleString('pt-BR')}</span
					>{#if poll.external_post_id}<span>Post · {poll.external_post_id}</span>{/if}
				</div>
				{#if poll.poll_results?.length}<h3>Resultados</h3>
					<div class="history">
						{#each [...poll.poll_results].sort((a, b) => b.revision_number - a.revision_number) as result (result.id)}<article
							>
								<strong
									>R{String(result.revision_number).padStart(2, '0')} · {result.option_1_count} × {result.option_2_count}</strong
								><span
									>{result.winner_option ? `Opção ${result.winner_option}` : 'Sem votos'} · {result.verification_status}</span
								><small>{result.evidence_source}</small>
							</article>{/each}
					</div>{:else}<p class="quiet">
						Ainda não há totais verificados.
					</p>{/if}{#if poll.canonical_decisions?.length}<h3>Decisões aprovadas</h3>
					<div class="history">
						{#each [...poll.canonical_decisions].sort((a, b) => b.revision_number - a.revision_number) as decision (decision.id)}<article
							>
								<strong>DECISÃO R{String(decision.revision_number).padStart(2, '0')}</strong><span
									>{decision.rationale}</span
								><small>{new Date(decision.created_at).toLocaleString('pt-BR')}</small>
							</article>{/each}
					</div>{/if}<a href={resolve('/app/episodes/[episodeId]', { episodeId: poll.episode_id })}
					>Revisar episódio ↗</a
				></Panel
			>{/each}
	</div>{:else}<Panel
		eyebrow="REGISTRO VAZIO"
		title="Ainda não há votações."
		description="Publique manualmente um episódio com duas opções e registre a enquete aqui depois."
		><a href={resolve('/app/episodes')}>Ver episódios</a></Panel
	>{/if}

<style>
	.poll-list {
		display: grid;
		gap: 1rem;
	}
	.poll-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
		color: var(--muted);
		font-size: 0.69rem;
	}
	.poll-list h3 {
		margin: 0.9rem 0 0.4rem;
		font-size: 1.12rem;
	}
	.history {
		display: grid;
		gap: 0.35rem;
		margin-bottom: 0.8rem;
	}
	.history article {
		display: grid;
		gap: 0.15rem;
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.history strong {
		font-size: 0.73rem;
	}
	.history span,
	.history small,
	.quiet {
		color: var(--muted);
		font-size: 0.68rem;
		overflow-wrap: anywhere;
	}
	.poll-list a {
		color: var(--phosphor);
		font-size: 0.75rem;
	}
</style>
