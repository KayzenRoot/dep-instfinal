import type { CaptionTrack } from '#lib/schemas/captions.js';
import type { HookVariantDraft, HookVariantKey } from '#lib/schemas/hook-variants.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
import { moveClips } from './video-edit-plan.js';

const OPENING_WINDOW_MS = 12_000;
const SUSPENSE_WORDS = [
	'segredo',
	'verdade',
	'desapareceu',
	'silêncio',
	'silencio',
	'medo',
	'última',
	'ultima',
	'ninguém',
	'ninguem',
	'sozinho',
	'voz',
	'porta',
	'arquivo',
	'quem',
	'por quê',
	'porque',
];

export interface HookVariantWithClip extends HookVariantDraft {
	openingTimelineStartMs: number;
	openingTimelineEndMs: number;
}

export interface HookLabResult {
	variants: HookVariantWithClip[];
	limitations: string[];
}

function clipTension(plan: VideoEditPlan, clipStart: number, clipEnd: number): number {
	const points = plan.director?.points ?? [];
	const relevant = points.filter((point) => point.timeMs >= clipStart && point.timeMs < clipEnd);
	if (!relevant.length) return 0;
	return Math.max(...relevant.map((point) => point.tension));
}

function clipEvents(plan: VideoEditPlan, clipStart: number, clipEnd: number): string[] {
	const labels: string[] = [];
	for (const event of plan.director?.events ?? []) {
		if (!plan.director?.acceptedEventIds.includes(event.id)) continue;
		if (event.startMs < clipEnd && event.startMs + event.durationMs > clipStart)
			labels.push(event.type);
	}
	for (const event of plan.audio?.events ?? []) {
		if (event.startMs < clipEnd && event.startMs + event.durationMs > clipStart)
			labels.push(`AUDIO_${event.kind}`);
	}
	return [...new Set(labels)];
}

function captionScore(captions: CaptionTrack | null, clipStart: number, clipEnd: number): number {
	const cues = captions?.cues ?? [];
	let score = 0;
	for (const cue of cues) {
		if (cue.endMs <= clipStart || cue.startMs >= clipEnd) continue;
		if (cue.text.includes('?')) score += 12;
		for (const word of SUSPENSE_WORDS) if (cue.text.toLowerCase().includes(word)) score += 4;
	}
	return Math.min(30, score);
}

function previewStart(plan: VideoEditPlan, clip: VideoEditPlan['clips'][number]): number {
	return clip.timelineStartMs;
}

function previewEnd(clip: VideoEditPlan['clips'][number]): number {
	return Math.min(clip.timelineEndMs, clip.timelineStartMs + OPENING_WINDOW_MS);
}
function variantFor(
	plan: VideoEditPlan,
	clip: VideoEditPlan['clips'][number],
	variantKey: HookVariantKey,
	label: string,
	objective: HookVariantDraft['objective'],
	premise: string,
	reasons: string[],
	score: number,
): HookVariantWithClip {
	const clipIndex = plan.clips.findIndex((candidate) => candidate.id === clip.id);
	return {
		variantKey,
		label,
		objective,
		openingClipId: clip.id,
		openingAssetId: clip.assetId,
		openingClipIndex: clipIndex,
		openingStartMs: clip.sourceInMs,
		openingEndMs: Math.min(
			clip.sourceOutMs,
			clip.sourceInMs + (previewEnd(clip) - previewStart(plan, clip)),
		),
		premise,
		score: Math.max(0, Math.min(95, Math.round(score))),
		reasons,
		openingTimelineStartMs: previewStart(plan, clip),
		openingTimelineEndMs: previewEnd(clip),
	};
}

