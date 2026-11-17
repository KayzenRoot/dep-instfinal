<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import type {
		DirectorEvent,
		DirectorPreset,
		EditDirectorPlan,
		TensionPoint,
	} from '#lib/schemas/edit-director.js';

	let {
		data,
		form,
	}: {
		data: PageData;
		form: {
			success?: boolean;
			message?: string;
			director?: EditDirectorPlan;
			estimatedTokens?: number;
			warning?: string;
			version?: number;
		} | null;
	} = $props();

	let director = $state<EditDirectorPlan | null>(null);
	let accepted = $state<string[]>([]);
	let preset = $state<DirectorPreset>('reveal');
	let seed = $state(7);
	let suspense = $state(true);
	let mode = $state<'offline' | 'gemini'>('offline');
	let reduceMotion = $state(false);
	let editorKey = $state('');

	$effect(() => {
		const key = `${data.selectedEpisode?.id ?? ''}:${data.plan?.version ?? 0}:${data.director?.planHash ?? ''}`;
		if (key === editorKey) return;
		editorKey = key;
		director = data.director ? structuredClone(data.director) : null;
		accepted = data.director?.acceptedEventIds ?? [];
		if (data.director) preset = data.director.preset;
	});

	$effect(() => {
		if (!form?.director) return;
		director = structuredClone(form.director);
		accepted = [];
	});

	const eventLabels: Record<DirectorEvent['type'], string> = {
		SILENCE_BEFORE_REVEAL: 'Silêncio antes da revelação',
		DOOR_CREAK: 'Porta rangendo',
		VHS_STATIC: 'Glitch VHS curto',
		PHRASE_HIGHLIGHT: 'Destaque de frase',
		SFX_ACCENT: 'Acento sonoro',
		CTA_CARD: 'CTA final',
	};

	const phaseLabels = {
		HOOK: 'Hook',
		BUILDUP: 'Construção',
		RELIEF: 'Alívio',
		REVEAL: 'Revelação',
		CLIMAX: 'Clímax',
		CTA: 'CTA',
	} as const;

	function pathFor(points: TensionPoint[], duration: number): string {
		if (!points.length || !duration) return '';
		return points
			.map((point, index) => {
				const x = (point.timeMs / duration) * 100;
				const y = 100 - point.tension;
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
			})
			.join(' ');
	}

	function toggle(eventId: string, checked: boolean) {
		accepted = checked ? [...accepted, eventId] : accepted.filter((id) => id !== eventId);
		if (director) {
			director = {
				...director,
				acceptedEventIds: accepted,
				events: director.events.map((event) =>
					event.id === eventId
						? { ...event, status: checked ? ('ACCEPTED' as const) : ('PROPOSED' as const) }
						: event,
				),
				planHash: null,
			};
		}
	}

	function reject(eventId: string) {
		accepted = accepted.filter((id) => id !== eventId);
		if (director) {
			director = {
				...director,
				acceptedEventIds: accepted,
				events: director.events.map((event) =>
					event.id === eventId ? { ...event, status: 'REJECTED' as const } : event,
				),
				planHash: null,
			};
		}
	}

	function applyMotionPreference() {
		if (!director || !reduceMotion) return;
		accepted = accepted.filter(
			(id) => director?.events.find((event) => event.id === id)?.type !== 'VHS_STATIC',
		);
		director = {
			...director,
			acceptedEventIds: accepted,
			events: director.events.map((event) =>
				event.type === 'VHS_STATIC' && accepted.includes(event.id)
					? { ...event, status: 'PROPOSED' as const }
					: event,
			),
			planHash: null,
		};
	}

	function updatePoint(index: number, field: 'timeMs' | 'tension', raw: string) {
		if (!director) return;
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		const points = director.points
			.map((point, position) =>
				position === index
					? {
							...point,
							[field]:
								field === 'timeMs'
									? Math.max(0, Math.min(data.plan?.durationMs ?? 150_000, Math.round(value)))
									: Math.max(0, Math.min(100, Math.round(value))),
						}
					: point,
			)
			.sort((left, right) => left.timeMs - right.timeMs);
		director = { ...director, points, planHash: null };
	}

	function addPoint() {
		if (!director) return;
		const duration = data.plan?.durationMs ?? 120_000;
		const ordered = [...director.points].sort((left, right) => left.timeMs - right.timeMs);
		const boundaries = [0, ...ordered.map((point) => point.timeMs), duration];
		let insertAt = -1;
		let widest = 0;
		for (let index = 1; index < boundaries.length; index += 1) {
			const gap = boundaries[index]! - boundaries[index - 1]!;
			if (gap > widest) {
				widest = gap;
				insertAt = Math.round(boundaries[index - 1]! + gap / 2);
			}
		}
		if (insertAt <= 0 || insertAt >= duration || widest < 500) return;
		director = {
			...director,
			points: [...ordered, { timeMs: insertAt, tension: 50 }].sort(
				(left, right) => left.timeMs - right.timeMs,
			),
			planHash: null,
		};
	}

	function maxEventDuration(event: DirectorEvent): number {
		if (event.type === 'VHS_STATIC') return 700;
		if (event.type === 'SILENCE_BEFORE_REVEAL') return 2_500;
		return 8_000;
	}

	function removePoint(index: number) {
		if (!director || director.points.length <= 2) return;
		director = {
			...director,
			points: director.points.filter((_, position) => position !== index),
			planHash: null,
		};
	}

	function clampEvent(index: number, field: 'startMs' | 'durationMs' | 'intensity', raw: string) {
		if (!director) return;
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		const duration = data.plan?.durationMs ?? 120_000;
		director = {
			...director,
			events: director.events.map((event, position) => {
				if (position !== index) return event;
				if (field === 'intensity')
					return {
						...event,
						status: 'ADJUSTED' as const,
						intensity: Math.max(1, Math.min(5, Math.round(value))),
					};
				const maxDuration = maxEventDuration(event);
				if (field === 'durationMs')
					return {
						...event,
						status: 'ADJUSTED' as const,
						durationMs: Math.max(
							100,
							Math.min(Math.round(value), maxDuration, duration - event.startMs),
						),
					};
				const startMs = Math.max(0, Math.min(duration - 100, Math.round(value)));
				return {
					...event,
					status: 'ADJUSTED' as const,
					startMs,
					durationMs: Math.min(maxDuration, event.durationMs, duration - startMs),
				};
			}),
			planHash: null,
		};
	}
