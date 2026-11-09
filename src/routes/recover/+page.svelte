<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Recuperar acesso · DIF Studio</title></svelte:head>

<main class="auth-page">
	<section class="auth-card" aria-labelledby="recovery-title">
		<p class="auth-eyebrow">DIF STUDIO · RECUPERAÇÃO OFICIAL</p>
		<h1 id="recovery-title">Voltar ao arquivo</h1>
		<p>Enviaremos um link do Supabase Auth se esta conta estiver habilitada.</p>
		{#if form?.message}<p role="status" class="auth-message">{form.message}</p>{/if}
		<form method="POST">
			<label for="email">E-mail do proprietário</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="username"
				maxlength="254"
				required
				disabled={!data.configured}
			/>
			<button type="submit" disabled={!data.configured}>Enviar instruções</button>
		</form>
		{#if !data.configured}<p class="setup" role="status">
				A configuração do Supabase está pendente.
			</p>{/if}
		<a href={resolve('/login')}>Voltar ao login</a>
	</section>
</main>

<style>
	.auth-page {
		display: grid;
		min-height: 100svh;
		place-items: center;
		padding: 1.25rem;
	}
	.auth-card {
		width: min(100%, 28rem);
		padding: 2rem;
		border: 1px solid var(--line-strong);
		border-top: 2px solid var(--danger);
		border-radius: var(--radius-md);
		background: var(--panel);
	}
	.auth-eyebrow {
		color: var(--phosphor);
		font-family: var(--mono);
		font-size: 0.65rem;
		letter-spacing: 0.1em;
	}
	h1 {
		margin: 1rem 0 0.4rem;
		font-family: var(--display);
		font-size: 2.8rem;
		font-weight: 500;
	}
	.auth-card > p:not(.auth-eyebrow) {
		color: var(--muted);
	}
	.auth-card form {
		display: grid;
		gap: 0.7rem;
		margin: 1.5rem 0;
	}
	.auth-card label {
		font-size: 0.82rem;
	}
	.auth-card input {
		min-height: 2.8rem;
		padding: 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
	}
	.auth-card button {
		min-height: 2.8rem;
		border: 1px solid rgb(169 197 108 / 58%);
		border-radius: var(--radius-sm);
		background: rgb(169 197 108 / 12%);
		color: var(--ink);
		cursor: pointer;
	}
	.auth-card button:disabled {
		color: var(--muted);
		cursor: not-allowed;
	}
	.auth-card a {
		color: var(--muted);
		font-size: 0.82rem;
	}
	.auth-message,
	.setup {
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--raised);
	}
	.setup {
		border-color: rgb(183 63 85 / 42%);
	}
</style>
