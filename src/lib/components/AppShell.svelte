<script lang="ts">
	import { resolve } from '$app/paths';
	import NavGlyph from './NavGlyph.svelte';
	import StatusPill from './StatusPill.svelte';
	import WorkspaceNav from './WorkspaceNav.svelte';

	export let currentPath = '/app';
	export let ownerLabel = 'Proprietária';
	let mobileMenuOpen = false;

	function closeOnEscape(event: KeyboardEvent): void {
		if (event.key === 'Escape') mobileMenuOpen = false;
	}
</script>

<svelte:window onkeydown={closeOnEscape} />

<div class="studio-frame">
	<aside class="desktop-sidebar" aria-label="DIF Studio">
		<a class="brand" href={resolve('/app')} aria-label="DIF Studio — Painel">
			<span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
			<span class="brand-copy"><strong>DIF</strong><small>ARQUIVO VIVO</small></span>
		</a>

		<div class="case-label">
			<span class="case-led" aria-hidden="true"></span><span>ESTÚDIO PRIVADO</span>
		</div>
		<p class="nav-heading">ESPAÇO DE TRABALHO</p>
		<WorkspaceNav {currentPath} />

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
					aria-label={mobileMenuOpen ? 'Fechar navegação' : 'Abrir navegação'}
					aria-expanded={mobileMenuOpen}
					aria-controls="mobile-menu"
					onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
				>
					<NavGlyph name={mobileMenuOpen ? 'close' : 'menu'} />
				</button>
				<div class="console-label">
					<span>CONSOLE</span><span aria-hidden="true">/</span><strong>ARQUIVO 17</strong>
				</div>
			</div>
			<div class="topbar-state">
				<StatusPill label="Sessão privada" tone="phosphor" /><span class="build-mark"
					>DIF / 001</span
				>
			</div>
		</header>

		<div id="mobile-menu" class="mobile-menu" hidden={!mobileMenuOpen}>
			<WorkspaceNav {currentPath} onNavigate={() => (mobileMenuOpen = false)} />
		</div>

		<main class="workspace-content"><slot /></main>
		<footer class="workspace-footer">
			<span>ESTÚDIO DIF</span><span>RASCUNHOS E CANÔNE PERMANECEM SOB CONTROLE DA AUTORA</span>
		</footer>
	</div>

	<nav class="mobile-dock" aria-label="Navegação rápida"><WorkspaceNav {currentPath} mobile /></nav>
</div>

<style>
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
		border-right: 1px solid var(--line);
		background: linear-gradient(180deg, rgb(255 255 255 / 1.2%), transparent 18rem), #0d0f12;
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
		border: 1px solid rgb(183 63 85 / 60%);
		border-radius: 0.3rem;
		background: linear-gradient(140deg, rgb(183 63 85 / 18%), transparent);
	}

	.brand-mark span {
		width: 2px;
		background: var(--danger);
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
		background: var(--phosphor);
		box-shadow: 0 0 0.8rem rgb(169 197 108 / 35%);
	}

	.nav-heading {
		margin: 1.45rem 0 0.6rem 0.75rem;
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
		border: 1px solid rgb(240 236 229 / 16%);
		background: rgb(255 255 255 / 2%);
	}

	.reel-track span:nth-child(2),
	.reel-track span:nth-child(3) {
		border-color: rgb(183 63 85 / 45%);
		background: rgb(183 63 85 / 15%);
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
		border: 1px solid var(--line-strong);
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
		border-bottom: 1px solid var(--line);
		background: rgb(8 9 11 / 86%);
		backdrop-filter: blur(14px);
	}

	.topbar-start,
	.topbar-state,
	.console-label {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.console-label {
		color: var(--dim);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
	}

	.console-label strong {
		color: var(--paper);
		font-weight: 500;
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
			border: 1px solid var(--line-strong);
			border-radius: var(--radius-sm);
			background: var(--panel);
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
			padding: 0.75rem 1rem 1rem;
			border-bottom: 1px solid var(--line-strong);
			background: #0d0f12;
			box-shadow: 0 1rem 2rem rgb(0 0 0 / 38%);
		}
		.mobile-menu[hidden] {
			display: none;
		}
		.mobile-menu :global(nav) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.mobile-dock {
			position: fixed;
			right: 0;
			bottom: 0;
			left: 0;
			z-index: 9;
			display: block;
			padding: 0.35rem 0.55rem calc(0.35rem + env(safe-area-inset-bottom));
			border-top: 1px solid var(--line-strong);
			background: rgb(10 11 13 / 94%);
			backdrop-filter: blur(14px);
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
</style>