</script>

<svelte:head><title>Diretor | DIF Studio</title></svelte:head>

<section class="page-head">
	<p class="eyebrow">DIREÇÃO</p>
	<h1>Diretor de edição</h1>
	<p class="lede">
		Curva de tensão determinística, eventos explicados e revisão humana. O modo offline não chama
		IA; sugestões Gemini são opcionais, validadas e nunca viram comandos.
	</p>
</section>

<form class="episode-picker" method="GET">
	<label for="director-episode">Episódio</label>
	<select
		id="director-episode"
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
{#if form?.warning}<p class="notice warning" role="status">{form.warning}</p>{/if}
{#if form?.success && form.version}
	<p class="notice success" role="status">Versão {form.version} salva.</p>
{/if}

{#if !data.plan}
	<p class="empty">Salve a timeline antes de usar o diretor.</p>
{:else}
	<section class="director-controls">
		<div>
			<span class="meta-label">Plano v{data.plan.version} · {data.plan.status}</span>
			<p class="hint">
				{data.plan.durationMs} ms · {data.aiConfigured
					? 'Gemini opcional disponível'
					: 'Gemini não configurado; modo offline'}
			</p>
		</div>
		<form method="POST" action="?/generate" class="generate-form">
			<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
			<label
				>Preset
				<select name="preset" bind:value={preset}>
					<option value="slow-burn">Slow burn</option>
					<option value="reveal">Reveal</option>
					<option value="found-footage">Found footage</option>
				</select>
			</label>
			<label>Seed <input type="number" name="seed" min="0" bind:value={seed} /></label>
			<label class="check"
				><input type="checkbox" name="suspense" bind:checked={suspense} /> Flags de suspense</label
			>
			<label
				>Modo
				<select name="mode" bind:value={mode}>
					<option value="offline">Offline determinístico</option>
					<option value="gemini" disabled={!data.aiConfigured}>Gemini (opt-in)</option>
				</select>
			</label>
			<button class="primary" type="submit">Gerar proposta</button>
		</form>
		<p class="hint">
			Offline é o padrão e não chama IA. Slow burn limita a 3 eventos; reveal a 6. Glitch VHS fica
			em ≤700 ms por proteção fotossensível. Gemini, quando escolhido, tem timeout de 20 s e teto de
			2.048 tokens de saída, sem fallback pago.
		</p>
	</section>

	{#if director}
		<section class="curve" aria-label="Curva de tensão">
			<div class="curve-head">
				<div>
					<h2>Curva de tensão</h2>
					<p class="meta-label">
						{director.source} · preset {director.preset} · seed {director.seed} · {director.points
							.length}
						pontos · {director.planHash
							? `hash ${director.planHash.slice(0, 12)}…`
							: 'hash recalculado ao aplicar'}
					</p>
				</div>
				{#if form?.estimatedTokens}
					<p class="meta-label">~{form.estimatedTokens} tokens estimados</p>
				{/if}
			</div>
			<svg viewBox="0 0 100 100" role="img" aria-label="Curva de tensão do episódio">
				<line x1="0" y1="100" x2="100" y2="100" class="axis"></line>
				{#if data.director}
					<path d={pathFor(data.director.points, data.plan.durationMs)} class="before"></path>
				{/if}
				<path d={pathFor(director.points, data.plan.durationMs)} class="current"></path>
				{#each director.markers as marker (marker.phase + marker.timeMs)}
					<line
						x1={(marker.timeMs / data.plan.durationMs) * 100}
						y1="0"
						x2={(marker.timeMs / data.plan.durationMs) * 100}
						y2="100"
						class="marker"
					></line>
					<text
						x={Math.min(92, (marker.timeMs / data.plan.durationMs) * 100 + 1)}
						y="8"
						class="marker-label">{phaseLabels[marker.phase]}</text
					>
				{/each}
			</svg>
			<div class="legend">
				<span><i class="line-current"></i> proposta</span>
				{#if data.director}<span><i class="line-before"></i> versão atual</span>{/if}
			</div>
			<p class="meta-label">
				Pontos: {director.points
					.map((point) => `${(point.timeMs / 1_000).toFixed(1)} s = ${point.tension}`)
					.join(' · ')}
			</p>
			<div class="points">
				{#each director.points as point, index (index)}
					<label
						>Ponto {index + 1} tempo (ms)
						<input
							type="number"
							min="0"
							max={data.plan.durationMs}
							value={point.timeMs}
							onchange={(event) => updatePoint(index, 'timeMs', event.currentTarget.value)}
						/>
					</label>
					<label
						>Tensão 0–100
						<input
							type="number"
							min="0"
							max="100"
							value={point.tension}
							onchange={(event) => updatePoint(index, 'tension', event.currentTarget.value)}
						/>
					</label>
					<button
						type="button"
						class="link"
						aria-label={`Remover ponto ${index + 1} de tensão`}
						onclick={() => removePoint(index)}>Remover</button
					>
				{/each}
				<button type="button" onclick={addPoint}>Adicionar ponto</button>
			</div>
		</section>

		<section class="events" aria-label="Eventos propostos">
			<h2>Eventos explicados</h2>
			<p class="hint">
				Aceite, ajuste ou rejeite cada evento. A aprovação do plano continua na timeline.
			</p>
			<ol>
				{#each director.events as event, index (event.id)}
					<li class:accepted={accepted.includes(event.id)}>
						<header>
							<label class="check">
								<input
									type="checkbox"
									checked={accepted.includes(event.id)}
									disabled={reduceMotion && event.type === 'VHS_STATIC'}
									onchange={(changeEvent) => toggle(event.id, changeEvent.currentTarget.checked)}
								/>
								{eventLabels[event.type]}
							</label>
							<button
								type="button"
								class="link"
								aria-label={`Rejeitar ${eventLabels[event.type]} em ${(event.startMs / 1_000).toFixed(1)} segundos`}
								onclick={() => reject(event.id)}>Rejeitar</button
							>
						</header>
						<p class="reason">{event.reason}</p>
						{#if event.type === 'PHRASE_HIGHLIGHT'}
							<p class="hint">
								Informativo nesta versão: registra a frase para revisão, sem alterar o render.
							</p>
						{/if}
						<div class="event-grid">
							<label
								>Início (ms)
								<input
									type="number"
									min="0"
									max={data.plan.durationMs - 100}
									value={event.startMs}
									onchange={(changeEvent) =>
										clampEvent(index, 'startMs', changeEvent.currentTarget.value)}
								/>
							</label>
							<label
								>Duração (ms)
								<input
									type="number"
									min="100"
									max={maxEventDuration(event)}
									value={event.durationMs}
									onchange={(changeEvent) =>
										clampEvent(index, 'durationMs', changeEvent.currentTarget.value)}
								/>
							</label>
							<label
								>Intensidade
								<input
									type="number"
									min="1"
									max="5"
									value={event.intensity}
									onchange={(changeEvent) =>
										clampEvent(index, 'intensity', changeEvent.currentTarget.value)}
								/>
							</label>
							<span class="meta-label"
								>{event.status} · início {(event.startMs / 1_000).toFixed(1)} s · {event.assetId
									? 'asset licenciado'
									: 'sem asset'}</span
							>
						</div>
					</li>
				{/each}
			</ol>
			{#if director.cta}
				<p class="cta">
					CTAs referenciados: <strong>{director.cta.text}</strong>
					{#if director.cta.references.length}
						· {director.cta.references.join(' / ')}
					{/if}
				</p>
			{/if}
		</section>

		<div class="actions">
			{#if data.captionsApproved}
				<p class="notice warning" role="status">
					Há legendas aprovadas nesta versão. Aplicar ou reverter cria uma nova versão e exige
					reaprovar/regerar as legendas antes do render.
				</p>
			{/if}
			<p class="hint">
				Aplicar ou reverter cria uma nova versão DRAFT. Legendas aprovadas ficam presas à versão
				anterior; reaprove-as na tela de legendas antes de renderizar. A CTA entra pelas legendas.
			</p>
			<label class="check motion-control">
				<input type="checkbox" bind:checked={reduceMotion} onchange={applyMotionPreference} /> Reduzir
				movimento (remove o glitch VHS)
			</label>
			<form method="POST" action="?/apply">
				<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
				<input type="hidden" name="expectedVersion" value={data.plan.version} />
				<input
					type="hidden"
					name="director"
					value={JSON.stringify({ ...director, acceptedEventIds: accepted, planHash: null })}
				/>
				<label>Nota da versão <input name="changeNote" maxlength="500" /></label>
				<button class="primary" type="submit">Aplicar direção selecionada</button>
			</form>
			{#if data.director}
				<form method="POST" action="?/revert">
					<input type="hidden" name="episodeId" value={data.selectedEpisode.id} />
					<input type="hidden" name="expectedVersion" value={data.plan.version} />
					<button type="submit">Reverter apenas direção</button>
				</form>
			{/if}
			<a href={resolve('/app/timeline')}>Voltar à timeline</a>
		</div>
	{/if}

	{#if data.versions.length}
		<section class="history" aria-label="Histórico do plano">
			<h2>Histórico</h2>
			<ul>
				{#each data.versions.slice(0, 8) as version (version.id)}
					<li><strong>v{version.version}</strong> {version.change_note || 'Sem nota'}</li>
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
	.lede,
	.hint,
	.reason,
	.meta-label {
		color: var(--muted);
	}
	.lede {
		max-width: 70ch;
	}
	.episode-picker,
	.director-controls,
	.generate-form,
	.actions,
	.actions form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-block: 1rem;
	}
	.director-controls {
		justify-content: space-between;
	}
	select,
	input {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 0.4rem;
		color: var(--ink);
		padding: 0.55rem 0.7rem;
	}
	.curve,
	.events,
	.history {
		margin-block: 1.5rem;
		border: 1px solid var(--line);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--surface);
	}
	.curve-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	svg {
		width: 100%;
		height: 260px;
		background: #0c0c0c;
		border-radius: 0.5rem;
		margin-block: 0.75rem;
	}
	.axis {
		stroke: #333;
		stroke-width: 0.4;
	}
	.current {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.2;
	}
	.before {
		fill: none;
		stroke: #777;
		stroke-width: 0.8;
		stroke-dasharray: 2 2;
	}
	.marker {
		stroke: #5c5c5c;
		stroke-width: 0.25;
		stroke-dasharray: 1 2;
	}
	.marker-label {
		fill: #aaa;
		font-size: 2.6px;
	}
	.legend {
		display: flex;
		gap: 1rem;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.legend i {
		display: inline-block;
		width: 1.4rem;
		height: 0.2rem;
		margin-inline-end: 0.35rem;
		vertical-align: middle;
	}
	.line-current {
		background: var(--accent);
	}
	.line-before {
		background: #777;
	}
	.points {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
		align-items: end;
		margin-block-start: 0.75rem;
	}
	.points label,
	.event-grid label,
	.actions label {
		display: grid;
		gap: 0.2rem;
		color: var(--muted);
		font-size: 0.78rem;
	}
	.actions .hint,
	.actions .notice {
		flex-basis: 100%;
	}
	.events ol {
		display: grid;
		gap: 0.65rem;
		list-style: none;
		padding: 0;
	}
	.events li {
		border: 1px solid var(--line);
		border-radius: 0.65rem;
		padding: 0.75rem;
	}
	.events li.accepted {
		border-color: var(--accent);
	}
	.events header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: center;
	}
	.event-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.5rem;
		align-items: end;
	}
	.check {
		display: flex;
		flex-direction: row;
		gap: 0.45rem;
		align-items: center;
	}
	.cta {
		border-block-start: 1px solid var(--line);
		padding-block-start: 0.75rem;
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
	.notice {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		margin-block: 0.75rem;
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
	.notice.warning {
		border: 1px solid #b58a2a;
		color: #ffe4a3;
		background: #2a210f;
	}
	.empty {
		color: var(--muted);
	}
	.history ul {
		display: grid;
		gap: 0.35rem;
		padding: 0;
		list-style: none;
	}
	@media (max-width: 640px) {
		.events header {
			flex-direction: column;
			align-items: start;
		}
	}
</style>
