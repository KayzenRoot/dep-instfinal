<script lang="ts">
	import { resolve } from '$app/paths';
	import NavGlyph from './NavGlyph.svelte';
	import type { GlyphName } from './glyph';

	export let currentPath = '/app';
	export let mobile = false;
	export let onNavigate: (() => void) | undefined = undefined;

	type NavItem = { path: string; href: string; label: string; glyph: GlyphName };
	const items: NavItem[] = [
		{ path: '/app', href: resolve('/app'), label: 'Painel', glyph: 'archive' },
		{ path: '/app/series', href: resolve('/app/series'), label: 'Séries', glyph: 'book' },
		{ path: '/app/episodes', href: resolve('/app/episodes'), label: 'Episódios', glyph: 'film' },
		{
			path: '/app/storyboard',
			href: resolve('/app/storyboard'),
			label: 'Storyboard',
			glyph: 'frames',
		},
		{
			path: '/app/library',
			href: resolve('/app/library'),
			label: 'Biblioteca visual',
			glyph: 'library',
		},
		{
			path: '/app/continuity',
			href: resolve('/app/continuity'),
			label: 'Votações e cânone',
			glyph: 'branch',
		},
		{ path: '/app/export', href: resolve('/app/export'), label: 'Exportar', glyph: 'export' },
		{
			path: '/app/settings',
			href: resolve('/app/settings'),
			label: 'Configurações',
			glyph: 'settings',
		},
	];

	function isActive(href: string): boolean {
		const normalizedPath = currentPath.replace(/\/$/, '') || '/';
		return normalizedPath === href || (href !== '/app' && normalizedPath.startsWith(`${href}/`));
	}
</script>

<nav aria-label={mobile ? 'Navegação rápida' : 'Navegação principal'} class:mobile-nav={mobile}>
	{#each items as item (item.href)}
		<a
			class="nav-link"
			class:active={isActive(item.path)}
			href={item.href}
			aria-current={isActive(item.path) ? 'page' : undefined}
			onclick={onNavigate}
		>
			<NavGlyph name={item.glyph} />
			<span>{item.label}</span>
			{#if isActive(item.path)}<span class="active-marker" aria-hidden="true"></span>{/if}
		</a>
	{/each}
</nav>

<style>
	nav {
		display: grid;
		gap: 0.25rem;
	}

	.nav-link {
		position: relative;
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.8rem;
		padding: 0.55rem 0.75rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--muted);
		font-size: 0.83rem;
		text-decoration: none;
		transition:
			color 140ms ease,
			background 140ms ease,
			border-color 140ms ease;
	}

	.nav-link:hover {
		border-color: var(--line);
		background: rgb(255 255 255 / 3%);
		color: var(--ink);
	}

	.nav-link.active {
		border-color: rgb(183 63 85 / 22%);
		background: linear-gradient(90deg, rgb(183 63 85 / 13%), rgb(183 63 85 / 3%));
		color: var(--ink);
	}

	.nav-link.active :global(svg) {
		color: #dd7889;
	}

	.active-marker {
		position: absolute;
		top: 0.5rem;
		bottom: 0.5rem;
		left: -1px;
		width: 2px;
		border-radius: 2px;
		background: var(--danger);
		box-shadow: 0 0 0.75rem rgb(183 63 85 / 55%);
	}

	.mobile-nav {
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.3rem;
	}

	.mobile-nav .nav-link {
		min-height: 3.5rem;
		flex-direction: column;
		justify-content: center;
		gap: 0.24rem;
		padding: 0.35rem 0.15rem;
		font-size: 0.64rem;
		text-align: center;
	}

	.mobile-nav .nav-link span:first-of-type {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mobile-nav .nav-link:nth-child(4),
	.mobile-nav .nav-link:nth-child(n + 6) {
		display: none;
	}

	.mobile-nav .active-marker {
		top: auto;
		right: 0.45rem;
		bottom: 0;
		left: 0.45rem;
		width: auto;
		height: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-link {
			transition: none;
		}
	}
</style>
