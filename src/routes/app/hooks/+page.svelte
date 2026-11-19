<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';

	let { data, form }: PageProps = $props();
	const visibleVariants = $derived(
		data.variants.filter((variant) => variant.planVersion === data.sourcePlanVersion),
	);

	function openingLabel(startMs: number, endMs: number): string {
		return `${(startMs / 1000).toFixed(1)}–${(endMs / 1000).toFixed(1)}s`;
	}
</script>

<svelte:head><title>Hook Lab · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="ABERTURAS A/B/C"
	title="Hook Lab"
	description="Três aberturas determinísticas usando somente clipes, áudio e falas já aprovados. O score é heurístico: não mede retenção nem garante desempenho."
/>

<form class="episode-picker" method="GET">
	<label for="hook-episode">Episódio</label>
	<select
		id="hook-episode"
		name="episodeId"
		onchange={(event) => event.currentTarget.form?.requestSubmit()}
	>
		{#each data.episodes as episode (episode.id)}
			<option value={episode.id} selected={episode.id === data.selectedEpisode?.id}>
				{episode.seasons?.series?.title ?? 'Série'} · E{episode.episode_number} — {episode.title}
			</option>
		{/each}
	</select>
</form>

{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}
{#if form?.success === 'generated'}
	<p class="notice success" role="status">
		{form.count} abertura(s) gerada(s). {form.limitations}
	</p>
{:else if form?.success === 'applied'}
	<p class="notice success" role="status">
		Abertura aplicada como nova versão {form.version}. A versão anterior continua no histórico. O
		novo plano está DRAFT: aprove-o e
		<a href={resolve(`/app/captions?episodeId=${data.selectedEpisode?.id}`)}>reaprove as legendas</a
		>
		antes do render.
	</p>
{:else if form?.success === 'reverted'}
	<p class="notice success" role="status">
		Edição original restaurada na versão {form.version}. Aprove o plano e reaprove as legendas para
		esta versão antes do render.
	</p>
{/if}

{#if !data.plan}
	<p class="empty">Salve um plano de edição aprovado antes de gerar aberturas.</p>
	<a href={resolve('/app/timeline')}>Abrir timeline</a>
{:else}
	<section class="toolbar" aria-label="Gerar aberturas">
		<div>
			<p class="meta">
				Plano v{data.plan.version} · {data.plan.status} · versão base das aberturas:
				{data.sourcePlanVersion ?? 'nenhuma'}
			</p>
			<p class="hint">
				As variantes reordenam o primeiro bloco do vídeo; narração, SFX e CTA permanecem na linha do
				tempo. A nova versão exige reaprovar as legendas antes do render. Nada é publicado nem
				enviado a IA.
			</p>
		</div>
		<form method="POST" action="?/generate">
			<input type="hidden" name="episodeId" value={data.selectedEpisode?.id ?? ''} />
			<button class="primary" type="submit">Gerar aberturas</button>
		</form>
	</section>

	{#if !visibleVariants.length}
		<p class="empty">
			Nenhuma abertura gerada para esta versão. Use “Gerar aberturas” para criar até três opções.
		</p>
	{:else}
		<div class="cards">
			{#each visibleVariants as variant (variant.id)}
				<article class="card">
					<header>
						<strong>{variant.label}</strong>
						<span class="score">{variant.score}/100 heurístico</span>
					</header>
					<p class="meta">
						{variant.objective} · versão base v{variant.planVersion} · abertura
						{openingLabel(variant.openingStartMs, variant.openingEndMs)}
					</p>
					<video
						src={`/api/video/${variant.openingAssetId}`}
						controls
						playsinline
						preload="metadata"
						onloadedmetadata={(event) => {
							event.currentTarget.currentTime = variant.openingStartMs / 1000;
						}}
					>
						<track
							kind="captions"
							srclang="pt-BR"
							label="Prévia de legendas"
							src="data:text/vtt;charset=utf-8,WEBVTT%0A%0A"
						/>
					</video>
					<p>{variant.premise}</p>
					<ul class="reasons">
						{#each variant.reasons as reason (reason)}
							<li>{reason}</li>
						{/each}
					</ul>
					<p class="hint">
						Prévia é o clipe de abertura, não o render composto. O MP4 final continua sendo a
						referência.
					</p>
					<div class="actions">
						{#if variant.status === 'APPLIED' && variant.appliedVersion === data.plan?.version}
							<span class="badge">Aplicada na v{variant.appliedVersion}</span>
							<form method="POST" action="?/revert">
								<input type="hidden" name="episodeId" value={data.selectedEpisode?.id ?? ''} />
								<input type="hidden" name="variantId" value={variant.id} />
								<button type="submit">Reverter à edição original</button>
							</form>
						{:else}
							<form method="POST" action="?/apply">
								<input type="hidden" name="episodeId" value={data.selectedEpisode?.id ?? ''} />
								<input type="hidden" name="variantId" value={variant.id} />
								<button class="primary" type="submit">Aplicar como abertura oficial</button>
							</form>
						{/if}
						<a href={resolve(`/app/timeline?episodeId=${data.selectedEpisode?.id}`)}
							>Ver no timeline</a
						>
						<a href={resolve('/api/hooks/[variantId]/export', { variantId: variant.id })}
							>Exportar variante (JSON)</a
						>
					</div>
				</article>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.episode-picker {
		display: grid;
		gap: 0.35rem;
		margin-block: 1rem;
	}
	.episode-picker select {
		width: 100%;
		max-width: 100%;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 1rem;
		align-items: end;
		margin-block: 1rem;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 1rem;
	}
	.card {
		display: grid;
		gap: 0.6rem;
		align-content: start;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.card header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
	}
	.score,
	.badge {
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.64rem;
	}
	.badge {
		border-color: var(--phosphor);
		color: var(--phosphor);
	}
	video {
		width: 100%;
		max-height: 18rem;
		background: #050505;
		border-radius: var(--radius-sm);
	}
	.meta,
	.hint,
	.reasons {
		color: var(--muted);
		font-size: 0.75rem;
	}
	.reasons {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding-inline-start: 1.1rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	.actions a {
		color: var(--phosphor);
		font-size: 0.75rem;
	}
	.notice {
		padding: 0.65rem 0.8rem;
		border-radius: var(--radius-sm);
		margin-block: 0.6rem;
	}
	.notice.error {
		border: 1px solid #d55;
		color: #ffb4b4;
		background: #2a1212;
	}
	.notice.success {
		border: 1px solid #5a5;
		color: #b8f5c0;
		background: #102a16;
	}
	.empty {
		color: var(--muted);
		margin-block: 1rem;
	}
</style>
