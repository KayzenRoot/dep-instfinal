<script lang="ts">
	import type { StatusTone } from './ui-types';

	export let label: string;
	export let tone: StatusTone = 'neutral';
	export let dot = true;
</script>

<span
	class="status-pill"
	class:tone-good={tone === 'good'}
	class:tone-warning={tone === 'warning'}
	class:tone-danger={tone === 'danger'}
	class:tone-phosphor={tone === 'phosphor'}
>
	{#if dot}<span class="status-dot" aria-hidden="true"></span>{/if}
	<span>{label}</span>
</span>

<style>
	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		width: fit-content;
		padding: 0.35rem 0.58rem;
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		background: rgb(255 255 255 / 2%);
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.64rem;
		letter-spacing: 0.07em;
		line-height: 1;
		text-transform: uppercase;
	}

	.status-dot {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 0.6rem currentColor;
	}

	.tone-good {
		border-color: rgb(169 197 108 / 32%);
		color: var(--phosphor);
	}

	.tone-warning {
		border-color: rgb(217 160 90 / 35%);
		color: #d9a05a;
	}

	.tone-danger {
		border-color: rgb(183 63 85 / 40%);
		color: #dd7889;
	}

	.tone-phosphor {
		border-color: rgb(169 197 108 / 32%);
		background: rgb(169 197 108 / 8%);
		color: var(--phosphor);
	}
</style>
