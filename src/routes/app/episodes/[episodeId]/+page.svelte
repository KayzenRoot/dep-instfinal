<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	import PageHeading from '#lib/components/PageHeading.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	let { data, form }: PageProps = $props();
	const isPublished = $derived(data.episode.status === 'PUBLISHED');
	const option = (key: string) => data.choices.find((choice) => choice.option_key === key);
	const latestResult = $derived(data.results[0]);
	const metadata = $derived(data.episode.platform_metadata ?? {});
	const formatTime = (value: number) => {
		const seconds = Math.floor(value / 1000);
		return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	};
</script>

<svelte:head><title>{data.episode.title} · DIF Studio</title></svelte:head>

<PageHeading
	eyebrow={`${data.episode.seasons?.series?.title ?? 'SÉRIE'} · ${data.episode.seasons?.title ?? 'TEMPORADA'}`}
	title={data.episode.title}
	description="Roteiro manual, storyboard contínuo e escolhas registradas em revisões."
	stamp={`EPISÓDIO ${String(data.episode.episode_number).padStart(2, '0')}`}
>
	<svelte:fragment slot="actions"
		><a
			class="back-link"
			href={resolve('/app/series/[seriesId]', {
				seriesId: data.episode.seasons?.series_id ?? 'missing',
			})}>← Bíblia da série</a
		></svelte:fragment
	>
</PageHeading>

