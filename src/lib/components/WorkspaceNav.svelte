<script lang="ts">
	import { resolve } from '$app/paths';
	import NavGlyph from './NavGlyph.svelte';
	import { NAV_GROUPS, isActivePath } from './nav-items';

	export let currentPath = '/app';
	export let mobile = false;
	export let onNavigate: (() => void) | undefined = undefined;
</script>

<nav
	aria-label={mobile ? 'Navegação rápida' : 'Navegação principal'}
	class:mobile-nav={mobile}
	data-testid={mobile ? 'quick-nav' : 'workspace-nav'}
>
	{#each NAV_GROUPS as group (group.id)}
		{@const visibleItems = mobile ? group.items.filter((item) => item.quick) : group.items}
		{#if visibleItems.length > 0}
			<div class="nav-group">
				{#if !mobile}
					<p class="nav-group-label" id={`nav-group-${group.id}`}>{group.label}</p>
				{/if}
				<ul aria-labelledby={mobile ? undefined : `nav-group-${group.id}`}>
					{#each visibleItems as item (item.path)}
						{@const active = isActivePath(currentPath, item.path)}
						<li>
							<a
								class="nav-link"
								class:active
								href={resolve(item.path as '/app')}
								aria-current={active ? 'page' : undefined}
								data-nav-path={item.path}
								onclick={onNavigate}
							>
								<NavGlyph name={item.glyph} />
								<span class="nav-label">{item.label}</span>
								{#if active}<span class="active-marker" aria-hidden="true"></span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/each}
</nav>

<style>
	nav {
		display: grid;
		gap: 1.05rem;
	}

	.nav-group {
		display: grid;
		min-width: 0;
		gap: 0.28rem;
	}

	.nav-group-label {
		margin: 0.1rem 0.7rem 0.18rem;
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.58rem;
		font-weight: 500;
		letter-spacing: 0.15em;
		line-height: 1.3;
		text-transform: uppercase;
	}

	ul {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		min-width: 0;
	}

	.nav-link {
		position: relative;
		display: flex;
		min-height: 2.5rem;
		align-items: center;
		gap: 0.72rem;
		padding: 0.48rem 0.7rem;
		overflow: hidden;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.2;
		text-decoration: none;
		transition:
			color 160ms ease,
			background 160ms ease,
			border-color 160ms ease,
			transform 160ms ease,
			box-shadow 160ms ease;
	}

	.nav-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-link:hover {
		border-color: var(--glass-border);
		background: rgb(0 216 245 / 7%);
		color: var(--ink);
		box-shadow: var(--glow-cyan);
	}

	.nav-link.active {
		border-color: rgb(0 216 245 / 32%);
		background:
			linear-gradient(90deg, rgb(0 216 245 / 13%), rgb(139 92 246 / 9%)), rgb(255 255 255 / 2%);
		color: var(--ink);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 8%),
			0 0 20px rgb(0 216 245 / 12%);
	}

	.nav-link.active :global(svg) {
		color: var(--cyan);
		filter: drop-shadow(0 0 6px rgb(0 216 245 / 45%));
	}

	.active-marker {
		position: absolute;
		top: 0.5rem;
		bottom: 0.5rem;
		left: -1px;
		width: 2px;
		border-radius: 2px;
		background: linear-gradient(180deg, var(--cyan), var(--violet));
		box-shadow: 0 0 0.75rem rgb(0 216 245 / 55%);
	}

	@media (hover: hover) and (pointer: fine) {
		.nav-link:hover {
			transform: translateY(-2px);
		}
	}

	.mobile-nav {
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.28rem;
	}

	.mobile-nav .nav-group {
		display: contents;
	}

	.mobile-nav ul {
		display: contents;
	}

	.mobile-nav .nav-link {
		min-height: 3.4rem;
		flex-direction: column;
		justify-content: center;
		gap: 0.22rem;
		padding: 0.3rem 0.12rem;
		border-radius: var(--radius-sm);
		font-size: 0.6rem;
		text-align: center;
	}

	.mobile-nav .nav-label {
		max-width: 100%;
		font-size: 0.6rem;
	}

	.mobile-nav .active-marker {
		top: auto;
		right: 0.5rem;
		bottom: 0;
		left: 0.5rem;
		width: auto;
		height: 2px;
		background: linear-gradient(90deg, var(--cyan), var(--magenta));
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-link {
			transition: none;
		}

		.nav-link:hover {
			transform: none;
		}
	}
</style>
