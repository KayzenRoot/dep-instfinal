<script lang="ts">
	import type { PageProps } from './$types';
	let { form }: PageProps = $props();
</script>

<svelte:head><title>Atualizar senha · DIF Studio</title></svelte:head>

<main class="auth-page">
	<section class="auth-card" aria-labelledby="password-title">
		<p class="auth-eyebrow">DIF STUDIO · CONTA DO PROPRIETÁRIO</p>
		<h1 id="password-title">Defina uma nova senha</h1>
		<p>Use pelo menos 12 caracteres. A sessão será encerrada após a atualização.</p>
		{#if form?.message}<p role="alert" class="auth-message">{form.message}</p>{/if}
		<form method="POST">
			<label for="password">Nova senha</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength="12"
				maxlength="128"
				required
			/>
			<label for="confirmPassword">Confirme a senha</label>
			<input
				id="confirmPassword"
				name="confirmPassword"
				type="password"
				autocomplete="new-password"
				minlength="12"
				maxlength="128"
				required
			/>
			<button type="submit">Atualizar senha e encerrar sessões</button>
		</form>
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
	.auth-message {
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--raised);
	}
</style>
