<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const configured = $derived(data.supabaseConfigured && data.ownerConfigured);
</script>

<svelte:head>
	<title>Entrar · DIF Studio</title>
	<meta name="description" content="Acesso privado ao estúdio de histórias DIF." />
</svelte:head>

<main class="login-page">
	<div class="login-grain" aria-hidden="true"></div>
	<section class="login-card" aria-labelledby="login-title">
		<div class="login-mark" aria-hidden="true"><span></span><span></span><span></span></div>
		<p class="login-eyebrow">ESTÚDIO PRIVADO · ACESSO DO PROPRIETÁRIO</p>
		<h1 id="login-title">DIF <em>Studio</em></h1>
		<p class="login-intro">Abra o arquivo. Continue de onde a história parou.</p>

		{#if !configured}
			<div class="setup-note" role="status">
				<strong>Configuração pendente</strong>
				<p>
					Defina a URL e a chave publicável do Supabase, além do UID do proprietário, no ambiente do
					servidor. Nenhum cadastro público está disponível.
				</p>
			</div>
		{/if}

		{#if form?.message}
			<p class="form-message" role="alert">{form.message}</p>
		{/if}

		<form method="POST" class="login-form">
			<label for="email">E-mail do proprietário</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="username"
				inputmode="email"
				maxlength="254"
				required
				value={form?.email ?? ''}
				placeholder="nome@exemplo.com"
				disabled={!configured}
			/>

			<label for="password">Senha</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				maxlength="1024"
				required
				placeholder="Sua senha do Supabase Auth"
				disabled={!configured}
			/>

			<button class="login-submit" type="submit" disabled={!configured}>Entrar no arquivo</button>
		</form>

		<a class="recovery-link" href={resolve('/recover')}>Esqueci a senha</a>
		<div class="login-divider" aria-hidden="true">
			<span></span><small>SESSÃO PROTEGIDA</small><span></span>
		</div>
		<p class="login-footnote">As histórias e imagens ficam restritas à conta autorizada.</p>
	</section>
</main>

<style>
	.login-page {
		position: relative;
		display: grid;
		min-height: 100svh;
		place-items: center;
		overflow: hidden;
		padding: 2rem 1.1rem;
	}

	.login-page::before {
		position: absolute;
		inset: 8% 0 auto;
		height: 1px;
		background: linear-gradient(90deg, transparent, rgb(183 63 85 / 48%), transparent);
		content: '';
	}

	.login-grain {
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at 50% 42%, rgb(183 63 85 / 10%), transparent 38rem);
		pointer-events: none;
	}

	.login-card {
		position: relative;
		width: min(100%, 27rem);
		padding: clamp(1.5rem, 6vw, 2.8rem);
		border: 1px solid var(--line-strong);
		border-top: 2px solid var(--danger);
		border-radius: var(--radius-md);
		background: linear-gradient(155deg, rgb(255 255 255 / 2.6%), transparent 38%), var(--panel);
		box-shadow: 0 2rem 5rem rgb(0 0 0 / 38%);
	}

	.login-mark {
		display: flex;
		height: 2.3rem;
		align-items: center;
		gap: 0.23rem;
		margin-bottom: 1.6rem;
	}

	.login-mark span {
		width: 2px;
		background: var(--danger);
	}
	.login-mark span:nth-child(1) {
		height: 0.8rem;
		opacity: 0.45;
	}
	.login-mark span:nth-child(2) {
		height: 1.6rem;
	}
	.login-mark span:nth-child(3) {
		height: 1.1rem;
		opacity: 0.72;
	}

	.login-eyebrow,
	.login-divider small {
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
	}

	h1 {
		margin: 0.45rem 0 0;
		font-family: var(--display);
		font-size: clamp(3rem, 13vw, 4.4rem);
		font-weight: 500;
		letter-spacing: -0.045em;
		line-height: 0.95;
	}

	h1 em {
		color: var(--paper);
		font-weight: 400;
	}

	.login-intro {
		margin: 1rem 0 1.8rem;
		color: var(--muted);
	}

	.setup-note,
	.form-message {
		margin: 0 0 1.2rem;
		padding: 0.85rem 0.9rem;
		border: 1px solid rgb(183 63 85 / 42%);
		border-radius: var(--radius-sm);
		background: rgb(183 63 85 / 8%);
		color: #f3cbd1;
	}
	.setup-note strong {
		font-size: 0.85rem;
	}
	.setup-note p {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
	}
	.form-message {
		font-size: 0.85rem;
	}

	.login-form {
		display: grid;
		gap: 0.55rem;
	}

	.login-form label {
		margin-top: 0.6rem;
		color: var(--paper);
		font-size: 0.82rem;
	}

	.login-form input {
		width: 100%;
		min-height: 2.9rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
	}
	.login-form input::placeholder {
		color: #727879;
	}
	.login-form input:disabled {
		opacity: 0.55;
	}

	.login-submit {
		min-height: 3rem;
		margin-top: 0.95rem;
		padding: 0.65rem 1rem;
		border: 1px solid rgb(169 197 108 / 58%);
		border-radius: var(--radius-sm);
		background: rgb(169 197 108 / 12%);
		color: var(--ink);
		font-weight: 600;
		cursor: pointer;
	}
	.login-submit:hover:not(:disabled) {
		background: rgb(169 197 108 / 20%);
	}
	.login-submit:disabled {
		color: var(--muted);
		cursor: not-allowed;
	}

	.recovery-link {
		display: inline-block;
		margin-top: 1rem;
		color: var(--muted);
		font-size: 0.82rem;
	}

	.login-divider {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 2rem;
	}
	.login-divider span {
		height: 1px;
		flex: 1;
		background: var(--line);
	}
	.login-divider small {
		white-space: nowrap;
		font-size: 0.55rem;
	}

	.login-footnote {
		margin: 0.9rem 0 0;
		color: var(--dim);
		font-size: 0.75rem;
	}
</style>
