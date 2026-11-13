import { describe, expect, it } from 'vitest';
import {
	applyPronunciation,
	buildHeuristicVoicePlan,
	buildNarrationTimings,
	estimateSpeechDurationMs,
	narrationDurationPolicy,
	validateVoicePlan,
	VoiceDirectionError,
	type VoiceContext,
} from './voice-direction.js';
import type { VoiceDirectionPlan } from '#lib/schemas/voice-direction.js';

const sceneA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sceneB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function context(): VoiceContext {
	return {
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: 3,
		narrationPtBr:
			'A fita chegou antes do desaparecimento. Uma sombra cruzou o corredor. Então ela descobriu o segredo.',
		scenes: [
			{ id: sceneA, sceneIndex: 1 },
			{ id: sceneB, sceneIndex: 2 },
		],
	};
}

function planOf(contextValue: VoiceContext = context()): VoiceDirectionPlan {
	return buildHeuristicVoicePlan(contextValue);
}

describe('voice direction plan', () => {
	it('splits the narration into sentence segments with deterministic emotions', () => {
		const plan = planOf();
		expect(plan.episodeRevisionNumber).toBe(3);
		expect(plan.generatedBy).toBe('heuristic');
		expect(plan.segments).toHaveLength(3);
		expect(plan.segments[0]?.text).toBe('A fita chegou antes do desaparecimento.');
		expect(plan.segments[1]?.emotion).toBe('tension');
		expect(plan.segments[2]?.emotion).toBe('revelation');
		expect(new Set(plan.segments.map((segment) => segment.id)).size).toBe(3);
		expect(plan.segments[0]?.sceneId).toBe(sceneA);
		expect(plan.segments[1]?.sceneId).toBe(sceneB);
	});

	it('rejects empty narration, foreign scenes and duplicate segment ids', () => {
		expect(() => buildHeuristicVoicePlan({ ...context(), narrationPtBr: '   ' })).toThrow(
			VoiceDirectionError,
		);
		const plan = planOf();
		expect(() =>
			validateVoicePlan(
				{
					...plan,
					segments: [{ ...plan.segments[0]!, sceneId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
				},
				context(),
			),
		).toThrow('Segmento aponta para cena inexistente.');
		expect(() =>
			validateVoicePlan(
				{
					...plan,
					segments: [plan.segments[0]!, { ...plan.segments[1]!, id: plan.segments[0]!.id }],
				},
				context(),
			),
		).toThrow('Segmento duplicado.');
		expect(() =>
			validateVoicePlan({ ...plan, episodeId: '22222222-2222-4222-8222-222222222222' }, context()),
		).toThrow('O plano é de outro episódio.');
	});

	it('estimates duration and keeps pauses in the timing report', () => {
		const plan = planOf();
		const timings = buildNarrationTimings(plan);
		expect(timings).toHaveLength(3);
		expect(timings[0]?.startMs).toBe(250);
		expect(timings[1]?.startMs).toBeGreaterThan(timings[0]!.endMs);
		expect(timings[2]?.endMs).toBeGreaterThan(timings[1]!.endMs);
		expect(estimateSpeechDurationMs(plan)).toBeGreaterThan(6_000);
		const measured = new Map([[plan.segments[0]!.id, 2_000]]);
		expect(buildNarrationTimings(plan, measured)[0]?.speechMs).toBe(2_000);
	});

	it('applies pronunciation only to the TTS input, preserving accents', () => {
		expect(applyPronunciation('A fita da Vovó Alice.', 'Alice=Álissi, Vovó=Vovô')).toBe(
			'A fita da Vovô Álissi.',
		);
		expect(applyPronunciation('Aliceado não muda.', 'Alice=Álissi')).toBe('Aliceado não muda.');
		expect(applyPronunciation('Ação e coração.', '')).toBe('Ação e coração.');
	});

	it('pads short takes and fails only on meaningful overflow', () => {
		expect(narrationDurationPolicy(100_000, 120_000)).toMatchObject({
			ok: true,
			paddedMs: 20_000,
			trimmedMs: 0,
			overflowMs: 0,
		});
		expect(narrationDurationPolicy(120_200, 120_000)).toMatchObject({
			ok: true,
			trimmedMs: 200,
			overflowMs: 0,
		});
		expect(narrationDurationPolicy(121_000, 120_000)).toMatchObject({
			ok: false,
			trimmedMs: 250,
			overflowMs: 750,
		});
		expect(() => narrationDurationPolicy(0, 120_000)).toThrow(
			'Duração de áudio ou vídeo inválida.',
		);
	});
});
