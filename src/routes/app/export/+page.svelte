<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';

	type QualityCheckView = {
		id: string;
		label: string;
		status: string;
		message: string;
		evidence: Array<{
			startMs?: number;
			endMs?: number;
			value?: number;
			unit?: string;
			detail?: string;
		}>;
	};
	type QualityReportView = {
		id: string;
		status: string;
		report: {
			summary: { pass: number; warn: number; blocked: number; notTested: number };
			checks: QualityCheckView[];
		};
		acknowledged_at: string | null;
		acknowledgement_note: string | null;
	};
	type RenderView = {
		id: string;
		episode_id: string;
		episode_title: string;
		plan_version: number;
		status: string;
		error_code: string | null;
		output_manifest: Record<string, unknown> | null;
		output_profile: string;
		quality: string;
		created_at: string;
		finished_at: string | null;
		report: QualityReportView | null;
	};
	type RenderManifest = {
		byteSize?: number;
		durationMs?: number;
		captions?: { cues?: number } | null;
		captionsOmitted?: boolean;
		qa?: { status?: string };
	};

	let { data, form }: PageProps = $props();

	function manifest(render: RenderView): RenderManifest | null {
		return (render.output_manifest as RenderManifest | null) ?? null;
	}

	function formatBytes(value?: number): string {
		if (!value) return '—';
		if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
		if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
		return `${value} B`;
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat('pt-BR', {
			dateStyle: 'short',
			timeStyle: 'short',
		}).format(new Date(value));
	}

	function canDownload(render: RenderView): boolean {
		if (render.status !== 'READY' || !render.report) return false;
		if (render.report.status === 'BLOCKED' || render.report.status === 'NOT_TESTED') return false;
		if (render.report.status === 'WARN' && !render.report.acknowledged_at) return false;
		return true;
	}

	function downloadHint(render: RenderView): string {
		if (render.status !== 'READY') return 'Ainda não está pronto.';
		if (!render.report) return 'Sem relatório de qualidade; renderize novamente.';
		if (render.report.status === 'BLOCKED') return 'Bloqueado pelo Quality Inspector.';
		if (render.report.status === 'NOT_TESTED') return 'A inspeção não conseguiu validar o arquivo.';
		if (render.report.status === 'WARN' && !render.report.acknowledged_at)
			return 'Reconheça os avisos para liberar o download.';
		return 'Download indisponível.';
	}

	function visibleChecks(report: QualityReportView): QualityCheckView[] {
		return report.report.checks.filter((check) => check.status !== 'PASS').slice(0, 12);
	}

	function evidenceLabel(evidence: QualityCheckView['evidence'][number]): string {
		const parts: string[] = [];
		if (evidence.startMs !== undefined) {
			const start = (evidence.startMs / 1000).toFixed(1);
			const end = evidence.endMs !== undefined ? `–${(evidence.endMs / 1000).toFixed(1)}` : '';
			parts.push(`${start}${end}s`);
		}
		if (evidence.value !== undefined)
			parts.push(`${Number(evidence.value).toFixed(2)}${evidence.unit ? ` ${evidence.unit}` : ''}`);
		if (evidence.detail) parts.push(evidence.detail);
		return parts.join(' · ');
	}
</script>

<svelte:head><title>Exportar · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="MP4 · QUALITY INSPECTOR · FLOW"
	title="Exportar produção"
	description="Baixe o MP4 final somente depois da inspeção técnica. O ZIP continua sendo o pacote de apoio para o trabalho manual."
/>