{#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
{#if form?.episodeSaved || form?.sceneSaved || form?.choicesSaved || form?.statusSaved}<p
		class="form-success"
		role="status"
	>
		Alterações salvas. Uma nova revisão foi registrada.
	</p>{/if}

<div class="editor-grid">
	<Panel
		eyebrow="ROTEIRO · PT-BR"
		title="Caderno do episódio"
		description="A edição é manual. Toda gravação cria uma revisão; episódios publicados ficam bloqueados."
	>
		<form method="POST" action="?/saveEpisode" class="form-stack">
			<label
				>Título<input
					name="title"
					maxlength="180"
					required
					value={data.episode.title}
					disabled={isPublished}
				/></label
			>
			<div class="two-fields">
				<label
					>Duração (segundos)<input
						name="durationSeconds"
						type="number"
						min="90"
						max="150"
						required
						value={Math.floor(data.episode.duration_ms / 1000)}
						disabled={isPublished}
					/></label
				><label class="check-label"
					><input
						type="checkbox"
						name="isSeasonFinale"
						checked={data.episode.is_season_finale}
						disabled={isPublished}
					/> Final da temporada</label
				>
			</div>
			<label
				>Logline<input
					name="logline"
					maxlength="1000"
					value={data.episode.logline}
					disabled={isPublished}
				/></label
			>
			<label
				>Abertura / hook<textarea name="hook" maxlength="2000" rows="2" disabled={isPublished}
					>{data.episode.hook}</textarea
				></label
			>
			<label
				>Narrativa<textarea name="narrative" maxlength="30000" rows="6" disabled={isPublished}
					>{data.episode.narrative}</textarea
				></label
			>
			<label
				>Revelação<textarea name="reveal" maxlength="2000" rows="2" disabled={isPublished}
					>{data.episode.reveal}</textarea
				></label
			>
			<label
				>Cliffhanger<textarea name="cliffhanger" maxlength="2000" rows="2" disabled={isPublished}
					>{data.episode.cliffhanger}</textarea
				></label
			>
			<label
				>Narração completa · português brasileiro<textarea
					name="narrationPtBr"
					maxlength="30000"
					rows="7"
					disabled={isPublished}>{data.episode.narration_pt_br}</textarea
				></label
			>
			<label
				>Legenda / CTA · TikTok<textarea
					name="tiktokCaption"
					maxlength="2200"
					rows="3"
					disabled={isPublished}>{metadata.tiktok_caption ?? ''}</textarea
				></label
			>
			<label
				>Legenda / CTA · Instagram<textarea
					name="instagramCaption"
					maxlength="2200"
					rows="3"
					disabled={isPublished}>{metadata.instagram_caption ?? ''}</textarea
				></label
			>
			<label
				>Texto de capa<input
					name="coverText"
					maxlength="300"
					value={metadata.cover_text ?? ''}
					disabled={isPublished}
				/></label
			>
			{#if !isPublished}<button class="primary-button" type="submit"
					>Salvar roteiro e revisar timeline</button
				>{:else}<p class="published-note">
					Publicado em {new Date(data.episode.published_at).toLocaleString('pt-BR')} · conteúdo imutável
				</p>{/if}
		</form>
	</Panel>

	<div class="side-stack">
		<Panel eyebrow="ESTADO" title="Prontidão">
			<div class="status-line">
				<span>ESTADO DO EPISÓDIO</span><StatusPill
					label={data.episode.status}
					tone={isPublished ? 'danger' : data.episode.status === 'READY' ? 'phosphor' : 'neutral'}
				/>
			</div>
			<div class="status-line">
				<span>DURAÇÃO</span><strong
					>{Math.floor(data.episode.duration_ms / 1000)} s · {data.scenes.length} cenas</strong
				>
			</div>
			<div class="status-line"><span>OPÇÕES</span><strong>{data.choices.length} de 2</strong></div>
			<div class="status-line"><span>REVISÕES</span><strong>{data.revisions.length}</strong></div>
			{#if !isPublished && data.episode.status === 'DRAFT'}<form method="POST" action="?/markReady">
					<button class="secondary-button full" type="submit">Validar e marcar pronto</button>
				</form>{/if}
			{#if !isPublished && data.episode.status === 'READY'}<form
					method="POST"
					action="?/publish"
					class="publish-form"
				>
					<label class="check-label"
						><input type="checkbox" name="publishConfirmed" required /> Revisei texto, continuidade e
						cenas.</label
					><button class="danger-button full" type="submit">Publicar e bloquear edição</button>
				</form>{/if}
		</Panel>
		<Panel eyebrow="HISTÓRICO" title="Revisões append-only">
			{#if data.revisions.length}<ol class="revision-list">
					{#each data.revisions as revision (revision.id)}<li>
							<span>R{String(revision.revision_number).padStart(3, '0')}</span>
							<div>
								<strong>{revision.change_note || 'Alteração do episódio'}</strong><small
									>{new Date(revision.created_at).toLocaleString('pt-BR')}</small
								>
							</div>
						</li>{/each}
				</ol>{:else}<p class="quiet-copy">
					A primeira revisão aparece após salvar o conteúdo.
				</p>{/if}
		</Panel>
		<Panel
			eyebrow="PACOTE MANUAL"
			title="Flow e CapCut"
			description="Exporta roteiro, timeline, prompts e legendas. Imagens ausentes aparecem no manifesto."
		>
			<a
				class="export-link"
				href={resolve('/app/export/[episodeId]', { episodeId: data.episode.id })}
				>Preparar pacote ZIP <span aria-hidden="true">↗</span></a
			>
		</Panel>
	</div>
</div>

<section class="storyboard-section" aria-labelledby="storyboard-title">
	<header class="section-heading">
		<div>
			<p class="eyebrow">STORYBOARD · PROMPTS EM INGLÊS</p>
			<h2 id="storyboard-title">Cenas em sequência</h2>
		</div>
		<p>{data.scenes.length} quadros planejados · intervalos de 8 segundos</p>
	</header>
	<div class="scene-list">
		{#each data.scenes as scene (scene.id)}
			<details
				class="scene-card"
				id={`scene-${scene.scene_index}`}
				open={scene.scene_index <= 2 && !isPublished}
			>
				<summary
					><span class="scene-index">CENA {String(scene.scene_index).padStart(2, '0')}</span><span
						class="scene-time">{formatTime(scene.start_ms)} — {formatTime(scene.end_ms)}</span
					><strong>{scene.visual_description || 'Descrição visual pendente'}</strong><span
						class="expand-mark"
						aria-hidden="true">＋</span
					></summary
				>
				<form method="POST" action="?/saveScene" class="form-stack scene-form">
					<input type="hidden" name="sceneId" value={scene.id} />
					<label
						>Narração da cena · PT-BR<textarea
							name="narrationPtBr"
							rows="2"
							maxlength="2000"
							disabled={isPublished}>{scene.narration_pt_br}</textarea
						></label
					>
					<label
						>Descrição visual<textarea
							name="visualDescription"
							rows="2"
							maxlength="2000"
							disabled={isPublished}>{scene.visual_description}</textarea
						></label
					>
					<div class="two-fields">
						<label
							>Câmera<textarea name="cameraNotes" rows="2" maxlength="1000" disabled={isPublished}
								>{scene.camera_notes}</textarea
							></label
						><label
							>Luz<textarea name="lightingNotes" rows="2" maxlength="1000" disabled={isPublished}
								>{scene.lighting_notes}</textarea
							></label
						>
					</div>
					<label
						>Prompt do quadro inicial · EN<textarea
							name="startFramePromptEn"
							rows="2"
							maxlength="2000"
							disabled={isPublished}>{scene.start_frame_prompt_en}</textarea
						></label
					>
					<label
						>Prompt do quadro final · EN<textarea
							name="endFramePromptEn"
							rows="2"
							maxlength="2000"
							disabled={isPublished}>{scene.end_frame_prompt_en}</textarea
						></label
					>
					<label
						>Prompt de movimento · EN<textarea
							name="motionPromptEn"
							rows="2"
							maxlength="2000"
							disabled={isPublished}>{scene.motion_prompt_en}</textarea
						></label
					>
					<label
						>Notas de áudio<textarea
							name="audioNotes"
							rows="2"
							maxlength="1000"
							disabled={isPublished}>{scene.audio_notes}</textarea
						></label
					>
					{#if !isPublished}<button class="secondary-button" type="submit">Salvar cena</button>{/if}
				</form>
				<form method="POST" action="?/saveFrames" class="frames-form">
					<input type="hidden" name="sceneId" value={scene.id} />
					<label
						>Quadro inicial<select
							name="startFrameAssetId"
							value={scene.start_frame_asset_id ?? ''}
							disabled={isPublished}
							><option value="">Sem quadro</option
							>{#each data.mediaAssets as asset (asset.id)}<option value={asset.id}
									>{asset.asset_kind} · {asset.width}×{asset.height} · {asset.id.slice(
										0,
										8,
									)}</option
								>{/each}</select
						></label
					>
					<label
						>Quadro final<select
							name="endFrameAssetId"
							value={scene.end_frame_asset_id ?? ''}
							disabled={isPublished}
							><option value="">Sem quadro</option
							>{#each data.mediaAssets as asset (asset.id)}<option value={asset.id}
									>{asset.asset_kind} · {asset.width}×{asset.height} · {asset.id.slice(
										0,
										8,
									)}</option
								>{/each}</select
						></label
					>
					{#if !isPublished}<button
							class="secondary-button"
							type="submit"
							disabled={data.mediaAssets.length === 0}>Vincular quadros</button
						>{:else}<a
							class="frame-preview"
							href={scene.start_frame_asset_id
								? resolve('/api/media/[assetId]', { assetId: scene.start_frame_asset_id })
								: resolve('/app/library')}>Ver quadro inicial</a
						>{/if}
				</form>
			</details>
		{/each}
	</div>
</section>

<section class="choices-section" aria-labelledby="choices-title">
	<Panel
		eyebrow="DECISÃO DO PÚBLICO"
		title="Duas opções narrativas"
		description="A temporada pode terminar sem ramificação. Votos nunca são coletados automaticamente."
	>
		<form method="POST" action="?/saveChoices" class="choice-grid">
			{#each ['1', '2'] as key (key)}
				{@const saved = option(key)}
				<fieldset disabled={isPublished}>
					<legend>OPÇÃO {key}</legend><label
						>Rótulo<input
							name={`option${key}Label`}
							maxlength="180"
							required
							value={saved?.label ?? ''}
						/></label
					><label
						>Consequência<textarea
							name={`option${key}Consequence`}
							rows="4"
							maxlength="4000"
							required>{saved?.consequence ?? ''}</textarea
						></label
					>
				</fieldset>
			{/each}
			{#if !isPublished}<button class="primary-button" type="submit">Salvar as duas opções</button
				>{/if}
		</form>
	</Panel>
</section>

{#if isPublished && !data.episode.is_season_finale}
	<section class="continuity-section" aria-labelledby="continuity-title">
		<Panel
			eyebrow="CONTINUIDADE · MANUAL"
			title="Votação e revisão de cânone"
			description="Publique a enquete fora do DIF Studio. Registre apenas totais verificados e aprove qualquer atualização de cânone explicitamente."
		>
			{#if !data.poll}
				<form method="POST" action="?/createPoll" class="form-stack poll-form">
					<p class="manual-note">
						A votação só começa depois da publicação manual do post. Informe o identificador do post
						como referência opcional.
					</p>
					<label
						>Referência do post<input
							name="externalPostId"
							maxlength="200"
							placeholder="URL ou identificador do post"
						/></label
					>
					<div class="two-fields">
						<label
							>Horas até encerrar<input
								name="durationHours"
								type="number"
								min="1"
								max="168"
								value="48"
								required
							/></label
						><label
							>Opção vencedora em empate<select name="tieBreakOption"
								><option value="1">Opção 1</option><option value="2">Opção 2</option></select
							></label
						>
					</div>
					<label
						>Regra publicada para desempate<textarea
							name="tieBreakRule"
							rows="2"
							maxlength="500"
							required
							placeholder="Descreva a regra anunciada antes da votação."></textarea></label
					>
					<button class="secondary-button" type="submit">Abrir registro da votação</button>
				</form>
			{:else}
				<div class="poll-summary">
					<div class="status-line">
						<span>VOTAÇÃO</span><StatusPill
							label={data.poll.status}
							tone={data.poll.status === 'OPEN' ? 'danger' : 'phosphor'}
						/>
					</div>
					<p>
						Encerra em {new Date(data.poll.closes_at).toLocaleString('pt-BR')} · desempate: opção {data
							.poll.tie_break_option}
					</p>
					{#if data.poll.external_post_id}<small>POST · {data.poll.external_post_id}</small>{/if}
				</div>
				{#if data.poll.status === 'OPEN'}<form method="POST" action="?/closePoll">
						<input type="hidden" name="pollId" value={data.poll.id} /><button
							class="secondary-button"
							type="submit">Registrar encerramento manual</button
						>
					</form>{/if}
				{#if data.poll.status === 'CLOSED' || data.poll.status === 'VERIFIED'}
					<form method="POST" action="?/recordResult" class="form-stack result-form">
						<input type="hidden" name="pollId" value={data.poll.id} />
						<h3>
							Registrar totais {#if latestResult}(correção R{latestResult.revision_number + 1}){/if}
						</h3>
						<div class="two-fields">
							<label
								>Votos · opção 1<input
									name="option1Count"
									type="number"
									min="0"
									required
									value="0"
								/></label
							><label
								>Votos · opção 2<input
									name="option2Count"
									type="number"
									min="0"
									required
									value="0"
								/></label
							>
						</div>
						<label
							>Fonte consultada<input
								name="evidenceSource"
								maxlength="1000"
								required
								placeholder="URL, exportação manual ou registro observado"
							/></label
						>
						<label
							>Observações de verificação<textarea name="verificationNote" rows="2" maxlength="2000"
							></textarea></label
						>
						<label class="check-label"
							><input type="checkbox" name="confirmVerified" required /> Conferi estes totais com a fonte
							informada.</label
						>
						<button class="secondary-button" type="submit">Salvar resultado verificado</button>
					</form>
				{/if}
				{#if data.results.length}
					<div class="result-history">
						<h3>Resultados registrados</h3>
						{#each data.results as result (result.id)}<article class="history-row">
								<strong
									>R{String(result.revision_number).padStart(2, '0')} · {result.option_1_count} × {result.option_2_count}</strong
								><span
									>{result.winner_option
										? `Vence opção ${result.winner_option}`
										: 'Sem votos contabilizados'}</span
								><small>{result.evidence_source}</small>
							</article>{/each}
					</div>
				{/if}
				{#if latestResult?.winner_option}
					<form method="POST" action="?/approveCanon" class="form-stack result-form">
						<input type="hidden" name="pollId" value={data.poll.id} /><input
							type="hidden"
							name="pollResultId"
							value={latestResult.id}
						/>
						<h3>Revisar efeito no cânone</h3>
						<label
							>Snapshot da continuidade · JSON<textarea
								name="canonSnapshot"
								rows="4"
								required
								maxlength="20000"
								placeholder={'{"ramo":"descreva o estado após a escolha"}'}></textarea></label
						>
						<label
							>Justificativa da autora<textarea name="rationale" rows="2" maxlength="4000" required
							></textarea></label
						>
						<label class="check-label"
							><input type="checkbox" name="acceptCanon" required /> Revisei e aprovo este estado como
							novo cânone.</label
						>
						<button class="primary-button" type="submit">Registrar decisão append-only</button>
					</form>
				{/if}
				{#if data.decisions.length}
					<div class="result-history">
						<h3>Histórico de cânone</h3>
						{#each data.decisions as decision (decision.id)}<article class="history-row">
								<strong>DECISÃO R{String(decision.revision_number).padStart(2, '0')}</strong><span
									>{decision.rationale}</span
								><small
									>Aprovado manualmente · {new Date(decision.created_at).toLocaleString(
										'pt-BR',
									)}</small
								>
							</article>{/each}
					</div>
				{/if}
			{/if}
		</Panel>
	</section>
{/if}

<style>
	.editor-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(17rem, 0.75fr);
		gap: 1rem;
		align-items: start;
	}
	.side-stack {
		display: grid;
		gap: 1rem;
	}
	.storyboard-section,
	.choices-section,
	.continuity-section {
		margin-top: 2.3rem;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 1rem;
		margin-bottom: 0.9rem;
	}
	.section-heading h2 {
		margin: 0;
	}
	.section-heading > p {
		margin: 0;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.form-stack {
		display: grid;
		gap: 0.7rem;
	}
	.form-stack label,
	.choice-grid label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.74rem;
	}
	.form-stack input,
	.form-stack textarea,
	.form-stack select,
	.choice-grid input,
	.choice-grid textarea {
		width: 100%;
		padding: 0.58rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
	}
	.form-stack textarea,
	.choice-grid textarea {
		resize: vertical;
	}
	.form-stack input:disabled,
	.form-stack textarea:disabled {
		opacity: 0.65;
	}
	.two-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.65rem;
		align-items: end;
	}
	.check-label {
		display: flex !important;
		align-items: center;
		gap: 0.5rem !important;
		min-height: 2.65rem;
	}
	.check-label input {
		width: auto !important;
		accent-color: var(--phosphor);
	}
	.primary-button,
	.secondary-button,
	.danger-button {
		min-height: 2.6rem;
		padding: 0.55rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 3%);
		color: var(--ink);
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
	}
	.primary-button {
		border-color: rgb(169 197 108 / 48%);
		background: linear-gradient(145deg, #a9c56c, #7f9c4a);
		color: #10130b;
	}
	.danger-button {
		border-color: rgb(183 63 85 / 55%);
		background: rgb(183 63 85 / 12%);
		color: #ed9aaa;
	}
	.full {
		width: 100%;
		margin-top: 0.8rem;
	}
	.status-line {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
		padding: 0.62rem 0;
		border-bottom: 1px solid var(--line);
	}
	.status-line > span {
		color: var(--muted);
		font: 0.62rem var(--mono);
		letter-spacing: 0.06em;
	}
	.status-line > strong {
		font-size: 0.74rem;
	}
	.published-note {
		color: var(--muted);
		font-size: 0.76rem;
	}
	.publish-form {
		margin-top: 0.7rem;
	}
	.revision-list {
		display: grid;
		gap: 0.65rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}
	.revision-list li {
		display: grid;
		grid-template-columns: 3.2rem 1fr;
		gap: 0.6rem;
	}
	.revision-list li > span {
		color: var(--phosphor);
		font: 0.64rem var(--mono);
	}
	.revision-list li div {
		display: grid;
		gap: 0.15rem;
	}
	.revision-list strong {
		font-size: 0.73rem;
	}
	.revision-list small {
		color: var(--muted);
		font-size: 0.64rem;
	}
	.quiet-copy {
		color: var(--muted);
		font-size: 0.77rem;
	}
	.export-link {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--phosphor);
		font-size: 0.8rem;
		text-decoration: none;
	}
	.scene-list {
		display: grid;
		gap: 0.6rem;
	}
	.scene-card {
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--panel);
		overflow: hidden;
	}
	.scene-card summary {
		display: grid;
		grid-template-columns: 6rem 6rem minmax(0, 1fr) 1.5rem;
		gap: 0.7rem;
		align-items: center;
		padding: 0.9rem 1rem;
		cursor: pointer;
		list-style: none;
	}
	.scene-card summary::-webkit-details-marker {
		display: none;
	}
	.scene-index,
	.scene-time {
		color: var(--muted);
		font: 0.62rem var(--mono);
	}
	.scene-index {
		color: var(--phosphor);
	}
	.scene-card summary strong {
		overflow: hidden;
		font-size: 0.78rem;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.expand-mark {
		color: var(--muted);
	}
	.scene-card[open] .expand-mark {
		transform: rotate(45deg);
	}
	.scene-form {
		padding: 0 1rem 1rem;
	}
	.frames-form {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 0.65rem;
		align-items: end;
		padding: 0 1rem 1rem;
	}
	.frames-form label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.7rem;
	}
	.frames-form select {
		width: 100%;
		min-width: 0;
		padding: 0.5rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		background: #0b0d10;
		color: var(--ink);
		font-size: 0.68rem;
	}
	.frame-preview {
		color: var(--phosphor);
		font-size: 0.7rem;
	}
	.choice-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}
	.choice-grid fieldset {
		display: grid;
		gap: 0.65rem;
		min-width: 0;
		padding: 0.85rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.choice-grid legend {
		padding: 0 0.4rem;
		color: var(--phosphor);
		font: 0.64rem var(--mono);
		letter-spacing: 0.08em;
	}
	.choice-grid > button {
		grid-column: 1 / -1;
	}
	.manual-note {
		color: var(--muted);
		font-size: 0.76rem;
	}
	.poll-summary {
		margin-bottom: 0.8rem;
		padding: 0.7rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.poll-summary p {
		margin: 0.5rem 0;
		color: var(--muted);
		font-size: 0.75rem;
	}
	.poll-summary small {
		color: var(--dim);
		font-size: 0.64rem;
	}
	.result-form {
		max-width: 52rem;
		margin-top: 1rem;
		padding: 1rem 0;
		border-top: 1px solid var(--line);
	}
	.result-form h3,
	.result-history h3 {
		margin: 0;
		font-size: 1.25rem;
	}
	.result-history {
		display: grid;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.history-row {
		display: grid;
		gap: 0.2rem;
		padding: 0.65rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.history-row strong {
		font-size: 0.76rem;
	}
	.history-row span,
	.history-row small {
		color: var(--muted);
		font-size: 0.7rem;
		overflow-wrap: anywhere;
	}
	.form-error,
	.form-success {
		padding: 0.7rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
	}
	.form-error {
		border-color: rgb(183 63 85 / 45%);
		color: #ed9aaa;
	}
	.form-success {
		color: var(--phosphor);
	}
	.back-link {
		color: var(--muted);
		font-size: 0.78rem;
		text-decoration: none;
	}
	@media (max-width: 1020px) {
		.editor-grid {
			grid-template-columns: 1fr;
		}
		.side-stack {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.side-stack :global(section:last-child) {
			grid-column: 1/-1;
		}
	}
	@media (max-width: 680px) {
		.side-stack {
			grid-template-columns: 1fr;
		}
		.choice-grid {
			grid-template-columns: 1fr;
		}
		.scene-card summary {
			grid-template-columns: 5.2rem 5rem minmax(0, 1fr) 1rem;
			gap: 0.4rem;
			padding: 0.75rem;
		}
		.scene-card summary strong {
			font-size: 0.7rem;
		}
		.scene-form {
			padding-inline: 0.75rem;
		}
		.frames-form {
			grid-template-columns: 1fr;
			padding-inline: 0.75rem;
		}
	}
	@media (max-width: 450px) {
		.two-fields {
			grid-template-columns: 1fr;
		}
		.scene-card summary {
			grid-template-columns: 1fr auto;
		}
		.scene-index,
		.scene-time {
			grid-row: auto;
		}
		.scene-card summary strong {
			grid-column: 1/-1;
			grid-row: 2;
			white-space: normal;
		}
		.expand-mark {
			grid-column: 2;
			grid-row: 1;
		}
	}
</style>
