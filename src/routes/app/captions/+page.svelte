<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { CaptionCue, CaptionTrack } from '#lib/schemas/captions.js';

	let {
		data,
		form,
	}: {
		data: PageData;
		form: {
			success?: boolean;
			message?: string;
			version?: number;
			cues?: number;
		} | null;
	} = $props();
	// svelte-ignore state_referenced_locally
	let track = $state<CaptionTrack | null>(data.track ? structuredClone(data.track) : null);
	let editorKey = $state('');
	let asrJson = $state('');
	let previewIndex = $state(0);

	$effect(() => {
		const key = `${data.context?.episodeId ?? ''}:${data.context?.planVersion ?? 0}:${data.trackVersion}`;
		if (key === editorKey) return;
		editorKey = key;
		track = data.track ? structuredClone(data.track) : null;
		previewIndex = 0;
	});

	function updateCue(index: number, patch: Partial<CaptionCue>) {
		if (!track) return;
		track = {
			...track,
			cues: track.cues.map((cue, position) => (position === index ? { ...cue, ...patch } : cue)),
		};
	}

	function addCue() {
		if (!track || !data.context) return;
		const previous = track.cues.at(-1);
		const startMs = previous?.endMs ?? 0;
		const endMs = Math.min(data.context.durationMs, Math.max(startMs + 2_000, startMs + 300));
		track = {
			...track,
			cues: [
				...track.cues,
				{
					id: crypto.randomUUID(),
					startMs,
					endMs,
					text: 'Nova legenda',
					words: [],
				},
			],
		};
		previewIndex = track.cues.length - 1;
	}

	function removeCue(index: number) {
		if (!track) return;
		track = { ...track, cues: track.cues.filter((_, position) => position !== index) };
		previewIndex = Math.max(0, Math.min(previewIndex, track.cues.length - 1));
	}

	function formatMs(value: number): string {
		return `${(value / 1000).toFixed(2)}s`;
	}
</script>

<svelte:head><title>Legendas | DIF Studio</title></svelte:head>

<section class="page-head">
	<p class="eyebrow">LEGENDAS</p>
	<h1>Legendas alinhadas</h1>
	<p class="lede">
		Alinhe a narração real, edite cada cue e exporte SRT/ASS. Se o ASR local falhar, o editor manual
		continua funcional; nenhuma legenda é marcada como sincronizada sem evidência.
	</p>
</section>

