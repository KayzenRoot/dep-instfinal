<script lang="ts">
	export let eyebrow = '';
	export let title: string;
	export let description = '';
	export let stamp = '';
</script>

<header class="page-heading">
	<div class="heading-copy">
		{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
		<div class="title-row">
			<h1>{title}</h1>
			{#if stamp}<span class="record-stamp">{stamp}</span>{/if}
		</div>
		{#if description}<p class="description">{description}</p>{/if}
	</div>
	<div class="heading-actions"><slot name="actions" /></div>
</header>

<style>
	.page-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: clamp(1.6rem, 4vw, 3rem);
		padding-bottom: 1.45rem;
		border-bottom: 1px solid var(--line);
	}

	.heading-copy {
		min-width: 0;
	}

	.eyebrow {
		margin-bottom: 0.8rem;
		color: var(--phosphor);
	}

	.title-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.8rem 1rem;
	}

	h1 {
		margin: 0;
	}

	.description {
		max-width: 46rem;
		margin: 0.85rem 0 0;
		color: var(--muted);
		font-size: 0.98rem;
	}

	.record-stamp {
		padding: 0.34rem 0.55rem;
		border: 1px solid rgb(183 63 85 / 45%);
		color: #dd7889;
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		transform: rotate(-2deg);
	}

	.heading-actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.65rem;
	}

	@media (max-width: 680px) {
		.page-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.heading-actions {
			width: 100%;
			flex-wrap: wrap;
		}
	}
</style>
