<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data }: PageProps = $props();
	const rows = $derived([
		{
			label: 'PostgreSQL e autenticação',
			ready: data.integrations.supabase && data.integrations.owner,
			note: 'Sessão validada no servidor; política RLS por proprietário.',
		},
		{
			label: 'Cloudinary privado',
			ready: data.integrations.cloudinary,
			note: 'Uploads e acesso a quadros exigem configuração server-only.',
		},
		{
			label: 'Geração de texto',
			ready: data.integrations.textProvider === 'READY',
			note: 'O editor manual funciona sem geração automática.',
		},
	]);
</script>

<svelte:head><title>Configurações · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="SISTEMA PRIVADO"
	title="Configurações"
	description="Status das integrações sem expor URLs, credenciais ou chaves."
/>
<div class="settings-grid">
	<Panel eyebrow="INTEGRAÇÕES" title="Disponibilidade"
		><div class="rows">
			{#each rows as row (row.label)}<div class="row">
					<div><strong>{row.label}</strong><small>{row.note}</small></div>
					<StatusPill
						label={row.ready ? 'CONFIGURADO' : 'MANUAL / BLOQUEADO'}
						tone={row.ready ? 'phosphor' : 'neutral'}
					/>
				</div>{/each}
		</div></Panel
	><Panel eyebrow="SESSÃO" title="Proprietário"
		><p>{data.ownerLabel}</p>
		<p class="quiet">
			Cadastros públicos estão desativados. Acesso ao estúdio exige o UID autorizado no servidor.
		</p>
		<a class="manifest-link" href={resolve('/api/backup/manifest')}>Baixar manifesto de mídia ↗</a>
		<form method="POST" action="/auth/logout">
			<button class="secondary-button" type="submit">Encerrar todas as sessões</button>
		</form></Panel
	>
</div>

<style>
	.settings-grid {
		display: grid;
		grid-template-columns: 1.3fr 0.7fr;
		gap: 1rem;
		align-items: start;
	}
	.rows {
		display: grid;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--line);
	}
	.row div {
		display: grid;
		gap: 0.2rem;
	}
	.row strong {
		font-size: 0.79rem;
	}
	.row small,
	.quiet {
		color: var(--muted);
		font-size: 0.68rem;
	}
	.secondary-button {
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #171a20;
		color: var(--ink);
		font-size: 0.72rem;
		cursor: pointer;
	}
	.manifest-link {
		display: block;
		margin: 0.8rem 0;
		color: var(--phosphor);
		font-size: 0.72rem;
	}
	@media (max-width: 760px) {
		.settings-grid {
			grid-template-columns: 1fr;
		}
		.row {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