<form class="episode-picker" method="GET">
	<label for="caption-episode">Episódio</label>
	<select
		id="caption-episode"
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
{#if form?.success}
	<p class="notice success" role="status">
		Legendas salvas na versão {form.version}{form.cues !== undefined ? ` (${form.cues} cues)` : ''}.
	</p>
{/if}
{#if data.loadError}<p class="notice error" role="alert">{data.loadError}</p>{/if}

{#if !data.context || !track}
	<p class="empty">Aprove um plano de edição e uma voz para começar.</p>
{:else}
	<section class="meta">
		<div>
			<span>Plano</span><strong>v{data.context.planVersion} · {data.context.planStatus}</strong>
		</div>
		<div><span>Duração</span><strong>{data.context.durationMs} ms</strong></div>
		<div>
			<span>Voz</span><strong
				>{data.context.narrationApproved
					? 'aprovada'
					: data.context.narrationTakeId
						? 'não aprovada'
						: 'ausente'}</strong
			>
		</div>
		<div>
			<span>Legenda</span><strong>{data.trackStatus ?? 'NÃO SALVA'} · v{data.trackVersion}</strong>
		</div>
	</section>

	{#if !data.context.narrationApproved}
		<p class="notice error" role="status">
			Aprove a narração na página de narração antes de gerar ou aprovar legendas.
		</p>
	{/if}

	<div class="actions">
		<a href={resolve('/app/timeline')}>Timeline</a>
		<a href={resolve('/app/narration')}>Narração</a>
		<a href={resolve('/api/captions/[episodeId]/srt', { episodeId: data.context.episodeId })}
			>Baixar SRT</a
		>
		<a href={resolve('/api/captions/[episodeId]/ass', { episodeId: data.context.episodeId })}
			>Baixar ASS</a
		>
	</div>

	<section class="preview" aria-label="Prévia da legenda">
		<h2>Prévia 9:16</h2>
		<div class="phone">
			{#if track.cues[previewIndex]}
				<p class="cue-preview" class:highlight={track.style === 'highlight'}>
					{track.cues[previewIndex]?.text}
				</p>
			{:else}
				<p class="empty">Sem cue na prévia.</p>
			{/if}
		</div>
		<label
			>Estilo
			<select bind:value={track.style} onchange={() => (track = track ? { ...track } : track)}>
				<option value="clean">Sobriedade</option>
				<option value="vhs">VHS</option>
				<option value="highlight">Palavra destacada</option>
			</select>
		</label>
		<label
			>Safe zone
			<select bind:value={track.safeZone}>
				<option value="tiktok">TikTok</option>
				<option value="reels">Reels</option>
				<option value="stories">Stories</option>
				<option value="feed">Feed</option>
			</select>
		</label>
	</section>

	<form method="POST" action="?/save" class="plan-form">
		<input type="hidden" name="episodeId" value={data.context.episodeId} />
		<input type="hidden" name="expectedVersion" value={data.trackVersion} />
		<input type="hidden" name="track" value={JSON.stringify(track)} />
		<label>Nota da versão <input name="changeNote" maxlength="500" /></label>
		<button type="submit">Salvar legendas</button>
		<button
			class="primary"
			type="submit"
			formaction="?/approve"
			disabled={track.cues.length === 0 || !data.context.narrationApproved}
		>
			Aprovar legendas
		</button>
	</form>

	<ol class="cues">
		{#each track.cues as cue, index (cue.id)}
			<li class:selected={index === previewIndex}>
				<header>
					<span>CUE {index + 1} · {formatMs(cue.startMs)} → {formatMs(cue.endMs)}</span>
					<span>
						<button type="button" class="link" onclick={() => (previewIndex = index)}>Prévia</button
						>
						<button type="button" class="link" onclick={() => removeCue(index)}>Remover</button>
					</span>
				</header>
				<textarea
					value={cue.text}
					maxlength="240"
					oninput={(event) => updateCue(index, { text: event.currentTarget.value })}></textarea>
				<div class="controls">
					<label
						>Início (ms) <input
							type="number"
							min="0"
							max={data.context.durationMs}
							value={cue.startMs}
							onchange={(event) => updateCue(index, { startMs: Number(event.currentTarget.value) })}
						/></label
					>
					<label
						>Fim (ms) <input
							type="number"
							min="0"
							max={data.context.durationMs}
							value={cue.endMs}
							onchange={(event) => updateCue(index, { endMs: Number(event.currentTarget.value) })}
						/></label
					>
				</div>
			</li>
		{/each}
	</ol>
	<button type="button" onclick={addCue}>Adicionar cue</button>

	<section class="asr">
		<h2>Alinhamento ASR local</h2>
		<p class="hint">
			O worker gera palavras com timestamp; cole o JSON abaixo para alinhamento forçado. O texto
			final vem do roteiro, não de palavras inventadas pelo ASR. Em caso de falha, edite as cues
			manualmente.
		</p>
		<form method="POST" action="?/generate" class="asr-form">
			<input type="hidden" name="episodeId" value={data.context.episodeId} />
			<input type="hidden" name="planVersion" value={data.context.planVersion} />
			<input type="hidden" name="expectedVersion" value={data.trackVersion} />
			<textarea name="asr" rows="8" placeholder="JSON de palavras do ASR" bind:value={asrJson}
			></textarea>
			<input type="hidden" name="style" value={track.style} />
			<input type="hidden" name="safeZone" value={track.safeZone} />
			<button type="submit" disabled={!asrJson.trim() || !data.context.narrationApproved}>
				Alinhar a partir do ASR
			</button>
		</form>
		<p class="hint">
			CLI real: <code>npm run captions:align</code> com <code>CAPTION_EPISODE_ID</code>,
			<code>CAPTION_ASR_FILE</code> e <code>CAPTION_OUTPUT_DIR</code>; opcional
			<code>CAPTION_AUDIO_FILE</code> + <code>VOSK_MODEL</code>.
		</p>
	</section>

	{#if data.versions.length}
		<section class="history" aria-label="Versões das legendas">
			<h2>Versões</h2>
			<ul>
				{#each data.versions as version (version.version)}
					<li>
						<div>
							<strong>v{version.version}</strong>
							<span>{version.note || 'Sem nota'}</span>
						</div>
						<form method="POST" action="?/restore">
							<input type="hidden" name="episodeId" value={data.context.episodeId} />
							<input type="hidden" name="planVersion" value={data.context.planVersion} />
							<input type="hidden" name="version" value={version.version} />
							<input type="hidden" name="expectedVersion" value={data.trackVersion} />
							<button type="submit">Restaurar</button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style>
	.page-head {
		display: grid;
		gap: 0.5rem;
		margin-block-end: 1.5rem;
	}
	.eyebrow {
		color: var(--accent);
		font-size: 0.75rem;
		letter-spacing: 0.18em;
	}
	h1 {
		font-size: clamp(2rem, 6vw, 3.5rem);
	}
	.lede {
		max-width: 65ch;
		color: var(--muted);
	}
	.episode-picker {
		display: grid;
		gap: 0.35rem;
		margin-block: 1rem;
	}
	.episode-picker select {
		width: 100%;
	}
	.meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
	}
	.meta span {
		display: block;
		color: var(--muted);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-block: 1rem;
	}
	.actions a {
		color: var(--accent);
	}
	.preview {
		display: grid;
		gap: 0.75rem;
		margin-block: 1rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		background: var(--surface);
	}
	.phone {
		width: min(100%, 220px);
		aspect-ratio: 9 / 16;
		margin-inline: auto;
		border: 2px solid var(--line);
		border-radius: 1.2rem;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 1.2rem;
		background: #111;
	}
	.cue-preview {
		text-align: center;
		font-weight: 700;
		font-size: clamp(0.8rem, 2vw, 1rem);
		text-shadow: 0 2px 4px #000;
		white-space: pre-line;
	}
	.cue-preview.highlight {
		color: #ffe66d;
	}
	.plan-form,
	.asr-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-block: 1rem;
	}
	select,
	input,
	textarea {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.55rem 0.7rem;
	}
	.cues {
		display: grid;
		gap: 0.75rem;
		padding: 0;
		list-style: none;
	}
	.cues li {
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--surface);
	}
	.cues li.selected {
		border-color: var(--accent);
	}
	.cues header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.cues textarea {
		width: 100%;
		min-height: 4rem;
		margin-block: 0.6rem;
		resize: vertical;
	}
	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.6rem;
	}
	.controls label {
		display: grid;
		gap: 0.25rem;
		color: var(--muted);
		font-size: 0.8rem;
	}
	button {
		cursor: pointer;
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		background: var(--surface-strong, #222);
		color: var(--ink);
		padding: 0.5rem 0.8rem;
	}
	button.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: #0b0b0b;
		font-weight: 700;
	}
	button.link {
		background: none;
		border: 0;
		color: var(--accent);
		padding: 0;
	}
	.asr {
		margin-block-start: 2rem;
	}
	.asr-form textarea {
		width: 100%;
		font-family: monospace;
	}
	.hint {
		color: var(--muted);
		font-size: 0.82rem;
		max-width: 70ch;
	}
	.notice {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
	}
	.notice.error {
		border: 1px solid #d55;
		color: #ffb4b4;
		background: #2a1212;
	}
	.notice.success {
		border: 1px solid var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.empty {
		color: var(--muted);
	}
	.history {
		margin-block-start: 2rem;
	}
	.history ul {
		display: grid;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
	}
	.history li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		padding: 0.7rem;
	}
</style>
