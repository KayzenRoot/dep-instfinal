import { createHash } from 'node:crypto';
import type { AudioAsset, EditPlanAudioEvent } from '#lib/schemas/audio-library.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
import type {
	DirectorEvent,
	DirectorEventType,
	DirectorPhase,
	DirectorPreset,
	EditDirectorPlan,
	TensionMarker,
	TensionPoint,
} from '#lib/schemas/edit-director.js';

export class EditDirectorError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'EditDirectorError';
	}
}

export interface DirectorScene {
	id: string;
	sceneIndex: number;
	startMs: number;
	endMs: number;
	narration: string;
	visualDescription: string;
	audioNotes: string;
}

export interface DirectorInput {
	episodeId: string;
	durationMs: number;
	seed: number;
	preset: DirectorPreset;
	suspense: boolean;
	scenes: DirectorScene[];
	characters: string[];
	location: string | null;
	audioAssets: AudioAsset[];
	choices: Array<{ optionKey: string; label: string }>;
}

const PRESET_POINTS: Record<Exclude<DirectorPreset, 'custom'>, Array<[number, number]>> = {
	'slow-burn': [
		[0, 12],
		[0.22, 24],
		[0.48, 42],
		[0.65, 30],
		[0.84, 62],
		[1, 78],
	],
	reveal: [
		[0, 8],
		[0.2, 34],
		[0.44, 58],
		[0.62, 38],
		[0.8, 88],
		[1, 96],
	],
	'found-footage': [
		[0, 22],
		[0.16, 52],
		[0.36, 34],
		[0.56, 74],
		[0.76, 58],
		[1, 100],
	],
};

const PRESET_EVENT_CAP: Record<Exclude<DirectorPreset, 'custom'>, number> = {
	'slow-burn': 3,
	reveal: 6,
	'found-footage': 5,
};