<Panel eyebrow="MP4 RENDERIZADO" title="Entregas finais">
	{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}
	{#if !data.renders.length}
		<p>Nenhum render ainda. Aprove o plano na timeline e use “Renderizar plano aprovado”.</p>
		<a href={resolve('/app/timeline')}>Ir à timeline</a>
	{:else}
		<div class="cards">
			{#each data.renders as render (render.id)}
				<article class="card">
					<header>
						<strong>{render.episode_title}</strong>
						<span class:ready={render.status === 'READY'} class="status">{render.status}</span>
					</header>
					<p class="meta">
						v{render.plan_version} · {render.output_profile} · {render.quality} · {formatDate(
							render.created_at,
						)}
					</p>
					{#if render.error_code}<code>{render.error_code}</code>{/if}
					{#if render.report}
						<p class="qa qa-{render.report.status.toLowerCase()}">
							QA: {render.report.status} · {render.report.report.summary.pass} PASS · {render.report
								.report.summary.warn} aviso(s) · {render.report.report.summary.blocked} bloqueio(s)
						</p>
						{#if visibleChecks(render.report).length}
							<details>
								<summary>Inspecionar verificações</summary>
								<ul class="checks">
									{#each visibleChecks(render.report) as check (check.id)}
										<li class={check.status.toLowerCase()}>
											<strong>{check.label}</strong>
											<span>{check.message}</span>
											{#if check.evidence.length}
												<small>
													{check.evidence
														.slice(0, 4)
														.map(evidenceLabel)
														.filter(Boolean)
														.join(' · ')}
												</small>
											{/if}
										</li>
									{/each}
								</ul>
							</details>
						{/if}
						{#if render.report.status === 'WARN' && !render.report.acknowledged_at}
							<form method="POST" action="?/acknowledge" class="ack">
								<input type="hidden" name="reportId" value={render.report.id} />
								<label>
									Justificativa do reconhecimento
									<textarea
										name="note"
										minlength="8"
										maxlength="1000"
										required
										placeholder="Explique por que o aviso é artístico/aceitável."></textarea>
								</label>
								<button type="submit">Reconhecer avisos e liberar o MP4</button>
							</form>
						{:else if render.report.acknowledged_at}
							<p class="hint">Reconhecido: {render.report.acknowledgement_note}</p>
						{/if}
					{:else}
						<p class="hint">Render anterior à inspeção; gere novamente para liberar o download.</p>
					{/if}
					<div class="actions">
						{#if canDownload(render)}
							<a href={resolve('/api/render-jobs/[jobId]/download', { jobId: render.id })}
								>Baixar MP4</a
							>
						{:else}
							<span class="hint">{downloadHint(render)}</span>
						{/if}
						{#if manifest(render)?.captions}
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={`${resolve('/api/captions/[episodeId]/srt', {
									episodeId: render.episode_id,
								})}?planVersion=${render.plan_version}`}>Baixar SRT</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
						{#if render.report}
							<a href={resolve('/api/render-jobs/[jobId]/qa', { jobId: render.id })}
								>Laudo QA (JSON)</a
							>
						{/if}
					</div>
					{#if manifest(render)?.captionsOmitted}
						<p class="notice warning">
							O plano pedia legendas, mas o MP4 saiu sem track aprovada. Reconheça o aviso ou
							reaprove as legendas e renderize novamente.
						</p>
					{/if}
					<p class="hint">
						{formatBytes(manifest(render)?.byteSize)} ·
						{((manifest(render)?.durationMs ?? 0) / 1000).toFixed(1)}s · sha256
						{String(render.output_manifest?.sha256 ?? '').slice(0, 12)}…
					</p>
				</article>
			{/each}
		</div>
	{/if}
</Panel>

<Panel eyebrow="PACOTES DE EPISÓDIO" title="Escolha um episódio">
	{#if data.episodes.length}<div class="rows">
			{#each data.episodes as episode (episode.id)}<div class="row">
					<div>
						<strong>{episode.title}</strong><small
							>{episode.seasons?.series?.title ?? 'Série'} · {episode.seasons?.title ?? 'Temporada'} ·
							{Math.floor(episode.duration_ms / 1000)}s</small
						>
					</div>
					<a href={resolve('/app/export/[episodeId]', { episodeId: episode.id })}>Preparar ZIP ↗</a>
				</div>{/each}
		</div>{:else}<p>Crie um episódio para preparar a primeira entrega.</p>
		<a href={resolve('/app/series')}>Ir às séries</a>{/if}
</Panel>

<style>
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 1rem;
	}
	.card {
		display: grid;
		gap: 0.55rem;
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
	.status {
		border: 1px solid var(--line-strong);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.64rem;
	}
	.status.ready {
		border-color: var(--phosphor);
		color: var(--phosphor);
	}
	.meta,
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.qa {
		font-family: var(--mono);
		font-size: 0.72rem;
	}
	.qa.qa-warn {
		color: #ffe4a3;
	}
	.qa.qa-blocked {
		color: #ffb4b4;
	}
	.qa.qa-pass {
		color: var(--phosphor);
	}
	.checks {
		display: grid;
		gap: 0.45rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}
	.checks li {
		display: grid;
		gap: 0.15rem;
		padding: 0.45rem 0.55rem;
		border-left: 2px solid var(--line-strong);
		font-size: 0.74rem;
	}
	.checks li.warn {
		border-color: #b58a2a;
	}
	.checks li.blocked {
		border-color: var(--danger);
	}
	.checks li.not_test {
		border-color: var(--line-strong);
	}
	.checks small {
		color: var(--muted);
		font-family: var(--mono);
		font-size: 0.64rem;
	}
	.ack {
		display: grid;
		gap: 0.4rem;
		padding: 0.6rem;
		border: 1px solid #b58a2a;
		border-radius: var(--radius-sm);
	}
	.ack label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.72rem;
	}
	.ack textarea {
		min-height: 4rem;
		resize: vertical;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.actions a {
		color: var(--phosphor);
		font-size: 0.76rem;
	}
	.notice {
		padding: 0.55rem 0.7rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
	}
	.notice.error {
		border: 1px solid #d55;
		color: #ffb4b4;
		background: #2a1212;
	}
	.notice.warning {
		border: 1px solid #b58a2a;
		color: #ffe4a3;
		background: #2a210f;
	}
	.rows {
		display: grid;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid var(--line);
	}
	.row div {
		display: grid;
		gap: 0.2rem;
	}
	.row strong {
		font-size: 0.82rem;
	}
	.row small {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.row a {
		color: var(--phosphor);
		font-size: 0.73rem;
		white-space: nowrap;
	}
</style>
