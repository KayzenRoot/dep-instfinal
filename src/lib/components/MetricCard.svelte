<script lang="ts">
	export let label: string;
	export let value: string | number;
	export let detail = '';
	export let marker = '';
	export let tone: 'neutral' | 'phosphor' | 'danger' = 'neutral';
</script>

<article
	class="metric-card"
	class:metric-phosphor={tone === 'phosphor'}
	class:metric-danger={tone === 'danger'}
>
	<div class="metric-topline">
		<p class="metric-label">{label}</p>
		{#if marker}<span class="metric-marker" aria-hidden="true">{marker}</span>{/if}
	</div>
	<p class="metric-value">{value}</p>
	{#if detail}<p class="metric-detail">{detail}</p>{/if}
</article>

<style>
	.metric-card {
		position: relative;
		min-width: 0;
		padding: 1.15rem 1.2rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: linear-gradient(145deg, rgb(255 255 255 / 2%), transparent 55%), var(--panel);
	}

	.metric-topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.metric-label,
	.metric-detail {
		margin: 0;
		color: var(--muted);
		font-size: 0.8rem;
	}

	.metric-marker {
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.68rem;
	}

	.metric-value {
		margin: 0.75rem 0 0.25rem;
		color: var(--ink);
		font-family: var(--display);
		font-size: clamp(2rem, 3vw, 2.8rem);
		line-height: 1;
	}

	.metric-phosphor .metric-value {
		color: var(--phosphor);
	}

	.metric-danger .metric-value {
		color: #dd7889;
	}
</style>