export function buildHookVariants(input: {
	plan: VideoEditPlan;
	captions: CaptionTrack | null;
}): HookLabResult {
	const { plan, captions } = input;
	const clips = [...plan.clips].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
	const limitations: string[] = [];
	const variants: HookVariantWithClip[] = [];
	if (clips.length < 2) {
		return {
			variants: [],
			limitations: [
				'São necessários pelo menos dois clipes READY para montar aberturas distintas.',
			],
		};
	}
	if (clips.length < 3)
		limitations.push('Com dois clipes, o laboratório oferece no máximo duas aberturas.');

	const used = new Set<string>();
	const tensionSorted = [...clips].sort((left, right) => {
		const leftTension = clipTension(plan, left.timelineStartMs, left.timelineEndMs);
		const rightTension = clipTension(plan, right.timelineStartMs, right.timelineEndMs);
		return rightTension - leftTension;
	});
	const cold =
		tensionSorted.find(
			(clip) => plan.clips.findIndex((candidate) => candidate.id === clip.id) > 0,
		) ?? clips[1]!;
	used.add(cold.id);
	const coldTension = clipTension(plan, cold.timelineStartMs, cold.timelineEndMs);
	variants.push(
		variantFor(
			plan,
			cold,
			'cold_open',
			'Cold open visual',
			'MYSTERY',
			'Abre com a cena de maior tensão do plano, sem revelar o desfecho.',
			[
				coldTension
					? `Cena com tensão ${coldTension}/100 na curva do diretor.`
					: 'Sem curva de tensão; usa a cena intermediária como abertura visual.',
				'A narração, as legendas e a CTA permanecem na mesma linha do tempo.',
			],
			50 + coldTension * 0.3,
		),
	);

	const captionRanked = [...clips]
		.filter((clip) => !used.has(clip.id))
		.map((clip) => ({
			clip,
			score: captionScore(captions, clip.timelineStartMs, clip.timelineEndMs),
		}))
		.filter((candidate) => candidate.score > 0)
		.sort((left, right) => right.score - left.score);
	if (captionRanked.length) {
		const best = captionRanked[0]!;
		used.add(best.clip.id);
		variants.push(
			variantFor(
				plan,
				best.clip,
				'intriguing_line',
				'Fala intrigante',
				'REVEAL',
				'Abre com o trecho de fala mais interrogativo disponível, sem antecipar a resposta.',
				[
					`Legenda com pergunta/palavra de suspense (${best.score} pontos).`,
					'Texto vem da track aprovada; nenhuma fala nova é gerada.',
				],
				45 + best.score,
			),
		);
	} else {
		limitations.push('Sem legendas interrogativas suficientes para a variante de fala.');
	}

	const soundRanked = [...clips]
		.filter((clip) => !used.has(clip.id))
		.map((clip) => ({
			clip,
			events: clipEvents(plan, clip.timelineStartMs, clip.timelineEndMs),
		}))
		.filter((candidate) => candidate.events.length > 0)
		.sort((left, right) => right.events.length - left.events.length);
	if (soundRanked.length) {
		const best = soundRanked[0]!;
		used.add(best.clip.id);
		variants.push(
			variantFor(
				plan,
				best.clip,
				'sound_entry',
				'Entrada pelo áudio',
				'SOUND',
				'Abre com a cena que carrega o efeito sonoro aprovado do diretor ou da biblioteca.',
				[
					`Eventos aceitos: ${best.events.slice(0, 4).join(', ')}.`,
					'Áudio e legendas continuam sincronizados à linha do tempo original.',
				],
				45 + Math.min(20, best.events.length * 5),
			),
		);
	} else {
		limitations.push('Sem evento sonoro aceito em clipe disponível para a entrada por áudio.');
	}

	limitations.push(
		'O score é heurístico e transparente; não mede retenção nem garante desempenho.',
	);
	return { variants, limitations };
}

export function applyHookVariant(plan: VideoEditPlan, openingClipId: string): VideoEditPlan {
	const index = plan.clips.findIndex((clip) => clip.id === openingClipId);
	if (index <= 0) return { ...plan, clips: plan.clips.map((clip) => ({ ...clip })) };
	return { ...plan, clips: moveClips(plan.clips, index, 0) };
}
