import { describe, expect, it } from 'vitest';
import { buildDefaultEditPlan } from '#lib/domain/video-edit-plan.js';
import { DEFAULT_STYLE_CONFIG, STYLE_FIELDS } from '#lib/domain/style-bible.js';
import { styleConfigSchema, type StyleSnapshot } from '#lib/schemas/style-bible.js';
import { attachStyleSnapshot, shouldApplyStyleSnapshot } from './video-edit-plans.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const sceneId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';

function plan() {
	return buildDefaultEditPlan({
		episodeId,
		episodeRevisionNumber: 3,
		durationMs: 90_000,
		sceneDurationMs: 6_000,
		scenes: [{ id: sceneId, sceneIndex: 1, startMs: 0, endMs: 6_000 }],
		assets: [{ id: assetId, sceneId, assetVersion: 2, durationMs: 6_000 }],
	});
}

function snapshot(overrides: Record<string, unknown> = {}): StyleSnapshot {
	return {
		presetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		presetRevision: 4,
		presetHash: 'a'.repeat(64),
		scopeType: 'SERIES',
		scopeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		config: styleConfigSchema.parse({
			...DEFAULT_STYLE_CONFIG,
			colorPresetId: 'cctv',
			colorStrength: 0.65,
			...overrides,
		}),
		sources: Object.fromEntries(STYLE_FIELDS.map((field) => [field, 'SERIES'])),
		scenes: [
			{
				sceneId,
				sceneIndex: 1,
				config: styleConfigSchema.parse({ ...DEFAULT_STYLE_CONFIG, captionTemplate: 'horror' }),
				sources: { captionTemplate: 'SCENE' },
			},
		],
		warnings: [],
		capturedAt: '2026-11-20T12:00:00Z',
	};
}

describe('shouldApplyStyleSnapshot', () => {
	it('applies automatically only to a brand-new plan or an explicit opt-in', () => {
		expect(shouldApplyStyleSnapshot({ expectedVersion: 0, applyStyle: false })).toBe(true);
		expect(shouldApplyStyleSnapshot({ expectedVersion: 4, applyStyle: false })).toBe(false);
		expect(shouldApplyStyleSnapshot({ expectedVersion: 4, applyStyle: true })).toBe(true);
	});
});

describe('attachStyleSnapshot', () => {
	it('freezes the resolved style and injects color when the plan has none', () => {
		const original = plan();
		const styled = attachStyleSnapshot(original, snapshot({ captionTemplate: 'horror' }));
		expect(styled.styleBible).toMatchObject({
			presetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			presetRevision: 4,
			presetHash: 'a'.repeat(64),
		});
		expect(styled.styleBible?.scenes?.[0]?.sources.captionTemplate).toBe('SCENE');
		expect(styled.captions.template).toBe('horror');
		expect(styled.color).toMatchObject({ presetId: 'cctv', presetVersion: 1, strength: 65 });
		expect(original.styleBible).toBeUndefined();
		expect(original.color).toBeUndefined();
	});

	it('does not inject a neutral grade or overwrite an explicit plan color', () => {
		expect(
			attachStyleSnapshot(plan(), snapshot({ colorPresetId: 'neutral' })).color,
		).toBeUndefined();
		const explicit = {
			...plan(),
			color: {
				presetId: 'vhs_1987' as const,
				presetVersion: 1 as const,
				strength: 40,
				referenceClipId: null,
				overrides: [],
			},
		};
		const styled = attachStyleSnapshot(explicit, snapshot());
		expect(styled.color).toEqual(explicit.color);
		expect(styled.styleBible?.presetRevision).toBe(4);
	});
});
