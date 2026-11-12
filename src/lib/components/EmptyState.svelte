<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	export let eyebrow = 'ARQUIVO VAZIO';
	export let title: string;
	export let description: string;
	export let actionLabel = '';
	export let href: ResolvedPathname | null = null;
</script>

<div class="empty-state">
	<span class="empty-mark" aria-hidden="true"><span></span><span></span><span></span></span>
	<div class="empty-copy">
		<p class="empty-eyebrow">{eyebrow}</p>
		<h2>{title}</h2>
		<p class="empty-description">{description}</p>
		{#if actionLabel && href}
			<a class="empty-action" {href}>{actionLabel}<span aria-hidden="true">↗</span></a>
		{/if}
	</div>
</div>

<style>
	.empty-state {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr);
		align-items: start;
		gap: 1rem;
		padding: clamp(1.2rem, 3vw, 2rem);
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		background: rgb(255 255 255 / 1.2%);
	}

	.empty-mark {
		display: flex;
		width: 3.5rem;
		height: 3.5rem;
		align-items: center;
		justify-content: center;
		gap: 0.22rem;
		border: 1px solid rgb(183 63 85 / 35%);
		border-radius: 50%;
		background: rgb(183 63 85 / 6%);
	}

	.empty-mark span {
		width: 2px;
		border-radius: 2px;
		background: var(--danger);
	}

	.empty-mark span:nth-child(1) {
		height: 0.65rem;
		opacity: 0.55;
	}
	.empty-mark span:nth-child(2) {
		height: 1.2rem;
	}
	.empty-mark span:nth-child(3) {
		height: 0.85rem;
		opacity: 0.7;
	}

	.empty-eyebrow {
		margin: 0 0 0.45rem;
		color: var(--phosphor);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.13em;
	}

	h2 {
		margin: 0;
		font-size: 1.7rem;
	}

	.empty-description {
		max-width: 38rem;
		margin: 0.45rem 0 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	.empty-action {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 1.1rem;
		color: var(--phosphor);
		font-size: 0.84rem;
		font-weight: 600;
		text-decoration: none;
	}

	.empty-action span {
		font-family: var(--mono);
	}

	.empty-action:hover {
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}

	@media (max-width: 520px) {
		.empty-state {
			grid-template-columns: 1fr;
		}
	}
</style>
