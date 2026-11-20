<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import { RETENTION_PLATFORMS, RETENTION_VARIANT_KINDS } from '#lib/schemas/retention.js';
	import { RETENTION_PLATFORM_NOTES } from '#lib/domain/retention.js';

	let { data, form }: PageProps = $props();

	const durationSeconds = $derived((data.context?.episode.durationMs ?? 0) / 1000);
	const allVariants = $derived(
		data.context?.posts.flatMap((post) =>
			post.variants.map((variant) => ({
				...variant,
				postLabel: post.label || post.url,
				platform: post.platform,
				views: post.latestSnapshot?.metrics.views ?? null,
				periodEnd: post.latestSnapshot?.periodEnd ?? null,
			})),
		) ?? [],
	);
	const chartPosts = $derived(
		(data.context?.posts ?? []).filter((post) => post.latestSnapshot?.metrics.views != null),
	);
	const maxViews = $derived(
		Math.max(1, ...chartPosts.map((post) => post.latestSnapshot?.metrics.views ?? 0)),
	);
	const metricLabel = $derived(
		data.metrics.find((metric) => metric.id === data.metric)?.label ?? data.metric,
	);
	const maxEngagement = $derived(
		Math.max(0.01, ...chartPosts.map((post) => post.latestSnapshot?.computed.engagementRate ?? 0)),
	);

	function variantLabel(id: string): string {
		const variant = allVariants.find((candidate) => candidate.id === id);
		if (!variant) return 'INDISPONÍVEL';
		return `${variant.platform} · ${variant.postLabel} · ${variant.label}`;
	}

	function variantViews(id: string): string {
		const variant = allVariants.find((candidate) => candidate.id === id);
		return formatNumber(variant?.views ?? null);
	}

	function formatMetric(value: number | null, metric: string): string {
		if (value === null) return 'INDISPONÍVEL';
		if (metric === 'engagement_rate' || metric === 'watch_time_relative')
			return `${(value * 100).toFixed(2)}%`;
		if (metric === 'completion_pct') return `${value.toFixed(1)}%`;
		return value.toFixed(1);
	}

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
			PARTIAL_INTERACTIONS: 'nem todas as interações foram informadas',
			INTERACTION_COVERAGE_MISMATCH: 'campos de interação diferentes entre variantes',
			DIFFERENT_WINDOWS: 'janelas de coleta diferentes',
			DISTANT_WINDOWS: 'janelas distantes (>7 dias)',
			SAMPLE_IMBALANCE: 'amostras desbalanceadas',
			METRIC_VERSION_UNSUPPORTED: 'versão de métrica desconhecida',
			RETENTION_WATCH_EXCEEDS_DURATION: 'watch time histórico excede a duração atual',
			INVALID_METRICS: 'métricas históricas inconsistentes',
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
		{#if data.notice.detail}<br /><small>{data.notice.detail}</small>{/if}
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
		{#if chartPosts.length}
			<div class="charts">
				<figure>
					<figcaption>Views por publicação (último snapshot)</figcaption>
					<svg viewBox="0 0 340 120" role="img" aria-label="Gráfico de views por publicação">
						<line x1="10" y1="100" x2="330" y2="100" class="axis"></line>
						{#each chartPosts as post, index (post.id)}
							{@const value = post.latestSnapshot?.metrics.views ?? 0}
							{@const width = Math.max(8, Math.round(300 / chartPosts.length) - 6)}
							<rect
								x={12 + index * (300 / chartPosts.length)}
								y={100 - Math.round((value / maxViews) * 82)}
								{width}
								height={Math.round((value / maxViews) * 82)}
								class="bar views"
							>
								<title
									>{post.platform} · {post.label || post.url}: {formatNumber(value)} views</title
								>
							</rect>
						{/each}
						<text x="10" y="112" class="axis-label">0</text>
						<text x="330" y="112" text-anchor="end" class="axis-label"
							>{formatNumber(maxViews)}</text
						>
					</svg>
				</figure>
				<figure>
					<figcaption>Engajamento observado por publicação (%)</figcaption>
					<svg viewBox="0 0 340 120" role="img" aria-label="Gráfico de engajamento por publicação">
						<line x1="10" y1="100" x2="330" y2="100" class="axis"></line>
						{#each chartPosts as post, index (post.id)}
							{@const value = post.latestSnapshot?.computed.engagementRate ?? 0}
							{@const width = Math.max(8, Math.round(300 / chartPosts.length) - 6)}
							<rect
								x={12 + index * (300 / chartPosts.length)}
								y={100 - Math.round((value / maxEngagement) * 82)}
								{width}
								height={Math.round((value / maxEngagement) * 82)}
								class="bar engagement"
							>
								<title>{post.label || post.url}: {formatRate(value)}</title>
							</rect>
						{/each}
						<text x="330" y="112" text-anchor="end" class="axis-label"
							>{formatRate(maxEngagement)}</text
						>
					</svg>
				</figure>
			</div>
		{/if}
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
						{#if post.snapshots.length}
							<details class="history">
								<summary>Histórico de snapshots ({post.snapshotCount})</summary>
								<ul>
									{#each post.snapshots.slice(0, 20) as entry (entry.id)}
										<li>
											v{entry.revision} · {entry.source} · {formatDate(
												entry.periodStart,
											)}–{formatDate(entry.periodEnd)} · views {formatNumber(entry.metrics.views)}
											{#if entry.supersedesSnapshotId}<span class="warning">retifica</span>{/if}
										</li>
									{/each}
								</ul>
								{#if post.snapshotCount > 20}
									<p class="missing">Mostrando as 20 revisões mais recentes.</p>
								{/if}
							</details>
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
						<small
							>A: {variantLabel(entry.experiment.variantAId)} · views {variantViews(
								entry.experiment.variantAId,
							)}</small
						>
						<small
							>B: {variantLabel(entry.experiment.variantBId)} · views {variantViews(
								entry.experiment.variantBId,
							)}</small
						>
						<small>
							{metricLabel}: A {formatMetric(entry.comparison.valueA, data.metric)} · B {formatMetric(
								entry.comparison.valueB,
								data.metric,
							)}
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
					<label
						>Publicado em (UTC)<input type="datetime-local" name="publishedAt" required /></label
					>
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
					<label
						>Início do período (UTC)<input
							type="datetime-local"
							name="periodStart"
							required
						/></label
					>
					<label
						>Fim do período (UTC)<input type="datetime-local" name="periodEnd" required /></label
					>
				</div>
				<label>Capturado em (UTC)<input type="datetime-local" name="capturedAt" required /></label>
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
				<label>
					Retificar snapshot (opcional)
					<select name="supersedesSnapshotId">
						<option value="">Nenhum</option>
						{#each data.context.posts as post (post.id)}
							{#each post.snapshots.slice(0, 10) as entry (entry.id)}
								<option value={entry.id}>
									{post.label || post.url} · v{entry.revision} · {formatDate(entry.periodEnd)}
								</option>
							{/each}
						{/each}
					</select>
				</label>
				<label>Observação<textarea name="note" maxlength="1000" rows="2"></textarea></label>
				<p class="hint">
					Deixe em branco o que a plataforma não informou. Ausente ≠ zero. Datas são UTC.
				</p>
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
			{#each Object.entries(RETENTION_PLATFORM_NOTES) as [platform, note] (platform)}
				<li><strong>{platform}</strong>: {note}</li>
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
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.8rem;
	}
	.charts figure {
		margin: 0;
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.charts figcaption {
		color: var(--muted);
		font-size: 0.7rem;
		margin-bottom: 0.3rem;
	}
	.charts svg {
		width: 100%;
		height: auto;
	}
	.axis {
		stroke: var(--line);
		stroke-width: 1;
	}
	.axis-label {
		fill: var(--muted);
		font-size: 9px;
	}
	.bar.views {
		fill: var(--phosphor);
		opacity: 0.75;
	}
	.bar.engagement {
		fill: #ffcf8a;
		opacity: 0.8;
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
