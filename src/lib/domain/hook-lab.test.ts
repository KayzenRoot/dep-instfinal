import { describe, expect, it } from 'vitest';
import { buildSceneTimeline } from './timeline.js';
import { buildDefaultEditPlan, type EditPlanContext } from './video-edit-plan.js';
import { applyHookVariant, buildHookVariants } from './hook-lab.js';
import type { CaptionTrack } from '#lib/schemas/captions.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

function context(): EditPlanContext {
	const scenes = buildSceneTimeline(120_000, 8_000).map((scene) => ({
		id: `00000000-0000-4000-8000-${String(scene.index).padStart(12, '0')}`,
		sceneIndex: scene.index,
		startMs: scene.startMs,
		endMs: scene.endMs,
	}));
	return {
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: 1,
		durationMs: 120_000,
		sceneDurationMs: 8_000,
		scenes,
		assets: scenes.map((scene) => ({
			id: `22222222-2222-4222-8222-${String(scene.sceneIndex).padStart(12, '0')}`,
			sceneId: scene.id,
			assetVersion: 1,
			durationMs: 8_000,
		})),
	};
}

function captionTrack(): CaptionTrack {
	return {
		schemaVersion: 1,
		episodeId: '11111111-1111-4111-8111-111111111111',
		planId: '33333333-3333-4333-8333-333333333333',
		planVersion: 1,
		narrationTakeId: null,
		style: 'clean',
		safeZone: 'tiktok',
		source: 'MANUAL',
		scriptSha256: null,
		audioSha256: null,
		alignmentScore: null,
		cues: [
			{
				id: '44444444-4444-4444-8444-444444444444',
				startMs: 16_000,
				endMs: 20_000,
				text: 'Quem entrou no arquivo?',
				words: [],
			},
		],
	};
}

function planWithSignals(): VideoEditPlan {
	const plan = buildDefaultEditPlan(context());
	const eventId = '55555555-5555-4555-8555-555555555555';
	return {
		...plan,
		director: {
			schemaVersion: 1,
			source: 'OFFLINE',
			preset: 'custom',
			seed: 1,
			reviewStatus: 'APPLIED',
			generatedAt: '2026-11-18T00:00:00.000Z',
			points: [
				{ timeMs: 0, tension: 10 },
				{ timeMs: 45_000, tension: 92 },
			],
			markers: [],
			events: [
				{
					id: eventId,
					type: 'VHS_STATIC',
					startMs: 57_000,
					durationMs: 500,
					intensity: 2,
					status: 'ACCEPTED',
					reason: 'Susto aprovado',
				},
			],
			acceptedEventIds: [eventId],
			rejectedEventIds: [],
			notes: [],
		},
	} as unknown as VideoEditPlan;
}

describe('hook lab engine', () => {
	it('builds three distinct, auditable openings from existing material', () => {
		const plan = planWithSignals();
		const result = buildHookVariants({ plan, captions: captionTrack() });
		expect(result.variants.map((variant) => variant.variantKey).sort()).toEqual([
			'cold_open',
			'intriguing_line',
			'sound_entry',
		]);
		expect(new Set(result.variants.map((variant) => variant.openingClipId)).size).toBe(3);
		const cold = result.variants.find((variant) => variant.variantKey === 'cold_open');
		expect(cold?.score).toBeGreaterThan(50);
		expect(cold?.reasons.join(' ')).toContain('tensão');
		const line = result.variants.find((variant) => variant.variantKey === 'intriguing_line');
		expect(line?.reasons.join(' ')).toContain('pergunta');
		const sound = result.variants.find((variant) => variant.variantKey === 'sound_entry');
		expect(sound?.reasons.join(' ')).toContain('VHS_STATIC');
		expect(result.limitations.join(' ')).toContain('heurístico');
	});

	it('applies a variant without duplicating clips or changing totals', () => {
		const plan = planWithSignals();
		const variant = buildHookVariants({ plan, captions: captionTrack() }).variants[0]!;
		const next = applyHookVariant(plan, variant.openingClipId);
		expect(next.clips[0]?.id).toBe(variant.openingClipId);
		expect(next.clips).toHaveLength(plan.clips.length);
		expect(new Set(next.clips.map((clip) => clip.id)).size).toBe(plan.clips.length);
		expect(next.durationMs).toBe(plan.durationMs);
	});

	it('returns fewer variants with honest reasons when material is limited', () => {
		const plan = buildDefaultEditPlan(context());
		const limited = { ...plan, clips: plan.clips.slice(0, 2) } as VideoEditPlan;
		const result = buildHookVariants({ plan: limited, captions: null });
		expect(result.variants.length).toBeLessThanOrEqual(2);
		expect(result.limitations.length).toBeGreaterThan(1);
	});
});
