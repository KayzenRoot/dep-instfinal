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
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: linear-gradient(180deg, rgb(255 255 255 / 4%), rgb(255 255 255 / 1%));
		color: var(--ink);
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.2;
		text-decoration: none;
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			transform 140ms ease;
	}

	.action-button:hover:not(:disabled) {
		border-color: rgb(240 236 229 / 34%);
		background: rgb(255 255 255 / 7%);
		transform: translateY(-1px);
	}

	.action-button.primary {
		border-color: rgb(169 197 108 / 45%);
		background: linear-gradient(145deg, #a9c56c, #7f9c4a);
		color: #10130b;
	}

	.action-button.primary:hover:not(:disabled) {
		border-color: #c4dc8f;
		background: linear-gradient(145deg, #c0d987, #8ba957);
	}

	.action-button.quiet {
		border-color: transparent;
		background: transparent;
		color: var(--muted);
	}

	.action-button.danger {
		border-color: rgb(183 63 85 / 46%);
		background: rgb(183 63 85 / 10%);
		color: #ed9aaa;
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
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
