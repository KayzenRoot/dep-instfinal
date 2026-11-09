<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Pacote · {data.episode.title} · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="EXPORTAÇÃO PRIVADA"
	title="Revisar pacote"
	description="O ZIP reúne conteúdo pronto para trabalho manual no Flow, CapCut e redes sociais."
	stamp={`EPISÓDIO ${String(data.episode.episode_number).padStart(2, '0')}`}
>
	<svelte:fragment slot="actions"
		><a
			class="back-link"
			href={resolve('/app/episodes/[episodeId]', { episodeId: data.episode.id })}
			>← Voltar ao episódio</a
		></svelte:fragment
	>
</PageHeading>
<div class="export-grid">
	<Panel eyebrow="CONTEÚDO" title={data.episode.title}
		><ul class="check-list">
			<li>Manifesto JSON com dimensões e status</li>
			<li>Timeline CSV com início, fim, narração e prompts</li>
			<li>Storyboard Markdown por cena</li>
			<li>Narração TXT em UTF-8</li>
			<li>Legendas SRT e índice CSV</li>
			<li>Legendas TikTok e Instagram, texto de capa</li>
			<li>Imagens privadas vinculadas, quando disponíveis</li>
			<li>Lista clara de conteúdo ausente</li>
		</ul></Panel
	><Panel eyebrow="REVISÃO" title="Pendências conhecidas"
		><div class="warnings">
			<p>
				<span>{data.warnings.missingSceneNotes}</span> cenas sem narração ou descrição visual completa
			</p>
			<p><span>{data.warnings.missingFrames}</span> quadros ausentes nas posições inicial/final</p>
			<p>
				<span>{data.warnings.missingChoices ? '!' : '✓'}</span>
				{data.warnings.missingChoices ? 'duas opções não estão salvas' : 'duas opções registradas'}
			</p>
		</div>
		<p class="manual-note">
			O pacote não gera vídeo nem publica conteúdo. Quadros com entrega privada indisponível são
			descritos em <code>missing_frames.json</code>.
		</p></Panel
	>
</div>
<Panel eyebrow="DOWNLOAD" title="Criar pacote ZIP"
	><p class="quiet">
		O pacote é montado durante o download. Cada imagem exige uma sessão autenticada e é obtida por
		uma URL assinada de curta duração que não aparece no arquivo.
	</p>
	<a
		class="download-button"
		href={resolve('/api/export/[episodeId]', { episodeId: data.episode.id })}
		>Baixar pacote de produção <span aria-hidden="true">↓</span></a
	></Panel
>

<style>
	.export-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 1rem;
		align-items: start;
	}
	.check-list {
		display: grid;
		gap: 0.55rem;
		padding-left: 1.1rem;
		color: var(--muted);
		font-size: 0.74rem;
	}
	.check-list li::marker {
		color: var(--phosphor);
	}
	.warnings {
		display: grid;
		gap: 0.5rem;
	}
	.warnings p {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		margin: 0;
		padding: 0.55rem;
		border-bottom: 1px solid var(--line);
		color: var(--muted);
		font-size: 0.72rem;
	}
	.warnings span {
		min-width: 1.3rem;
		color: var(--phosphor);
		font-family: var(--mono);
	}
	.manual-note,
	.quiet {
		color: var(--muted);
		font-size: 0.74rem;
	}
	.manual-note code {
		color: var(--paper);
	}
	.download-button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		max-width: 22rem;
		padding: 0.8rem 1rem;
		border: 1px solid rgb(169 197 108 / 48%);
		border-radius: var(--radius-sm);
		background: linear-gradient(145deg, #a9c56c, #7f9c4a);
		color: #10130b;
		font-size: 0.8rem;
		font-weight: 650;
		text-decoration: none;
	}
	.back-link {
		color: var(--muted);
		font-size: 0.75rem;
		text-decoration: none;
	}
	@media (max-width: 720px) {
		.export-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
