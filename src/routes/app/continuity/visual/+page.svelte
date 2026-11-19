<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';

	let { data, form }: PageProps = $props();

	function statusLabel(status: string): string {
		return (
			{
				NEEDS_REVIEW: 'Revisar',
				ACCEPTED: 'Aceito',
				EXCEPTION: 'Exceção aprovada',
				BLOCKING: 'Bloqueante',
				RESOLVED: 'Resolvido',
			}[status] ?? status
		);
	}

	function entityLabel(type: string): string {
		return (
			{
				CHARACTER: 'Personagem',
				OBJECT: 'Objeto',
				LOCATION: 'Locação',
				LIGHTING: 'Iluminação',
				TIME: 'Tempo',
				FRAME: 'Frame',
			}[type] ?? type
		);
	}
</script>

<svelte:head><title>Continuidade visual · DIF Studio</title></svelte:head>
<PageHeading
	eyebrow="CONTINUITY · POST-FLOW"
	title="Continuidade visual"
	description="Confronto determinístico entre frames privados, notas de cena e perfis de identidade. Alertas são sugestões revisáveis; nada altera cenas, cânone ou o vídeo original."
/>

<form class="selector" method="GET">
	<label for="visual-episode">Episódio</label>
	<select
		id="visual-episode"
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
{#if data.notice}
	<p class="notice success" role="status">
		{#if data.notice.mode === 'generated'}
			Relatório gerado na revisão {data.notice.revision}.
		{:else}
			Decisão registrada na revisão {data.notice.revision}.
		{/if}
	</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

{#if data.context}
	<section class="summary">
		<div>
			<span class="eyebrow">EPISÓDIO</span>
			<strong>E{data.context.episode.number} · {data.context.episode.title}</strong>
			<span>{data.context.episode.seriesTitle} · {data.context.episode.status}</span>
		</div>
		<div>
			<span class="eyebrow">RELATÓRIO</span>
			{#if data.context.latest}
				<strong>{statusLabel(data.context.latest.status)} · r{data.context.latest.revision}</strong>
				<span
					>{data.context.latest.observationCount} observações · {data.context.latest.blockingCount} bloqueantes</span
				>
			{:else}
				<strong>Nenhum relatório</strong>
				<span>Gere a primeira revisão para revisar frames e notas.</span>
			{/if}
		</div>
		<div class="summary-actions">
			<form method="POST" action="?/generate">
				<input type="hidden" name="episodeId" value={data.context.episode.id} />
				<button class="primary" type="submit"
					>{data.context.latest ? 'Gerar nova revisão' : 'Gerar relatório'}</button
				>
			</form>
			{#if data.context.latest}
				<p class="hint export-links">
					Relatório:
					<a
						href={resolve('/api/continuity/[episodeId]/report?format=json', {
							episodeId: data.context.episode.id,
						})}>JSON</a
					>
					·
					<a
						href={resolve('/api/continuity/[episodeId]/report?format=md', {
							episodeId: data.context.episode.id,
						})}>Markdown</a
					>
				</p>
			{/if}
		</div>
	</section>

	<section class="panel">
		<h2>Frames vinculados</h2>
		{#if data.context.scenes.length}
			<div class="frame-grid">
				{#each data.context.scenes as scene (scene.id)}
					<figure>
						<figcaption>Cena {scene.sceneIndex}</figcaption>
						<div class="pair">
							{#if scene.startFrameAssetId}
								<img
									src={`/api/media/${scene.startFrameAssetId}?variant=thumb`}
									alt={`Frame inicial da cena ${scene.sceneIndex}`}
									loading="lazy"
									decoding="async"
								/>
							{:else}
								<span class="missing">sem frame inicial</span>
							{/if}
							{#if scene.endFrameAssetId}
								<img
									src={`/api/media/${scene.endFrameAssetId}?variant=thumb`}
									alt={`Frame final da cena ${scene.sceneIndex}`}
									loading="lazy"
									decoding="async"
								/>
							{:else}
								<span class="missing">sem frame final</span>
							{/if}
						</div>
					</figure>
				{/each}
			</div>
		{:else}
			<p class="hint">Este episódio ainda não tem cenas.</p>
		{/if}
	</section>

	{#if data.context.latest}
		<section class="panel">
			<h2>Observações e decisões</h2>
			<p class="hint">
				Método e confiança são explícitos. “Revisar” nunca é falha automática; marcar “Bloqueante” é
				uma decisão do owner e bloqueia o export Flow até ser resolvida.
			</p>
			{#if data.context.latest.report.observations.length}
				<div class="observations">
					{#each data.context.latest.report.observations as observation (observation.id)}
						<article class:blocking={observation.status === 'BLOCKING'} class="observation">
							<div class="evidence">
								{#if observation.frameAssetId}
									<img
										src={`/api/media/${observation.frameAssetId}?variant=thumb`}
										alt={`Evidência da cena ${observation.sceneIndex}`}
										loading="lazy"
										decoding="async"
									/>
								{:else}
									<span class="missing">sem frame</span>
								{/if}
								<span class="eyebrow">CENA {observation.sceneIndex}</span>
								<span>{entityLabel(observation.entityType)} · {observation.attribute}</span>
							</div>
							<div class="details">
								<header>
									<strong>{observation.characterName || entityLabel(observation.entityType)}</strong
									>
									<span class={`status ${observation.status.toLowerCase()}`}
										>{statusLabel(observation.status)}</span
									>
								</header>
								<p><b>Esperado:</b> {observation.expected}</p>
								<p><b>Observado:</b> {observation.observed}</p>
								<p class="meta">
									{observation.method} · confiança {observation.confidence}
									{#if observation.decisionNote}· {observation.decisionNote}{/if}
								</p>
								<form method="POST" action="?/decide" class="decision">
									<input type="hidden" name="episodeId" value={data.context?.episode.id ?? ''} />
									<input type="hidden" name="observationId" value={observation.id} />
									<label>
										Decisão
										<select name="status">
											{#each ['NEEDS_REVIEW', 'ACCEPTED', 'EXCEPTION', 'BLOCKING', 'RESOLVED'] as status (status)}
												<option value={status} selected={status === observation.status}>
													{statusLabel(status)}
												</option>
											{/each}
										</select>
									</label>
									<label>
										Justificativa
										<textarea name="rationale" rows="2">{observation.decisionNote}</textarea>
									</label>
									<label class="check">
										<input type="checkbox" name="regenerate" />
										Solicitar regeneração manual no Flow
									</label>
									<button type="submit">Registrar decisão</button>
								</form>
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<p class="hint">Nenhuma divergência detectada nesta revisão.</p>
			{/if}
			{#if data.context.latest.report.limitations.length}
				<h3>Limitações desta revisão</h3>
				<ul class="limitations">
					{#each data.context.latest.report.limitations as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if data.context.history.length}
		<section class="panel">
			<h2>Histórico</h2>
			<ul class="history">
				{#each data.context.history as item (item.revision)}
					<li>
						<strong>r{item.revision}</strong> · {statusLabel(item.status)} ·
						{item.blockingCount} bloqueantes
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<p class="hint">
		Perfis e âncoras vêm do
		<a href={resolve(`/app/identity?seriesId=${data.context.episode.seriesId}`)}
			>kit de identidade</a
		>. A inspeção não usa API paga de visão, não reconhece pessoas reais e não promete precisão
		semântica.
	</p>
{/if}

<style>
	.selector {
		display: grid;
		gap: 0.35rem;
		margin-block: 0.9rem;
		max-width: 34rem;
	}
	.selector select {
		width: 100%;
		min-width: 0;
		max-width: 100%;
	}
	.summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.8rem;
		align-items: center;
		padding: 0.8rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.summary > div {
		display: grid;
		gap: 0.15rem;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.summary-actions {
		display: grid;
		gap: 0.3rem;
	}
	.export-links {
		margin: 0;
	}
	.summary strong {
		color: var(--ink);
		font-size: 0.88rem;
	}
	.eyebrow {
		color: var(--muted);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
	}
	.panel {
		display: grid;
		gap: 0.7rem;
		padding: 0.9rem;
		margin-top: 1rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.frame-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: 0.5rem;
	}
	figure {
		margin: 0;
		display: grid;
		gap: 0.25rem;
	}
	figcaption {
		color: var(--muted);
		font-size: 0.68rem;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.2rem;
	}
	.pair img,
	.evidence img {
		width: 100%;
		background: #050505;
		border-radius: var(--radius-sm);
		object-fit: cover;
		aspect-ratio: 3 / 4;
	}
	.missing {
		display: grid;
		place-items: center;
		min-height: 4rem;
		border: 1px dashed var(--line);
		border-radius: var(--radius-sm);
		color: var(--muted);
		font-size: 0.66rem;
		padding: 0.3rem;
		text-align: center;
	}
	.observations {
		display: grid;
		gap: 0.7rem;
	}
	.observation {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 0.7rem;
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.observation.blocking {
		border-color: #b73f55;
	}
	.evidence {
		display: grid;
		gap: 0.25rem;
		align-content: start;
		font-size: 0.68rem;
		color: var(--muted);
	}
	.details {
		display: grid;
		gap: 0.35rem;
		font-size: 0.76rem;
	}
	.details header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.details p {
		margin: 0;
	}
	.meta {
		color: var(--muted);
		font-size: 0.7rem;
	}
	.status {
		padding: 0.1rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.66rem;
	}
	.status.blocking {
		border-color: #b73f55;
		color: #ffb4b4;
	}
	.status.accepted,
	.status.resolved,
	.status.exception {
		border-color: #5a5;
		color: #b8f5c0;
	}
	.decision {
		display: grid;
		gap: 0.35rem;
		margin-top: 0.3rem;
	}
	.decision label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.7rem;
	}
	.decision .check {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.35rem;
	}
	.history {
		display: grid;
		gap: 0.3rem;
		padding-left: 1rem;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.limitations {
		display: grid;
		gap: 0.3rem;
		margin: 0;
		padding-left: 1.1rem;
		color: var(--muted);
		font-size: 0.74rem;
	}
	.hint {
		color: var(--muted);
		font-size: 0.72rem;
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
	@media (max-width: 640px) {
		.observation {
			grid-template-columns: 1fr;
		}
		.evidence img {
			aspect-ratio: 16 / 9;
		}
	}
</style>
