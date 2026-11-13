<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type { VoiceDirectionPlan, VoiceSegment } from '#lib/schemas/voice-direction.js';

	let {
		data,
		form,
	}: {
		data: PageData;
		form: { success?: boolean; message?: string; version?: number } | null;
	} = $props();
	let plan = $state<VoiceDirectionPlan | null>(null);
	let takeId = $state<string | null>(null);
	let uploadError = $state<string | null>(null);
	let uploading = $state(false);
	let editorKey = $state('');
	let compareA = $state<string | null>(null);
	let compareB = $state<string | null>(null);

	$effect(() => {
		const key = `${data.selectedEpisode?.id ?? ''}:${data.storedPlan?.currentVersion ?? 0}`;
		if (key === editorKey) return;
		editorKey = key;
		plan = data.plan ? structuredClone(data.plan) : null;
		takeId = plan?.takeId ?? null;
	});

	$effect(() => {
		const ids = data.takes.map((take) => take.id);
		if (!compareA || !ids.includes(compareA)) compareA = ids[0] ?? null;
		if (!compareB || !ids.includes(compareB)) compareB = ids[1] ?? ids[0] ?? null;
	});

	function updateSegment(index: number, patch: Partial<VoiceSegment>) {
		if (!plan) return;
		plan = {
			...plan,
			segments: plan.segments.map((segment, position) =>
				position === index ? { ...segment, ...patch } : segment,
			),
		};
	}

	async function uploadVoice(event: Event) {
		if (!data.selectedEpisode) return;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		uploadError = null;
		try {
			const body = new FormData();
			body.set('file', file);
			body.set('episodeId', data.selectedEpisode.id);
			const response = await fetch('/api/narration/upload', { method: 'POST', body });
			if (!response.ok) {
				const payload = (await response.json().catch(() => ({}))) as { message?: string };
				uploadError = payload.message ?? 'Falha no upload da voz.';
				return;
			}
			const payload = (await response.json()) as { take: { id: string } };
			window.location.reload();
			void payload;
		} catch {
			uploadError = 'Falha no upload da voz.';
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	function selectTake(id: string) {
		takeId = id;
		if (plan) plan = { ...plan, takeId: id };
	}
</script>

<svelte:head><title>Narração | DIF Studio</title></svelte:head>

<section class="page-head">
	<p class="eyebrow">VOZ</p>
	<h1>Narração e direção</h1>
	<p class="lede">
		Importe a voz do autor ou use o TTS local; a emoção é direção versionada, não promessa
		automática de prosódia. Velocidades fora de 1,0 degradam a fala; o Piper aplica
		velocidade/volume/pausas, não emoção.
	</p>
</section>

<form class="episode-picker" method="GET">
	<label for="narration-episode">Episódio</label>
	<select
		id="narration-episode"
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
		Direção salva como versão {form.version}. Recarregue para ver o estado atual.
	</p>
{/if}
{#if uploadError}<p class="notice error" role="alert">{uploadError}</p>{/if}
{#if data.planError}<p class="notice error" role="alert">{data.planError}</p>{/if}

{#if !data.selectedEpisode}
	<p class="empty">Crie/selecione um episódio.</p>
{:else if !plan}
	<p class="empty">O episódio não tem texto de narração para dirigir.</p>
{:else}
	<section class="meta">
		<div><span>Status</span><strong>{data.storedPlan?.status ?? 'NÃO SALVO'}</strong></div>
		<div><span>Versão</span><strong>{data.storedPlan?.currentVersion ?? 0}</strong></div>
		<div>
			<span>Duração estimada</span>
			<strong>{Math.round(data.storedPlan?.estimatedDurationMs ?? 0)} ms</strong>
		</div>
		<div>
			<span>Render</span>
			<strong
				><a href={resolve(`/app/timeline?episodeId=${data.selectedEpisode.id}`)}
					>Voltar à timeline</a
				></strong
			>
		</div>
	</section>

	<form method="POST" action="?/save" class="plan-form">
		<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
		<input type="hidden" name="expectedVersion" value={data.storedPlan?.currentVersion ?? 0} />
		<input type="hidden" name="plan" value={JSON.stringify({ ...plan, takeId })} />
		<label>Nota da versão <input name="changeNote" maxlength="500" /></label>
		<label
			>Preset editorial
			<select
				value={plan.seriesPreset}
				onchange={(event) =>
					(plan = {
						...plan!,
						seriesPreset: event.currentTarget.value as VoiceDirectionPlan['seriesPreset'],
					})}
			>
				<option value="none">Sem preset</option>
				<option value="sussurro">Sussurro</option>
				<option value="documento_policial">Documento policial</option>
				<option value="narrador_tenso">Narrador tenso</option>
				<option value="alarme">Alarme</option>
			</select>
		</label>
		<ol class="segments">
			{#each plan.segments as segment, index (segment.id)}
				<li>
					<header>
						<span>SEGMENTO {index + 1}</span>
						<label>
							Emoção
							<select
								value={segment.emotion}
								onchange={(event) =>
									updateSegment(index, {
										emotion: event.currentTarget.value as VoiceSegment['emotion'],
									})}
							>
								<option value="neutral">Neutro</option>
								<option value="tension">Tensão</option>
								<option value="whisper">Sussurro</option>
								<option value="urgency">Urgência</option>
								<option value="fear">Medo</option>
								<option value="revelation">Revelação</option>
							</select>
						</label>
					</header>
					<textarea
						value={segment.text}
						maxlength="1000"
						oninput={(event) => updateSegment(index, { text: event.currentTarget.value })}
					></textarea>
					<div class="controls">
						<label
							>Velocidade <input
								type="number"
								min="0.75"
								max="1.25"
								step="0.05"
								value={segment.speed}
								onchange={(event) =>
									updateSegment(index, { speed: Number(event.currentTarget.value) })}
							/></label
						>
						<label
							>Pausa antes (ms) <input
								type="number"
								min="0"
								max="5000"
								value={segment.pauseBeforeMs}
								onchange={(event) =>
									updateSegment(index, { pauseBeforeMs: Number(event.currentTarget.value) })}
							/></label
						>
						<label
							>Pausa depois (ms) <input
								type="number"
								min="0"
								max="5000"
								value={segment.pauseAfterMs}
								onchange={(event) =>
									updateSegment(index, { pauseAfterMs: Number(event.currentTarget.value) })}
							/></label
						>
						<label
							>Volume (dB) <input
								type="number"
								min="-12"
								max="6"
								step="0.5"
								value={segment.volumeDb}
								onchange={(event) =>
									updateSegment(index, { volumeDb: Number(event.currentTarget.value) })}
							/></label
						>
						<label
							>WPM alvo <input
								type="number"
								min="80"
								max="220"
								value={segment.intendedWpm}
								onchange={(event) =>
									updateSegment(index, { intendedWpm: Number(event.currentTarget.value) })}
							/></label
						>
						<label
							>Variante <input
								value={segment.variant}
								maxlength="60"
								placeholder="default"
								oninput={(event) => updateSegment(index, { variant: event.currentTarget.value })}
							/></label
						>
					</div>
					<label class="pronunciation"
						>Pronúncia para o TTS (termo=substituição, separados por vírgula)
						<input
							value={segment.pronunciation}
							maxlength="200"
							placeholder="Alice=Álissi, Vovó=Vovô"
							oninput={(event) =>
								updateSegment(index, { pronunciation: event.currentTarget.value })}
						/>
					</label>
				</li>
			{/each}
		</ol>
		<button class="primary" type="submit">Salvar direção</button>
	</form>

	{#if data.versions.length}
		<section class="history" aria-label="Versões da direção">
			<h2>Versões da direção</h2>
			<ul>
				{#each data.versions as version (version.version)}
					<li>
						<div>
							<strong>v{version.version}</strong>
							<span>{version.note || 'Sem nota'}</span>
							<time datetime={version.createdAt}
								>{version.createdAt.slice(0, 16).replace('T', ' ')}</time
							>
						</div>
						<form method="POST" action="?/restore">
							<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
							<input type="hidden" name="version" value={version.version} />
							<input
								type="hidden"
								name="expectedVersion"
								value={data.storedPlan?.currentVersion ?? 0}
							/>
							<button type="submit">Restaurar</button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="takes" aria-label="Vozes importadas">
		<h2>Voz importada ou TTS local</h2>
		<p class="hint">
			O TTS Piper é offline e opcional. Ele aplica velocidade, volume e pausas, mas não altera a
			prosódia emocional real: emoção permanece direção/legenda e a voz importada é o fallback
			honesto. Gere com <code>scripts/narration-tts.ts</code> ou envie seu arquivo. Para regenerar
			só um trecho, rode o CLI com <code>TTS_SEGMENT_ID=&lt;uuid&gt;</code> e envie o novo take; o vídeo
			aprovado é reutilizado no mux.
		</p>
		<label class="upload">
			WAV, MP3 ou M4A até 20 MB
			<input
				type="file"
				accept=".wav,.mp3,.m4a,audio/*"
				onchange={uploadVoice}
				disabled={uploading}
			/>
		</label>
		{#if !data.takes.length}
			<p class="empty">Nenhuma voz importada.</p>
		{:else}
			<ul>
				{#each data.takes as take (take.id)}
					<li class:selected={take.id === takeId}>
						<label>
							<input
								type="radio"
								name="take"
								checked={take.id === takeId}
								onchange={() => selectTake(take.id)}
							/>
							{take.source} · {take.format} · {take.duration_ms} ms · pico {take.peak_db ?? '—'} dB ·
							true peak {take.true_peak_db ?? '—'} dBFS · {take.lufs ?? '—'} LUFS
						</label>
						<audio controls preload="none" src={`/api/narration/takes/${take.id}`}></audio>
					</li>
				{/each}
			</ul>
			{#if data.takes.length > 1}
				<div class="compare">
					<h3>Comparar takes</h3>
					<div class="compare-grid">
						<label
							>Take A
							<select bind:value={compareA}>
								{#each data.takes as take (take.id)}
									<option value={take.id}>{take.source} · {take.duration_ms} ms</option>
								{/each}
							</select>
						</label>
						<label
							>Take B
							<select bind:value={compareB}>
								{#each data.takes as take (take.id)}
									<option value={take.id}>{take.source} · {take.duration_ms} ms</option>
								{/each}
							</select>
						</label>
						{#if compareA}
							<audio controls preload="none" src={`/api/narration/takes/${compareA}`}></audio>
						{/if}
						{#if compareB}
							<audio controls preload="none" src={`/api/narration/takes/${compareB}`}></audio>
						{/if}
					</div>
				</div>
			{/if}
			<form method="POST" action="?/approve">
				<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
				<input type="hidden" name="expectedVersion" value={data.storedPlan?.currentVersion ?? 0} />
				<input type="hidden" name="plan" value={JSON.stringify({ ...plan, takeId })} />
				<button class="primary" type="submit" disabled={!takeId}> Aprovar direção + voz </button>
				{#if !takeId}
					<p class="hint">Selecione uma voz para aprovar a narração.</p>
				{/if}
			</form>
		{/if}
	</section>
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
		max-width: 100%;
	}
	.plan-form {
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
	.segments {
		display: grid;
		gap: 0.75rem;
		padding: 0;
		list-style: none;
		width: 100%;
	}
	.segments li {
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--surface);
	}
	.segments header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.segments textarea {
		width: 100%;
		min-height: 5rem;
		margin-block: 0.6rem;
		resize: vertical;
	}
	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
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
	.takes,
	.history {
		margin-block-start: 2rem;
	}
	.compare {
		margin-block-start: 1rem;
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		padding: 0.8rem;
	}
	.compare-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.7rem;
	}
	.compare-grid audio {
		width: 100%;
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
	.history li div {
		display: grid;
		gap: 0.15rem;
	}
	.takes ul {
		display: grid;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
	}
	.takes li {
		border: 1px solid var(--line);
		border-radius: 0.6rem;
		padding: 0.7rem;
		display: grid;
		gap: 0.5rem;
	}
	.takes li.selected {
		border-color: var(--accent);
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
	.hint {
		color: var(--muted);
		font-size: 0.82rem;
		max-width: 70ch;
	}
	.pronunciation {
		display: grid;
		gap: 0.25rem;
		margin-block-start: 0.6rem;
		color: var(--muted);
		font-size: 0.8rem;
	}
	.pronunciation input {
		width: 100%;
	}
	.empty {
		color: var(--muted);
	}
</style>
