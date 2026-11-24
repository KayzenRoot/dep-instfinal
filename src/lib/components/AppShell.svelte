<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import NavGlyph from './NavGlyph.svelte';
	import StatusPill from './StatusPill.svelte';
	import WorkspaceNav from './WorkspaceNav.svelte';
	import { groupLabelForPath } from './nav-items';

	export let currentPath = '/app';
	export let ownerLabel = 'Proprietária';
	let mobileMenuOpen = false;
	let menuToggle: HTMLButtonElement | undefined;
	let workspaceMain: HTMLElement | undefined;

	$: sectionLabel = groupLabelForPath(currentPath);

	async function closeOnEscape(event: KeyboardEvent): Promise<void> {
		if (event.key !== 'Escape' || !mobileMenuOpen) return;
		const drawer = document.getElementById('mobile-menu');
		const restoreFocus = drawer?.contains(document.activeElement) ?? false;
		mobileMenuOpen = false;
		if (restoreFocus) {
			await tick();
			menuToggle?.focus();
		}
	}

	function skipToWorkspace(event: MouseEvent): void {
		event.preventDefault();
		workspaceMain?.focus();
	}
</script>

<svelte:window onkeydown={closeOnEscape} />

<a class="skip-link" href="#workspace-main" onclick={skipToWorkspace}>Pular para o conteúdo</a>

<div class="studio-frame">
	<aside class="desktop-sidebar" aria-label="DIF Studio" data-testid="desktop-nav">
		<a class="brand" href={resolve('/app')} aria-label="DIF Studio — Painel">
			<span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
			<span class="brand-copy"><strong>DIF</strong><small>ARQUIVO VIVO</small></span>
		</a>

		<div class="case-label">
			<span class="case-led" aria-hidden="true"></span><span>ESTÚDIO PRIVADO</span>
		</div>
		<p class="nav-heading">ESPAÇO DE TRABALHO</p>
		<WorkspaceNav {currentPath} navId="sidebar" />

		<div class="sidebar-bottom">
			<div class="reel-track" aria-hidden="true">
				<span></span><span></span><span></span><span></span><span></span><span></span><span
				></span><span></span>
			</div>
			<p>FLOW E PUBLICAÇÃO<br />SEGUEM MANUAIS</p>
			<div class="owner-chip">
				<span class="owner-seal" aria-hidden="true">D</span><span
					><small>ACESSO</small><strong>{ownerLabel}</strong></span
				>
			</div>
		</div>
	</aside>

	<div class="main-column">
		<header class="topbar">
			<div class="topbar-start">
				<button
					class="menu-toggle"
					type="button"
					bind:this={menuToggle}
					aria-label={mobileMenuOpen ? 'Fechar navegação' : 'Abrir navegação'}
					aria-expanded={mobileMenuOpen}
					aria-controls="mobile-menu"
					onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
				>
					<NavGlyph name={mobileMenuOpen ? 'close' : 'menu'} />
				</button>
				<div class="console-label">
					<span>CONSOLE</span><span aria-hidden="true">/</span><strong>{sectionLabel}</strong>
				</div>
			</div>
			<div class="topbar-state">
				<StatusPill label="Sessão privada" tone="phosphor" /><span class="build-mark"
					>DIF / 002</span
				>
			</div>
		</header>

		<div id="mobile-menu" class="mobile-menu" hidden={!mobileMenuOpen}>
			<WorkspaceNav {currentPath} navId="drawer" onNavigate={() => (mobileMenuOpen = false)} />
		</div>

		<main id="workspace-main" bind:this={workspaceMain} class="workspace-content" tabindex="-1">
			<slot />
		</main>
		<footer class="workspace-footer">
			<span>ESTÚDIO DIF</span><span>RASCUNHOS E CANÔNE PERMANECEM SOB CONTROLE DA AUTORA</span>
		</footer>
	</div>

	<div class="mobile-dock"><WorkspaceNav {currentPath} mobile navId="dock" /></div>
