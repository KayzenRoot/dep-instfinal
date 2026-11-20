<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import { RETENTION_PLATFORMS, RETENTION_VARIANT_KINDS } from '#lib/schemas/retention.js';

	let { data, form }: PageProps = $props();

	const durationSeconds = $derived((data.context?.episode.durationMs ?? 0) / 1000);
	const allVariants = $derived(
		data.context?.posts.flatMap((post) =>
			post.variants.map((variant) => ({
				...variant,
				postLabel: post.label || post.url,
				platform: post.platform,
			})),
		) ?? [],
	);

	function formatDate(value: string): string {
		return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
	}

	function formatNumber(value: number | null): string {
		return value === null ? 'INDISPONÍVEL' : value.toLocaleString('pt-BR');
	}

	function formatRate(value: number | null): string {
		return value === null ? 'INDISPONÍVEL' : `${(value * 100).toFixed(2)}%`;
	}

	function formatPercent(value: number | null): string {
		return value === null ? 'INDISPONÍVEL' : `${value.toFixed(1)}%`;
	}

	function warningLabel(warning: string): string {
		const labels: Record<string, string> = {
			ZERO_VIEWS: 'views = 0: taxas não calculadas',
			LOW_SAMPLE: 'amostra baixa (<1000 views)',
			COMPLETION_DISCREPANCY: 'conclusão informada difere do watch time',
			INTERACTIONS_EXCEED_VIEWS: 'interações maiores que views',
			DIFFERENT_WINDOWS: 'janelas de coleta diferentes',
			DISTANT_WINDOWS: 'janelas distantes (>7 dias)',
			SAMPLE_IMBALANCE: 'amostras desbalanceadas',
		};
		return labels[warning] ?? warning;
	}

	function confirmDelete(event: SubmitEvent): void {
		if (!confirm('Remover a publicação, variantes e snapshots? Esta ação não tem desfazer.')) {
			event.preventDefault();
		}
	}
</script>

<svelte:head><title>Retenção · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="RETENÇÃO · MÉTRICAS MANUAIS · A/B"
	title="Laboratório de retenção"
	description="Registre resultados reais fornecidos por você, compare variantes com denominadores explícitos e leia apenas associações observadas. Nada é coletado das plataformas."
/>

