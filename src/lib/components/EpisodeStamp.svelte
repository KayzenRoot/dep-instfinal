<script lang="ts">
	export let number: number;
	export let durationSeconds = 0;
	export let status: 'DRAFT' | 'READY' | 'PUBLISHED' = 'DRAFT';

	const statusLabel = {
		DRAFT: 'Rascunho',
		READY: 'Pronto para revisar',
		PUBLISHED: 'Publicado',
	};

	$: minutes = Math.floor(durationSeconds / 60);
	$: seconds = durationSeconds % 60;
</script>

<div
	class="episode-stamp"
	class:published={status === 'PUBLISHED'}
	class:ready={status === 'READY'}
>
	<div class="episode-index">
		<span class="episode-label">EPISÓDIO</span>
		<strong>{String(number).padStart(2, '0')}</strong>
	</div>
	<div class="stamp-meta">
		<span>{statusLabel[status]}</span>
		{#if durationSeconds > 0}<span class="duration"
				>{minutes}:{String(seconds).padStart(2, '0')}</span
			>{/if}
	</div>
</div>

<style>
	.episode-stamp {
		display: inline-flex;
		align-items: stretch;
		min-height: 3.3rem;
		border: 1px solid rgb(183 63 85 / 42%);
		border-left: 3px solid var(--danger);
		border-radius: var(--radius-sm);
		background: linear-gradient(100deg, rgb(183 63 85 / 10%), rgb(255 255 255 / 1%));
	}

	.episode-index,
	.stamp-meta {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0.45rem 0.65rem;
	}

	.episode-index {
		min-width: 3.25rem;
		align-items: center;
		border-right: 1px solid var(--line);
	}

	.episode-label {
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
	}

	.episode-index strong {
		color: var(--ink);
		font-family: var(--display);
		font-size: 1.35rem;
		font-weight: 500;
		line-height: 1;
	}

	.stamp-meta {
		gap: 0.12rem;
		color: var(--muted);
		font-size: 0.7rem;
	}

	.duration {
		color: var(--paper);
		font-family: var(--mono);
		font-size: 0.64rem;
	}

	.ready {
		border-color: rgb(169 197 108 / 40%);
		border-left-color: var(--phosphor);
		background: rgb(169 197 108 / 5%);
	}

	.published {
		border-color: var(--line-strong);
		border-left-color: var(--dim);
		background: rgb(255 255 255 / 1%);
	}
</style>
