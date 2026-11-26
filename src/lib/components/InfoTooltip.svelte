<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { getHelpEntry, type HelpKey } from '#lib/domain/help-catalog.js';

	export let helpKey: HelpKey;
	export let id: string;

	let open = false;
	let pinned = false;
	let trigger: HTMLButtonElement | undefined;
	let panel: HTMLDivElement | undefined;
	let wrapper: HTMLSpanElement | undefined;
	let panelStyle = 'left:8px;top:8px';

	$: entry = getHelpEntry(helpKey);
	$: panelId = `${id}-tooltip`;

	async function show(): Promise<void> {
		if (open) return;
		open = true;
		await tick();
		positionPanel();
	}

	async function positionPanel(): Promise<void> {
		if (!trigger || !panel) return;
		const margin = 8;
		const viewportWidth = document.documentElement.clientWidth;
		const viewportHeight = document.documentElement.clientHeight;
		const panelWidth = Math.min(320, viewportWidth - margin * 2);
		panel.style.width = `${panelWidth}px`;
		panel.style.maxWidth = `${panelWidth}px`;
		const rect = trigger.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		let left = Math.round(rect.left + rect.width / 2 - panelRect.width / 2);
		left = Math.max(margin, Math.min(left, viewportWidth - panelRect.width - margin));
		let top = Math.round(rect.bottom + 8);
		if (top + panelRect.height > viewportHeight - margin) {
			top = rect.top - panelRect.height - 8;
		}
		top = Math.max(margin, Math.min(top, viewportHeight - panelRect.height - margin));
		panelStyle = `left:${left}px;top:${top}px`;
	}

	function close(): void {
		open = false;
		pinned = false;
	}

	function toggle(): void {
		pinned = !pinned;
		if (pinned) void show();
		else open = false;
	}

	function onFocus(): void {
		void show();
	}

	function onBlur(event: FocusEvent): void {
		const next = event.relatedTarget as Node | null;
		if (!pinned && !wrapper?.contains(next)) close();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !open) return;
		event.stopPropagation();
		close();
		trigger?.focus();
	}

	function onPointerDown(event: PointerEvent): void {
		const target = event.target as Node;
		if (open && !wrapper?.contains(target) && !panel?.contains(target)) close();
	}

	function portal(node: HTMLElement): { destroy(): void } {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			},
		};
	}

	function onViewportChange(): void {
		if (open) void positionPanel();
	}

	onMount(() => {
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	onDestroy(() => close());
</script>

<svelte:window onkeydown={onKeydown} onresize={onViewportChange} onscroll={onViewportChange} />

<span class="help-tooltip" class:open bind:this={wrapper} data-testid={`help-${id}`}>
	<button
		type="button"
		class="help-trigger"
		bind:this={trigger}
		aria-label={`Ajuda sobre ${entry.title}`}
		aria-expanded={open}
		aria-controls={panelId}
		aria-describedby={open ? panelId : undefined}
		data-help-key={helpKey}
		onclick={toggle}
		onfocus={onFocus}
		onblur={onBlur}
		onmouseenter={() => {
			if (!pinned) void show();
		}}
		onmouseleave={() => {
			if (!pinned) open = false;
		}}
	>
		<span aria-hidden="true">?</span>
	</button>

	{#if open}
		<div
			class="help-panel"
			role="tooltip"
			id={panelId}
			bind:this={panel}
			style={panelStyle}
			use:portal
		>
			<p class="help-kicker">AJUDA CONTEXTUAL</p>
			<p class="help-title">{entry.title}</p>
			<p class="help-copy">{entry.description}</p>
			{#if entry.steps?.length}
				<ol class="help-steps">
					{#each entry.steps as step (step)}
						<li>{step}</li>
					{/each}
				</ol>
			{/if}
			{#if entry.constraint}
				<p class="help-constraint">{entry.constraint}</p>
			{/if}
		</div>
	{/if}
</span>

<style>
	.help-tooltip {
		position: relative;
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
	}

	.help-trigger {
		display: grid;
		width: 1.35rem;
		height: 1.35rem;
		flex: 0 0 auto;
		place-items: center;
		padding: 0;
		border: 1px solid var(--glass-border);
		border-radius: 50%;
		background: rgb(0 216 245 / 7%);
		color: var(--cyan);
		font-family: var(--mono);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1;
		cursor: help;
		transition:
			border-color 160ms ease,
			background 160ms ease,
			box-shadow 160ms ease;
	}

	.help-trigger:hover,
	.help-trigger:focus-visible,
	.help-tooltip.open .help-trigger {
		border-color: rgb(0 216 245 / 55%);
		background: rgb(0 216 245 / 14%);
		box-shadow: var(--glow-cyan);
	}

	.help-panel {
		position: fixed;
		z-index: 80;
		width: min(20rem, calc(100vw - 1rem));
		max-height: min(24rem, calc(100vh - 1rem));
		padding: 0.8rem 0.9rem;
		overflow-y: auto;
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		background: var(--glass-bg-strong);
		box-shadow:
			0 18px 40px rgb(0 0 0 / 38%),
			inset 0 1px 0 rgb(255 255 255 / 7%);
		backdrop-filter: blur(18px) saturate(1.1);
	}

	.help-kicker,
	.help-title,
	.help-copy,
	.help-constraint,
	.help-steps {
		margin: 0;
	}

	.help-kicker {
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.56rem;
		letter-spacing: 0.14em;
	}

	.help-title {
		margin-top: 0.22rem;
		color: var(--ink);
		font-family: var(--display);
		font-size: 1.15rem;
		line-height: 1.15;
	}

	.help-copy {
		margin-top: 0.42rem;
		color: var(--muted);
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.help-steps {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.55rem;
		padding-left: 1.1rem;
		color: var(--muted);
		font-size: 0.74rem;
	}

	.help-constraint {
		margin-top: 0.55rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line);
		color: var(--paper);
		font-size: 0.72rem;
		line-height: 1.4;
	}

	@supports not (backdrop-filter: blur(1px)) {
		.help-panel {
			background: #0d1526;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.help-trigger {
			transition: none;
		}
	}
</style>
