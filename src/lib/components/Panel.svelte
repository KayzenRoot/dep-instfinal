<script lang="ts">
	export let title = '';
	export let eyebrow = '';
	export let description = '';
	export let tone: 'default' | 'quiet' | 'evidence' = 'default';
</script>

<section
	class="panel"
	class:panel-quiet={tone === 'quiet'}
	class:panel-evidence={tone === 'evidence'}
>
	{#if title || eyebrow || description || $$slots.actions}
		<header class="panel-header">
			<div>
				{#if eyebrow}<p class="panel-eyebrow">{eyebrow}</p>{/if}
				{#if title}<h2>{title}</h2>{/if}
				{#if description}<p class="panel-description">{description}</p>{/if}
			</div>
			<div class="panel-actions"><slot name="actions" /></div>
		</header>
	{/if}
	<div class="panel-content"><slot /></div>
</section>

<style>
	.panel {
		position: relative;
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		background: linear-gradient(145deg, var(--glass-highlight), transparent 42%), var(--glass-bg);
		box-shadow:
			0 18px 48px rgb(0 0 0 / 28%),
			inset 0 1px 0 rgb(255 255 255 / 6%);
		backdrop-filter: blur(14px) saturate(1.08);
	}

	.panel-quiet {
		background: var(--glass-bg-strong);
		box-shadow: none;
	}

	.panel-evidence::before {
		position: absolute;
		inset: 0 auto 0 0;
		width: 3px;
		background: linear-gradient(180deg, var(--cyan), var(--violet));
		content: '';
	}

	@supports not (backdrop-filter: blur(1px)) {
		.panel {
			background: var(--panel);
		}
		.panel-quiet {
			background: #0d1526;
		}
	}

	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.2rem 1.25rem 0;
	}

	.panel-header h2 {
		margin: 0;
		font-size: 1.45rem;
	}

	.panel-eyebrow {
		margin: 0 0 0.45rem;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.panel-description {
		max-width: 42rem;
		margin: 0.45rem 0 0;
		color: var(--muted);
		font-size: 0.86rem;
	}

	.panel-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.panel-content {
		padding: 1.25rem;
	}

	.panel-header + .panel-content {
		padding-top: 1rem;
	}

	@media (max-width: 560px) {
		.panel-header {
			padding-inline: 1rem;
		}

		.panel-content {
			padding: 1rem;
		}
	}
</style>
