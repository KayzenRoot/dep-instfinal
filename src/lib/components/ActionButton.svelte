<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	export let label = '';
	export let href: ResolvedPathname | null = null;
	export let variant: 'primary' | 'secondary' | 'quiet' | 'danger' = 'secondary';
	export let type: 'button' | 'submit' | 'reset' = 'button';
	export let disabled = false;
	export let loading = false;
</script>

{#if href && !disabled && !loading}
	<a
		class="action-button"
		class:primary={variant === 'primary'}
		class:quiet={variant === 'quiet'}
		class:danger={variant === 'danger'}
		{href}
	>
		<span class="button-content"><slot>{label}</slot></span>
	</a>
{:else}
	<button
		class="action-button"
		class:primary={variant === 'primary'}
		class:quiet={variant === 'quiet'}
		class:danger={variant === 'danger'}
		{type}
		disabled={disabled || loading}
		aria-busy={loading}
	>
		{#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
		<span class="button-content"><slot>{label}</slot></span>
		{#if loading}<span class="sr-only">Carregando</span>{/if}
	</button>
{/if}

<style>
	.action-button {
		display: inline-flex;
		min-height: 2.65rem;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.58rem 0.9rem;
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-sm);
		background: linear-gradient(180deg, rgb(255 255 255 / 5%), rgb(255 255 255 / 1%));
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.2;
		text-decoration: none;
		cursor: pointer;
		transition:
			background 160ms ease,
			border-color 160ms ease,
			box-shadow 160ms ease,
			transform 160ms ease;
	}

	.action-button:hover:not(:disabled) {
		border-color: rgb(0 216 245 / 42%);
		background: rgb(0 216 245 / 8%);
		box-shadow: var(--glow-cyan);
		transform: translateY(-1px);
	}

	.action-button.primary {
		border-color: rgb(0 216 245 / 55%);
		background: linear-gradient(145deg, var(--cyan), var(--emerald));
		color: #041018;
	}

	.action-button.primary:hover:not(:disabled) {
		border-color: #7ff2ff;
		background: linear-gradient(145deg, #62e9ff, #5be9c2);
	}

	.action-button.quiet {
		border-color: transparent;
		background: transparent;
		color: var(--muted);
	}

	.action-button.danger {
		border-color: rgb(248 113 113 / 46%);
		background: rgb(248 113 113 / 10%);
		color: #fca5a5;
	}

	.action-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.button-content {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.spinner {
		width: 0.85rem;
		height: 0.85rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.action-button {
			transition: none;
		}
		.action-button:hover:not(:disabled) {
			transform: none;
		}
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
