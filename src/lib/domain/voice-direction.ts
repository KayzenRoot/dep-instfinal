import { createHash } from 'node:crypto';
import type { VoiceDirectionPlan, VoiceSegment } from '#lib/schemas/voice-direction.js';

export class VoiceDirectionError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'VoiceDirectionError';
	}
}

export interface VoiceContext {
	episodeId: string;
	episodeRevisionNumber: number | null;
	narrationPtBr: string;
	scenes: Array<{ id: string; sceneIndex: number }>;
}

const TENSE =
	/\b(medo|sombra|grito|silêncio|sangue|porta|escuro|alarme|perigo|morte|voz|sussurr|corre|fuja)\b/i;
const REVEAL = /\b(descobriu|revelou|segredo|verdade|finalmente|então)\b/i;

function splitSentences(text: string): string[] {
	return text
		.replace(/\s+/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
}

function emotionFor(text: string): VoiceSegment['emotion'] {
	if (REVEAL.test(text)) return 'revelation';
	if (TENSE.test(text)) return 'tension';
	return 'neutral';
}

export function narrationTextHash(text: string): string {
	return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

export function buildHeuristicVoicePlan(context: VoiceContext): VoiceDirectionPlan {
	const sentences = splitSentences(context.narrationPtBr);
	if (sentences.length === 0)
		throw new VoiceDirectionError('VOICE_TEXT_EMPTY', 'O episódio não tem narração para dirigir.');
	if (sentences.length > 60)
		throw new VoiceDirectionError(
			'VOICE_TOO_MANY_SEGMENTS',
			'A narração excede 60 sentenças. Divida o texto antes de dirigir.',
		);
	const segments = sentences.map((text, index) => ({
		id: crypto.randomUUID(),
		sceneId: context.scenes[index % Math.max(1, context.scenes.length)]?.id ?? null,
		text,
		emotion: emotionFor(text),
		speed: 1,
		pauseBeforeMs: index === 0 ? 250 : 150,
		pauseAfterMs: 250,
		volumeDb: 0,
		intendedWpm: 145,
		pronunciation: '',
		variant: 'default',
	}));
	return {
		schemaVersion: 1,
		episodeId: context.episodeId,
		episodeRevisionNumber: context.episodeRevisionNumber,
		takeId: null,
		generatedBy: 'heuristic',
		modelId: null,
		seriesPreset: 'none',
		narrationTextSha256: narrationTextHash(context.narrationPtBr),
		segments,
	};
}

export function validateVoicePlan(
	plan: VoiceDirectionPlan,
	context: VoiceContext,
): VoiceDirectionPlan {
	if (plan.episodeId !== context.episodeId)
		throw new VoiceDirectionError('VOICE_EPISODE_MISMATCH', 'O plano é de outro episódio.');
	if (
		plan.narrationTextSha256 &&
		plan.narrationTextSha256 !== narrationTextHash(context.narrationPtBr)
	)
		throw new VoiceDirectionError(
			'VOICE_PLAN_STALE',
			'A narração do episódio mudou. Reconstrua a direção de voz.',
		);
	const ids = new Set<string>();
	for (const segment of plan.segments) {
		if (ids.has(segment.id))
			throw new VoiceDirectionError('VOICE_SEGMENT_DUPLICATE', 'Segmento duplicado.');
		ids.add(segment.id);
		if (!segment.text.trim())
			throw new VoiceDirectionError('VOICE_TEXT_EMPTY', 'Segmento sem texto.');
		if (segment.sceneId && !context.scenes.some((scene) => scene.id === segment.sceneId))
			throw new VoiceDirectionError(
				'VOICE_SCENE_FOREIGN',
				'Segmento aponta para cena inexistente.',
			);
	}
	return plan;
}

export function estimateSpeechDurationMs(plan: VoiceDirectionPlan): number {
	return plan.segments.reduce((total, segment) => {
		const words = segment.text.trim().split(/\s+/).length;
		const speech = (words / Math.max(80, segment.intendedWpm)) * 60_000;
		return total + speech / segment.speed + segment.pauseBeforeMs + segment.pauseAfterMs;
	}, 0);
}

export function buildTtsText(plan: VoiceDirectionPlan): string {
	return plan.segments.map((segment) => segment.text).join('\n');
}

/**
 * Applies the owner-provided pronunciation map without rewriting the source
 * text stored in the plan. Format: `term=replacement, other=replacement`.
 * Matching is case-insensitive and limited to whole words.
 */
export function applyPronunciation(text: string, pronunciation: string): string {
	if (!pronunciation.trim()) return text;
	let result = text;
	for (const entry of pronunciation.split(',')) {
		const separator = entry.indexOf('=');
		if (separator < 1) continue;
		const term = entry.slice(0, separator).trim();
		const replacement = entry.slice(separator + 1).trim();
		if (!term || !replacement) continue;
		const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		result = result.replace(
			new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
			replacement,
		);
	}
	return result;
}

export interface NarrationTiming {
	segmentId: string;
	index: number;
	sceneId: string | null;
	text: string;
	startMs: number;
	endMs: number;
	speechMs: number;
	pauseBeforeMs: number;
	pauseAfterMs: number;
}

function estimatedSegmentSpeechMs(segment: VoiceSegment): number {
	const words = segment.text.trim().split(/\s+/).filter(Boolean).length;
	return ((words / Math.max(80, segment.intendedWpm)) * 60_000) / segment.speed;
}

/**
 * Deterministic timeline used in reports and by subtitle export. When real
 * per-segment durations are supplied (TTS/ffprobe), they replace the estimate.
 * It is still an estimate unless the caller explicitly measured the audio.
 */
export function buildNarrationTimings(
	plan: VoiceDirectionPlan,
	measuredSpeechMs?: ReadonlyMap<string, number>,
): NarrationTiming[] {
	let cursor = 0;
	return plan.segments.map((segment, index) => {
		const speechMs = Math.max(
			1,
			Math.round(measuredSpeechMs?.get(segment.id) ?? estimatedSegmentSpeechMs(segment)),
		);
		const startMs = cursor + segment.pauseBeforeMs;
		const endMs = startMs + speechMs;
		cursor = endMs + segment.pauseAfterMs;
		return {
			segmentId: segment.id,
			index,
			sceneId: segment.sceneId,
			text: segment.text,
			startMs,
			endMs,
			speechMs,
			pauseBeforeMs: segment.pauseBeforeMs,
			pauseAfterMs: segment.pauseAfterMs,
		};
	});
}

export interface NarrationDurationPolicy {
	narrationMs: number;
	videoMs: number;
	minimumMs: number;
	paddedMs: number;
	trimmedMs: number;
	overflowMs: number;
	underflowMs: number;
	ok: boolean;
}

/**
 * A take may be shorter than the video (trailing silence is added) but it
 * must cover at least half of it. A longer take may only exceed the video by
 * the render tolerance. Both violations are explicit instead of a hidden
 * pad/trim that would silently desynchronize narration and subtitles.
 */
export function narrationDurationPolicy(
	narrationMs: number,
	videoMs: number,
	toleranceMs = 250,
): NarrationDurationPolicy {
	if (
		!Number.isFinite(narrationMs) ||
		narrationMs < 1_000 ||
		!Number.isFinite(videoMs) ||
		videoMs < 1_000
	)
		throw new VoiceDirectionError('VOICE_DURATION_INVALID', 'Duração de áudio ou vídeo inválida.');
	const minimumMs = Math.max(1_000, Math.round(videoMs * 0.5));
	const overflowMs = Math.max(0, narrationMs - videoMs);
	const underflowMs = Math.max(0, minimumMs - narrationMs);
	return {
		narrationMs,
		videoMs,
		minimumMs,
		paddedMs: Math.max(0, videoMs - narrationMs),
		trimmedMs: Math.min(overflowMs, toleranceMs),
		overflowMs: Math.max(0, overflowMs - toleranceMs),
		underflowMs,
		ok: overflowMs <= toleranceMs && underflowMs === 0,
	};
}