</div>

<style>
	.skip-link {
		position: fixed;
		top: 0.65rem;
		left: 0.65rem;
		z-index: 100;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--cyan);
		border-radius: var(--radius-sm);
		background: var(--glass-bg-strong);
		color: var(--ink);
		font-size: 0.8rem;
		text-decoration: none;
		transform: translateY(-200%);
		transition: transform 140ms ease;
	}

	.skip-link:focus-visible {
		transform: translateY(0);
	}

	.studio-frame {
		min-height: 100vh;
	}

	.desktop-sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 10;
		display: flex;
		width: var(--sidebar-width);
		flex-direction: column;
		padding: 1.2rem 1rem 1rem;
		overflow-y: auto;
		border-right: 1px solid var(--glass-border);
		background:
			linear-gradient(180deg, rgb(0 216 245 / 5%), transparent 16rem), var(--glass-bg-strong);
		backdrop-filter: blur(18px) saturate(1.12);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0.4rem 1.2rem;
		text-decoration: none;
	}

	.brand-mark {
		position: relative;
		display: flex;
		width: 2.3rem;
		height: 2.3rem;
		align-items: center;
		justify-content: center;
		gap: 0.18rem;
		border: 1px solid rgb(0 216 245 / 55%);
		border-radius: 0.45rem;
		background: linear-gradient(140deg, rgb(0 216 245 / 18%), rgb(197 60 255 / 12%));
		box-shadow: var(--glow-cyan);
	}

	.brand-mark span {
		width: 2px;
		background: linear-gradient(180deg, var(--cyan), var(--magenta));
	}

	.brand-mark span:nth-child(1) {
		height: 0.65rem;
		opacity: 0.55;
	}
	.brand-mark span:nth-child(2) {
		height: 1.25rem;
	}
	.brand-mark span:nth-child(3) {
		height: 0.85rem;
		opacity: 0.7;
	}

	.brand-copy {
		display: flex;
		flex-direction: column;
		line-height: 1;
	}

	.brand-copy strong {
		font-family: var(--display);
		font-size: 1.85rem;
		font-weight: 600;
		letter-spacing: 0.06em;
	}

	.brand-copy small {
		margin-top: 0.28rem;
		color: var(--muted);
		font-size: 0.64rem;
		letter-spacing: 0.18em;
	}

	.case-label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.65rem 0.7rem;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.12em;
	}

	.case-led {
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: var(--emerald);
		box-shadow: 0 0 0.8rem rgb(34 211 166 / 45%);
	}

	.nav-heading {
		margin: 1.35rem 0 0.55rem 0.75rem;
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.11em;
	}

	.sidebar-bottom {
		margin-top: auto;
		padding: 1rem 0.4rem 0;
		border-top: 1px solid var(--line);
	}

	.reel-track {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 0.27rem;
		margin-bottom: 0.7rem;
	}

	.reel-track span {
		height: 0.28rem;
		border: 1px solid rgb(164 190 255 / 18%);
		background: rgb(255 255 255 / 2%);
	}

	.reel-track span:nth-child(2),
	.reel-track span:nth-child(3) {
		border-color: rgb(0 216 245 / 45%);
		background: rgb(0 216 245 / 15%);
	}

	.sidebar-bottom > p {
		margin: 0;
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		line-height: 1.6;
	}

	.owner-chip {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin-top: 1rem;
		padding-top: 0.85rem;
		border-top: 1px solid var(--line);
	}

	.owner-seal {
		display: grid;
		width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		border: 1px solid var(--glass-border);
		border-radius: 50%;
		color: var(--paper);
		font-family: var(--display);
		font-size: 1.1rem;
	}

	.owner-chip > span:last-child {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.owner-chip small {
		color: var(--dim);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
	}

	.owner-chip strong {
		font-size: 0.73rem;
		font-weight: 500;
	}

	.main-column {
		min-height: 100vh;
		margin-left: var(--sidebar-width);
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 8;
		display: flex;
		min-height: 3.8rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem clamp(1rem, 3vw, 2.5rem);
		border-bottom: 1px solid var(--glass-border);
		background: var(--glass-bg-strong);
		backdrop-filter: blur(18px) saturate(1.1);
	}

	.topbar-start,
	.topbar-state,
	.console-label {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.topbar-start {
		min-width: 0;
		flex: 1 1 auto;
	}

	.topbar-state {
		flex: 0 0 auto;
	}

	.console-label {
		min-width: 0;
		overflow: hidden;
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
	}

	.console-label strong {
		min-width: 0;
		overflow: hidden;
		color: var(--paper);
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.build-mark {
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
	}

	.menu-toggle,
	.mobile-menu,
	.mobile-dock {
		display: none;
	}

	.workspace-content {
		width: min(100%, 94rem);
		min-height: calc(100vh - 7rem);
		margin-inline: auto;
		padding: clamp(1.25rem, 4vw, 3.5rem);
	}

	.workspace-content:focus {
		outline: none;
	}

	.workspace-content:focus-visible {
		outline: 2px solid var(--cyan);
		outline-offset: 6px;
	}

	.workspace-footer {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0 2.5rem 1.25rem;
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.09em;
	}

	@supports not (backdrop-filter: blur(1px)) {
		.desktop-sidebar,
		.topbar,
		.mobile-menu,
		.mobile-dock {
			background: #0d1526;
		}
	}

	@media (max-width: 850px) {
		:global(:root) {
			--sidebar-width: 0rem;
		}
		.desktop-sidebar {
			display: none;
		}
		.main-column {
			margin-left: 0;
		}
		.menu-toggle {
			display: grid;
			width: 2.3rem;
			height: 2.3rem;
			place-items: center;
			border: 1px solid var(--glass-border);
			border-radius: var(--radius-sm);
			background: var(--glass-bg);
			cursor: pointer;
		}
		.menu-toggle :global(svg) {
			width: 1rem;
			height: 1rem;
		}
		.mobile-menu {
			position: fixed;
			inset: 3.8rem 0 auto 0;
			z-index: 20;
			display: block;
			max-height: calc(100dvh - 3.8rem);
			padding: 0.9rem 1rem 5.5rem;
			overflow-y: auto;
			border-bottom: 1px solid var(--glass-border);
			background: var(--glass-bg-strong);
			box-shadow: 0 1rem 2rem rgb(0 0 0 / 45%);
			backdrop-filter: blur(18px) saturate(1.1);
		}
		.mobile-menu[hidden] {
			display: none;
		}
		.mobile-menu :global(nav) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: start;
		}
		.mobile-dock {
			position: fixed;
			right: 0;
			bottom: 0;
			left: 0;
			z-index: 9;
			display: block;
			padding: 0.35rem 0.55rem calc(0.35rem + env(safe-area-inset-bottom));
			border-top: 1px solid var(--glass-border);
			background: var(--glass-bg-strong);
			backdrop-filter: blur(18px) saturate(1.1);
		}
		.workspace-content {
			min-height: calc(100vh - 9rem);
			padding-bottom: 6rem;
		}
		.workspace-footer {
			display: none;
		}
	}

	@media (max-width: 520px) {
		.build-mark {
			display: none;
		}
		.topbar-state :global(.status-pill) {
			padding: 0.32rem 0.45rem;
			font-size: 0.6rem;
		}
		.console-label {
			font-size: 0.6rem;
		}
		.workspace-content {
			padding-inline: 1rem;
		}
	}

	@media (max-width: 380px) {
		.topbar {
			gap: 0.5rem;
			padding-inline: 0.75rem;
		}
		.topbar-start {
			gap: 0.5rem;
		}
		.topbar-state {
			gap: 0.35rem;
		}
		.topbar-state :global(.status-pill) {
			padding: 0.3rem 0.38rem;
			font-size: 0.56rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skip-link {
			transition: none;
		}
	}
</style>