<form class="selector" method="GET">
	<label for="retention-episode">Episódio</label>
	<select
		id="retention-episode"
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
{#if data.notice?.mode === 'imported'}
	<p class="notice success" role="status">
		Importação: {data.notice.imported} novos, {data.notice.skipped} duplicados, {data.notice.errors}
		erros.
	</p>
{:else if data.notice}
	<p class="notice success" role="status">Registro salvo.</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

{#if data.context}
	<div class="actions-bar">
		<a href="{resolve('/api/retention/export')}?episodeId={data.context.episode.id}&format=csv"
			>Exportar CSV</a
		>
		<a href="{resolve('/api/retention/export')}?episodeId={data.context.episode.id}&format=json"
			>Exportar JSON</a
		>
		<span>Duração do episódio: {durationSeconds.toFixed(0)}s</span>
	</div>

	<section class="dashboard">
		<h2>Publicações e métricas observadas</h2>
		{#if data.context.posts.length}
			<div class="post-grid">
				{#each data.context.posts as post (post.id)}
					<article class="post-card">
						<header>
							<span class="platform">{post.platform}</span>
							<strong>{post.label || post.url}</strong>
						</header>
						<span class="url">{post.url}</span>
						<small
							>publicado em {formatDate(post.publishedAt)} · {post.snapshotCount} snapshot(s)</small
						>
						{#if post.variants.length}
							<p class="variant-list">
								{#each post.variants as variant (variant.id)}
									<span>{variant.kind}: {variant.label}</span>
								{/each}
							</p>
						{:else}
							<p class="missing">Sem variante registrada.</p>
						{/if}
						{#if post.latestSnapshot}
							{@const snapshot = post.latestSnapshot}
							<div class="metric-grid">
								<div><span>Views</span><strong>{formatNumber(snapshot.metrics.views)}</strong></div>
								<div>
									<span>Engajamento</span><strong
										>{formatRate(snapshot.computed.engagementRate)}</strong
									>
								</div>
								<div>
									<span>Conclusão</span><strong
										>{formatPercent(snapshot.computed.completionPct)}</strong
									>
								</div>
								<div>
									<span>Watch relativo</span><strong
										>{formatRate(snapshot.computed.watchTimeRelative)}</strong
									>
								</div>
								<div>
									<span>Interações/1000</span><strong
										>{snapshot.computed.interactionsPer1000 === null
											? 'INDISPONÍVEL'
											: snapshot.computed.interactionsPer1000.toFixed(1)}</strong
									>
								</div>
								<div>
									<span>Followers</span><strong
										>{formatNumber(snapshot.metrics.followersGained)}</strong
									>
								</div>
							</div>
							<small>
								origem {snapshot.source} · {formatDate(snapshot.periodStart)} a {formatDate(
									snapshot.periodEnd,
								)} · capturado em {formatDate(snapshot.capturedAt)}
							</small>
							{#if snapshot.note}<p class="note">{snapshot.note}</p>{/if}
							{#if snapshot.computed.missing.length}
								<p class="missing">Ausentes: {snapshot.computed.missing.join(', ')}.</p>
							{/if}
							{#each snapshot.computed.warnings as warning (warning)}
								<span class="warning">{warningLabel(warning)}</span>
							{/each}
						{:else}
							<p class="missing">Sem snapshot: métricas INDISPONÍVEIS.</p>
						{/if}
						<form method="POST" action="?/delete" onsubmit={confirmDelete}>
							<input type="hidden" name="episodeId" value={data.context.episode.id} />
							<input type="hidden" name="postId" value={post.id} />
							<button type="submit" class="danger">Remover publicação</button>
						</form>
					</article>
				{/each}
			</div>
		{:else}
			<p class="missing">Nenhuma publicação registrada neste episódio.</p>
		{/if}
	</section>

	<section class="dashboard">
		<h2>Experimentos A/B observacionais</h2>
		<form class="inline" method="GET">
			<input type="hidden" name="episodeId" value={data.context.episode.id} />
			<label>
				Métrica
				<select name="metric" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
					{#each data.metrics as metric (metric.id)}
						<option value={metric.id} selected={metric.id === data.metric}>{metric.label}</option>
					{/each}
				</select>
			</label>
		</form>
		{#if data.comparisons.length}
			<div class="comparison-grid">
				{#each data.comparisons as entry (entry.experiment.id)}
					<article class="comparison">
						<header>
							<strong>{entry.experiment.name}</strong><span>{entry.comparison.status}</span>
						</header>
						{#if entry.experiment.hypothesis}<small>{entry.experiment.hypothesis}</small>{/if}
						<p>{entry.comparison.summary}</p>
						<small>
							A: {entry.comparison.valueA === null ? 'INDISPONÍVEL' : entry.comparison.valueA} · B:
							{entry.comparison.valueB === null ? 'INDISPONÍVEL' : entry.comparison.valueB}
						</small>
						{#each entry.comparison.warnings as warning (warning)}
							<span class="warning">{warningLabel(warning)}</span>
						{/each}
					</article>
				{/each}
			</div>
		{:else}
			<p class="missing">
				Nenhum experimento registrado. A/B exige duas variantes e snapshots comparáveis.
			</p>
		{/if}
		<form method="POST" action="?/experiment" class="compact">
			<input type="hidden" name="episodeId" value={data.context.episode.id} />
			<div class="two">
				<label>Nome<input name="name" maxlength="80" required /></label>
				<label>Hipótese<input name="hypothesis" maxlength="500" /></label>
			</div>
			<div class="two">
				<label>
					Variante A
					<select name="variantAId" required>
						<option value="">Selecione</option>
						{#each allVariants as variant (variant.id)}
							<option value={variant.id}
								>{variant.platform} · {variant.postLabel} · {variant.label}</option
							>
						{/each}
					</select>
				</label>
				<label>
					Variante B
					<select name="variantBId" required>
						<option value="">Selecione</option>
						{#each allVariants as variant (variant.id)}
							<option value={variant.id}
								>{variant.platform} · {variant.postLabel} · {variant.label}</option
							>
						{/each}
					</select>
				</label>
			</div>
			<button type="submit">Registrar experimento</button>
		</form>
	</section>

	<div class="forms-grid">
		<details open>
			<summary>Registrar publicação</summary>
			<form method="POST" action="?/post" class="compact">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<div class="two">
					<label>
						Plataforma
						<select name="platform">
							{#each RETENTION_PLATFORMS as platform (platform)}
								<option value={platform}>{platform}</option>
							{/each}
						</select>
					</label>
					<label>Publicado em<input type="datetime-local" name="publishedAt" required /></label>
				</div>
				<label
					>URL fornecida<input
						name="url"
						maxlength="500"
						required
						placeholder="https://..."
					/></label
				>
				<label>Rótulo<input name="label" maxlength="120" /></label>
				<label>Observações<textarea name="notes" maxlength="1000" rows="2"></textarea></label>
				<label>Nota da alteração<input name="changeNote" maxlength="300" /></label>
				<button type="submit">Salvar publicação</button>
			</form>
		</details>

		<details>
			<summary>Registrar variante</summary>
			<form method="POST" action="?/variant" class="compact">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<label>
					Publicação
					<select name="postId" required>
						<option value="">Selecione</option>
						{#each data.context.posts as post (post.id)}
							<option value={post.id}>{post.platform} · {post.label || post.url}</option>
						{/each}
					</select>
				</label>
				<div class="two">
					<label>
						Tipo
						<select name="kind">
							{#each RETENTION_VARIANT_KINDS as kind (kind)}
								<option value={kind}>{kind}</option>
							{/each}
						</select>
					</label>
					<label>Rótulo<input name="label" maxlength="80" required /></label>
				</div>
				<label>
					Hook aprovado (opcional)
					<select name="hookVariantId">
						<option value="">Nenhum</option>
						{#each data.refs.hooks as hook (hook.id)}
							<option value={hook.id}>{hook.label} ({hook.variant_key})</option>
						{/each}
					</select>
				</label>
				<label>
					Capa aprovada (opcional)
					<select name="coverRevisionId">
						<option value="">Nenhuma</option>
						{#each data.refs.covers as cover (cover.id)}
							<option value={cover.id}>v{cover.revision_number} · {cover.template_id}</option>
						{/each}
					</select>
				</label>
				<label>
					Final A/B aprovado (opcional)
					<select name="endCardId">
						<option value="">Nenhum</option>
						{#each data.refs.endCards as card (card.id)}
							<option value={card.id}>v{card.revision_number} · {card.template_id}</option>
						{/each}
					</select>
				</label>
				<button type="submit">Salvar variante</button>
			</form>
		</details>

		<details>
			<summary>Adicionar snapshot manual</summary>
			<form method="POST" action="?/snapshot" class="compact">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<label>
					Publicação
					<select name="postId" required>
						<option value="">Selecione</option>
						{#each data.context.posts as post (post.id)}
							<option value={post.id}>{post.platform} · {post.label || post.url}</option>
						{/each}
					</select>
				</label>
				<div class="two">
					<label>Início do período<input type="datetime-local" name="periodStart" required /></label
					>
					<label>Fim do período<input type="datetime-local" name="periodEnd" required /></label>
				</div>
				<label>Capturado em<input type="datetime-local" name="capturedAt" required /></label>
				<div class="three">
					<label>Views<input name="views" inputmode="numeric" /></label>
					<label>Likes<input name="likes" inputmode="numeric" /></label>
					<label>Comentários<input name="comments" inputmode="numeric" /></label>
					<label>Shares<input name="shares" inputmode="numeric" /></label>
					<label>Saves<input name="saves" inputmode="numeric" /></label>
					<label>Followers<input name="followersGained" inputmode="numeric" /></label>
					<label>Avg watch (ms)<input name="avgWatchMs" inputmode="numeric" /></label>
					<label>Conclusão (%)<input name="completionPct" inputmode="decimal" /></label>
				</div>
				<label>Observação<textarea name="note" maxlength="1000" rows="2"></textarea></label>
				<p class="hint">Deixe em branco o que a plataforma não informou. Ausente ≠ zero.</p>
				<button type="submit">Salvar snapshot</button>
			</form>
		</details>

		<details>
			<summary>Importar CSV</summary>
			<form method="POST" action="?/import" class="compact">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<label>Nome do arquivo<input name="filename" maxlength="120" value="import.csv" /></label>
				<label>
					CSV
					<textarea
						name="csv"
						rows="8"
						required
						placeholder="platform,url,published_at,label,period_start,period_end,captured_at,views,likes,comments,shares,saves,followers_gained,avg_watch_ms,completion_pct,note"
					></textarea>
				</label>
				<p class="hint">
					Datas ISO 8601. Campos vazios viram NULL. Importação repetida do mesmo snapshot é
					ignorada.
				</p>
				<button type="submit">Importar CSV</button>
			</form>
		</details>
	</div>

	<details class="definitions">
		<summary>Definições e limites</summary>
		<ul>
			{#each data.metrics as metric (metric.id)}
				<li>
					<strong>{metric.label}</strong>: {metric.numerator} ÷ {metric.denominator}.
				</li>
			{/each}
		</ul>
		<p class="hint">
			Versão das métricas: 1. Amostra baixa abaixo de 1000 views. Ausente é INDISPONÍVEL, nunca
			zero. Comparações A/B são descritivas e não estabelecem causalidade.
		</p>
	</details>
{/if}

<style>
	.selector {
		display: grid;
		gap: 0.35rem;
		margin-block: 0.9rem;
		max-width: 34rem;
	}
	select,
	input,
	textarea {
		width: 100%;
		min-width: 0;
		max-width: 100%;
	}
	.actions-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
		align-items: center;
		font-size: 0.76rem;
		color: var(--muted);
	}
	.actions-bar a {
		color: var(--phosphor);
	}
	.dashboard {
		display: grid;
		gap: 0.7rem;
		margin-block: 1rem;
	}
	.post-grid,
	.comparison-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 0.8rem;
	}
	.post-card,
	.comparison {
		display: grid;
		gap: 0.35rem;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.post-card header,
	.comparison header {
		display: flex;
		justify-content: space-between;
		gap: 0.4rem;
		align-items: baseline;
	}
	.platform {
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
		font-size: 0.62rem;
		text-transform: uppercase;
	}
	.url {
		font-size: 0.68rem;
		color: var(--muted);
		word-break: break-all;
	}
	.variant-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
	}
	.variant-list span {
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.1rem 0.4rem;
		font-size: 0.66rem;
	}
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: 0.35rem;
	}
	.metric-grid div {
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 0.3rem;
	}
	.metric-grid span {
		display: block;
		color: var(--muted);
		font-size: 0.6rem;
	}
	.metric-grid strong {
		font-size: 0.82rem;
	}
	.warning {
		color: #ffcf8a;
		font-size: 0.66rem;
	}
	.missing {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.note {
		margin: 0;
		font-size: 0.7rem;
	}
	.forms-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 0.8rem;
		align-items: start;
	}
	details {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		padding: 0.6rem;
		background: var(--surface);
	}
	summary {
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.compact {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.72rem;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
	}
	.three {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: 0.5rem;
	}
	.inline {
		display: flex;
		gap: 0.5rem;
		align-items: end;
		max-width: 20rem;
	}
	.danger {
		border-color: #833;
		color: #ffb4b4;
	}
	.definitions {
		margin-top: 1rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.notice {
		padding: 0.65rem 0.8rem;
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
	}
	.notice.error {
		border: 1px solid #833;
		background: #1a0c0c;
		color: #ffb4b4;
	}
	.notice.success {
		border: 1px solid #385;
		background: #0c1a10;
		color: #b8f5c0;
	}
</style>