function seeded(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function canonicalJson(value: unknown): string {
	const sort = (entry: unknown): unknown => {
		if (Array.isArray(entry)) return entry.map(sort);
		if (entry && typeof entry === 'object') {
			return Object.fromEntries(
				Object.entries(entry as Record<string, unknown>)
					.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
					.map(([key, child]) => [key, sort(child)]),
			);
		}
		return entry;
	};
	return JSON.stringify(sort(value));
}

export function directorPlanHash(director: EditDirectorPlan): string {
	const payload: Partial<EditDirectorPlan> = { ...director };
	delete payload.planHash;
	delete payload.generatedAt;
	return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

export function tensionAt(points: TensionPoint[], timeMs: number): number {
	if (!points.length) return 0;
	if (timeMs <= points[0]!.timeMs) return points[0]!.tension;
	const last = points.at(-1)!;
	if (timeMs >= last.timeMs) return last.tension;
	for (let index = 1; index < points.length; index += 1) {
		const left = points[index - 1]!;
		const right = points[index]!;
		if (timeMs <= right.timeMs) {
			const ratio = (timeMs - left.timeMs) / Math.max(1, right.timeMs - left.timeMs);
			return Math.round(left.tension + (right.tension - left.tension) * ratio);
		}
	}
	return last.tension;
}

/**
 * Maps the tension curve onto the allowlisted render parameters: SFX gain and
 * the duration of VHS/silence windows. Timing itself is never moved, so
 * narration/captions stay in sync with the canonical timeline.
 */
export function directorEventIntensity(director: EditDirectorPlan, event: DirectorEvent): number {
	const local = tensionAt(director.points, event.startMs);
	return clamp(Math.round(event.intensity + (local - 50) / 25), 1, 5);
}

export function directorEventDuration(director: EditDirectorPlan, event: DirectorEvent): number {
	const local = tensionAt(director.points, event.startMs);
	const factor = 0.6 + local / 125;
	if (event.type === 'VHS_STATIC') return clamp(Math.round(event.durationMs * factor), 200, 700);
	if (event.type === 'SILENCE_BEFORE_REVEAL')
		return clamp(Math.round(event.durationMs * factor), 800, 2_500);
	return event.durationMs;
}

/** Ambient/music gain offset derived from the curve, capped at ±3 dB. */
export function directorAmbientGain(director: EditDirectorPlan, timeMs: number): number {
	return clamp(Math.round((tensionAt(director.points, timeMs) - 50) / 16), -3, 3);
}

function revealSceneIndex(input: DirectorInput): number {
	const keywords = /revel|descobr|abriu|porta|surgiu|verdade|corpo|fita|voz/i;
	const candidate = input.scenes.find((scene) => keywords.test(scene.narration));
	return candidate?.sceneIndex ?? Math.max(1, Math.ceil(input.scenes.length * 0.7));
}

function sceneAtTime(input: DirectorInput, timeMs: number): DirectorScene | null {
	return (
		input.scenes.find((scene) => timeMs >= scene.startMs && timeMs < scene.endMs) ??
		input.scenes.at(-1) ??
		null
	);
}

function deterministicEventId(
	seed: number,
	index: number,
	event: Omit<DirectorEvent, 'id' | 'status'>,
): string {
	const digest = createHash('sha256')
		.update(`${seed}:${index}:${event.type}:${event.startMs}:${event.durationMs}`)
		.digest('hex');
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function addEvent(
	events: DirectorEvent[],
	event: Omit<DirectorEvent, 'id' | 'status'>,
	seed: number,
): void {
	events.push({
		...event,
		id: deterministicEventId(seed, events.length, event),
		status: 'PROPOSED',
	});
}

function marker(
	timeMs: number,
	phase: DirectorPhase,
	label: string,
	rationale: string,
): TensionMarker {
	return { timeMs, phase, label, rationale };
}

function chooseAsset(
	input: DirectorInput,
	predicate: (asset: AudioAsset) => boolean,
): AudioAsset | null {
	return (
		input.audioAssets.find(
			(asset) =>
				asset.licenseStatus === 'VERIFIED' &&
				asset.commercialAllowed &&
				asset.socialAllowed &&
				predicate(asset),
		) ?? null
	);
}

export function buildDirectorPlan(input: DirectorInput): EditDirectorPlan {
	if (!Number.isInteger(input.durationMs) || input.durationMs <= 0)
		throw new EditDirectorError('DIRECTOR_DURATION_INVALID', 'Duração do episódio inválida.');
	if (!input.scenes.length)
		throw new EditDirectorError('DIRECTOR_SCENES_EMPTY', 'O episódio não tem cenas.');
	const preset = input.preset === 'custom' ? 'reveal' : input.preset;
	const random = seeded(input.seed);
	const duration = input.durationMs;
	const base = PRESET_POINTS[preset];
	const points: TensionPoint[] = base.map(([ratio, tension], index) => {
		const jitter = index === 0 || index === base.length - 1 ? 0 : Math.round((random() - 0.5) * 8);
		return {
			timeMs: clamp(Math.round(duration * ratio), 0, duration),
			tension: clamp(tension + (input.suspense ? 6 : 0) + jitter, 0, 100),
		};
	});
	const revealScene = revealSceneIndex(input);
	const revealSceneData =
		input.scenes.find((scene) => scene.sceneIndex === revealScene) ?? input.scenes.at(-1)!;
	const revealMs = clamp(
		Math.round(revealSceneData.startMs + (revealSceneData.endMs - revealSceneData.startMs) * 0.58),
		1_000,
		Math.max(1_000, duration - 6_000),
	);
	const climaxMs = clamp(Math.round(duration * 0.8), revealMs + 500, duration - 3_000);
	const markers: TensionMarker[] = [
		marker(0, 'HOOK', 'Hook', 'Abre com a pergunta dramática do episódio.'),
		marker(Math.round(duration * 0.22), 'BUILDUP', 'Construção', 'Sobe a pressão sem revelar.'),
		marker(Math.round(duration * 0.48), 'RELIEF', 'Alívio', 'Dá respiro antes da virada.'),
		marker(revealMs, 'REVEAL', 'Revelação', 'A cena de revelação ancora a virada.'),
		marker(climaxMs, 'CLIMAX', 'Clímax', 'O pico de tensão vai ao impacto.'),
		marker(
			Math.max(0, duration - 4_000),
			'CTA',
			'CTA',
			'Fecha com o convite sem inventar escolha.',
		),
	];
	const events: DirectorEvent[] = [];
	const cap = PRESET_EVENT_CAP[preset];
	addEvent(
		events,
		{
			type: 'SILENCE_BEFORE_REVEAL',
			startMs: Math.max(0, revealMs - 2_500),
			durationMs: 1_500,
			intensity: 5,
			reason: 'Pausa a ambiência imediatamente antes da revelação.',
			assetId: null,
			cueId: null,
		},
		input.seed,
	);
	const door = chooseAsset(input, (asset) => asset.tags.includes('porta'));
	if (door && events.length < cap)
		addEvent(
			events,
			{
				type: 'DOOR_CREAK',
				startMs: Math.max(0, revealMs - 1_200),
				durationMs: Math.min(900, door.durationMs),
				intensity: 4,
				reason: 'Porta range no instante que antecede a revelação.',
				assetId: door.id,
				cueId: null,
			},
			input.seed,
		);
	const impact = chooseAsset(input, (asset) => asset.tags.includes('impacto'));
	if (impact && events.length < cap)
		addEvent(
			events,
			{
				type: 'SFX_ACCENT',
				startMs: Math.max(0, climaxMs - 400),
				durationMs: Math.min(1_200, impact.durationMs),
				intensity: 5,
				reason: 'Impacto curto no clímax, alinhado ao pico da curva.',
				assetId: impact.id,
				cueId: null,
			},
			input.seed,
		);
	if (events.length < cap)
		addEvent(
			events,
			{
				type: 'VHS_STATIC',
				startMs: Math.max(0, climaxMs - 250),
				durationMs: preset === 'found-footage' ? 700 : preset === 'reveal' ? 450 : 300,
				intensity: preset === 'found-footage' ? 5 : preset === 'reveal' ? 4 : 2,
				reason: 'Glitch curto marca a virada sem cobrir a fala.',
				assetId: null,
				cueId: null,
			},
			input.seed,
		);
	const phraseScene =
		input.scenes.find((scene) => scene.sceneIndex === Math.max(1, revealScene - 1)) ??
		sceneAtTime(input, Math.round(duration * 0.3));
	if (phraseScene && events.length < cap)
		addEvent(
			events,
			{
				type: 'PHRASE_HIGHLIGHT',
				startMs: phraseScene.startMs,
				durationMs: Math.min(3_000, phraseScene.endMs - phraseScene.startMs),
				intensity: 3,
				reason: `Destaca a frase de tensão em “${phraseScene.narration.slice(0, 80) || phraseScene.visualDescription.slice(0, 80) || 'cena'}”.`,
				assetId: null,
				cueId: null,
			},
			input.seed,
		);
	const ctaText = input.choices.length
		? `Qual caminho? ${input.choices.map((choice) => choice.label).join(' ou ')}.`
		: 'Continue a história no próximo episódio.';
	addEvent(
		events,
		{
			type: 'CTA_CARD',
			startMs: Math.max(0, duration - 4_000),
			durationMs: 3_000,
			intensity: 2,
			reason: 'CTA referencia os caminhos já existentes, sem inventar resultado.',
			assetId: null,
			cueId: null,
		},
		input.seed,
	);
	const cta =
		input.choices.length >= 2
			? {
					text: ctaText,
					references: input.choices.slice(0, 2).map((choice) => choice.label),
				}
			: { text: ctaText, references: [] };
	const draft: EditDirectorPlan = {
		schemaVersion: 1,
		source: 'OFFLINE',
		preset,
		seed: input.seed,
		reviewStatus: 'DRAFT',
		generatedAt: new Date().toISOString(),
		points,
		markers,
		events: events.slice(0, cap + 1),
		cta,
		previousCta: null,
		acceptedEventIds: [],
		planHash: null,
		note: '',
	};
	return { ...draft, planHash: directorPlanHash(draft) };
}

export function acceptedDirectorEvents(
	director: EditDirectorPlan | undefined,
	type?: DirectorEventType,
): DirectorEvent[] {
	if (!director) return [];
	return director.events
		.filter(
			(event) => director.acceptedEventIds.includes(event.id) && (!type || event.type === type),
		)
		.map((event) => ({
			...event,
			intensity: directorEventIntensity(director, event),
			durationMs: directorEventDuration(director, event),
		}));
}

export function applyDirectorToPlan(input: {
	plan: VideoEditPlan;
	director: EditDirectorPlan;
	assets: AudioAsset[];
	acceptedEventIds: string[];
}): VideoEditPlan {
	const accepted = new Set(input.acceptedEventIds);
	const eventIds = new Set(input.director.events.map((event) => event.id));
	for (const eventId of accepted)
		if (!eventIds.has(eventId))
			throw new EditDirectorError(
				'DIRECTOR_EVENT_UNKNOWN',
				'O aceite aponta para um evento que não existe na proposta.',
			);
	const events = input.director.events.map((event) => ({
		...event,
		status: accepted.has(event.id)
			? ('ACCEPTED' as const)
			: event.status === 'REJECTED'
				? ('REJECTED' as const)
				: ('PROPOSED' as const),
	}));
	const director: EditDirectorPlan = {
		...input.director,
		reviewStatus: 'APPLIED',
		events,
		previousCta: input.plan.director?.previousCta ?? input.plan.cta ?? null,
		acceptedEventIds: [...accepted],
	};
	const audioAssets = new Map(input.assets.map((asset) => [asset.id, asset]));
	const audioEvents = (input.plan.audio?.events ?? [])
		.filter((event) => !event.directorEventId)
		.map((event) =>
			event.kind === 'MUSIC' || event.kind === 'AMBIENCE'
				? { ...event, directorGainDb: directorAmbientGain(director, event.startMs) }
				: event,
		);
	for (const event of events) {
		if (!accepted.has(event.id) || !event.assetId) continue;
		if (!['DOOR_CREAK', 'SFX_ACCENT'].includes(event.type)) continue;
		const asset = audioAssets.get(event.assetId);
		if (!asset)
			throw new EditDirectorError(
				'DIRECTOR_ASSET_MISSING',
				'O efeito aceito usa um asset que não está mais na biblioteca.',
			);
		if (asset.licenseStatus !== 'VERIFIED' || !asset.commercialAllowed || !asset.socialAllowed)
			throw new EditDirectorError(
				'DIRECTOR_ASSET_LICENSE',
				'O efeito aceito usa um asset sem licença comercial/social verificada.',
			);
		if (asset.kind !== 'SFX')
			throw new EditDirectorError(
				'DIRECTOR_ASSET_KIND',
				'O efeito aceito exige um asset da categoria SFX.',
			);
		const startMs = clamp(event.startMs, 0, Math.max(0, input.plan.durationMs - 100));
		const audioEvent: EditPlanAudioEvent = {
			id: event.id,
			directorEventId: event.id,
			assetId: asset.id,
			kind: asset.kind,
			startMs,
			durationMs: Math.max(
				100,
				Math.min(event.durationMs, asset.durationMs, input.plan.durationMs - startMs),
			),
			sourceInMs: 0,
			gainDb: clamp(-20 + directorEventIntensity(director, event) * 2, -60, 12),
			fadeInMs: 80,
			fadeOutMs: 250,
			pan: 0,
			distance: 0.3,
			loop: false,
			ducking: false,
			spatialPreset: event.type === 'DOOR_CREAK' ? 'corridor' : 'none',
			spatialMode: event.type === 'DOOR_CREAK' ? 'binaural_simulated' : 'stereo_pan',
		};
		audioEvents.push(audioEvent);
	}
	const ctaEvent = events.find((event) => event.type === 'CTA_CARD' && accepted.has(event.id));
	const ctaStart = ctaEvent
		? clamp(ctaEvent.startMs, 0, Math.max(0, input.plan.durationMs - 300))
		: null;
	const cta =
		ctaEvent && director.cta && ctaStart !== null
			? {
					enabled: true,
					text: director.cta.text,
					startMs: ctaStart,
					endMs: Math.min(
						input.plan.durationMs,
						Math.max(ctaStart + 300, ctaStart + ctaEvent.durationMs),
					),
				}
			: input.plan.cta;
	return {
		...input.plan,
		audio: { ...(input.plan.audio ?? { masterGainDb: 0, events: [] }), events: audioEvents },
		director: { ...director, planHash: directorPlanHash(director) },
		cta,
	};
}

export function resetDirector(plan: VideoEditPlan): VideoEditPlan {
	const audioEvents = (plan.audio?.events ?? [])
		.filter((event) => !event.directorEventId)
		.map((event) => {
			const copy = { ...event };
			delete copy.directorGainDb;
			return copy;
		});
	return {
		...plan,
		audio: plan.audio ? { ...plan.audio, events: audioEvents } : plan.audio,
		director: undefined,
		cta: plan.director ? plan.director.previousCta : plan.cta,
	};
}
