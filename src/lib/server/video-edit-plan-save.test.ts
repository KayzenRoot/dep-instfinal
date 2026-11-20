import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultEditPlan } from '#lib/domain/video-edit-plan.js';
import { DEFAULT_STYLE_CONFIG } from '#lib/domain/style-bible.js';
import { styleConfigSchema, type StyleSnapshot } from '#lib/schemas/style-bible.js';

const style = vi.hoisted(() => {
	class StyleServiceError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
		}
	}
	return { StyleServiceError, resolveEpisodeStyleSnapshot: vi.fn() };
});

vi.mock('./style-bible.js', () => style);

import { saveVideoEditPlan } from './video-edit-plans.js';

const episodeId = '11111111-1111-4111-8111-111111111111';
const sceneId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';

function contextPlan() {
	return buildDefaultEditPlan({
		episodeId,
		episodeRevisionNumber: 3,
		durationMs: 90_000,
		sceneDurationMs: 6_000,
		scenes: [{ id: sceneId, sceneIndex: 1, startMs: 0, endMs: 6_000 }],
		assets: [{ id: assetId, sceneId, assetVersion: 1, durationMs: 6_000 }],
	});
}

function snapshot(overrides: Record<string, unknown> = {}): StyleSnapshot {
	return {
		presetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		presetRevision: 4,
		presetHash: 'a'.repeat(64),
		scopeType: 'SERIES',
		scopeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		config: styleConfigSchema.parse({ ...DEFAULT_STYLE_CONFIG, ...overrides }),
		sources: {},
		versions: {},
		warnings: [],
		capturedAt: '2026-11-20T12:00:00Z',
	};
}

function database(storedStyle: StyleSnapshot | null = null) {
	const rows: Record<string, unknown> = {
		video_edit_plans: storedStyle ? { plan: { ...contextPlan(), styleBible: storedStyle } } : null,
		episodes: {
			id: episodeId,
			duration_ms: 90_000,
			scene_duration_ms: 6_000,
			status: 'DRAFT',
		},
		scenes: [{ id: sceneId, scene_index: 1, start_ms: 0, end_ms: 6_000 }],
		video_assets: [
			{
				id: assetId,
				scene_id: sceneId,
				asset_version: 1,
				duration_ms: 6_000,
				status: 'READY',
			},
		],
		episode_revisions: [{ revision_number: 3 }],
	};
	const builder = (table: string) => {
		const chain = {
			select: () => chain,
			eq: () => chain,
			order: () => chain,
			limit: () => chain,
			maybeSingle: () => {
				const value = rows[table];
				return Promise.resolve({
					data: Array.isArray(value) ? (value[0] ?? null) : value,
					error: null,
				});
			},
			then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
				Promise.resolve({ data: rows[table], error: null }).then(resolve, reject),
		};
		return chain;
	};
	return { from: (table: string) => builder(table) } as never;
}

function admin() {
	return { rpc: vi.fn().mockResolvedValue({ data: 1, error: null }) };
}

describe('saveVideoEditPlan style opt-in', () => {
	beforeEach(() => {
		style.resolveEpisodeStyleSnapshot.mockReset();
	});

	it('preserves the stored snapshot on an ordinary save', async () => {
		const stored = snapshot();
		const adminDb = admin();
		await saveVideoEditPlan({
			db: database(stored),
			adminDb: adminDb as never,
			owner: { id: 'owner' } as never,
			episodeId,
			expectedVersion: 3,
			plan: { ...contextPlan(), styleBible: stored },
		});
		expect(style.resolveEpisodeStyleSnapshot).not.toHaveBeenCalled();
		expect(adminDb.rpc.mock.calls[0]?.[1].p_plan.styleBible).toEqual(stored);
		expect(adminDb.rpc.mock.calls[0]?.[1].p_plan.color).toBeUndefined();
	});

	it('does not silently style a legacy plan without a snapshot', async () => {
		const adminDb = admin();
		await saveVideoEditPlan({
			db: database(),
			adminDb: adminDb as never,
			owner: { id: 'owner' } as never,
			episodeId,
			expectedVersion: 3,
			plan: contextPlan(),
		});
		expect(style.resolveEpisodeStyleSnapshot).not.toHaveBeenCalled();
		expect(adminDb.rpc.mock.calls[0]?.[1].p_plan.styleBible).toBeUndefined();
	});

	it('ignores a forged client snapshot and keeps the stored one', async () => {
		const stored = { ...snapshot(), presetRevision: 4 };
		const forged = {
			...snapshot(),
			presetRevision: 99,
			config: styleConfigSchema.parse({ ...DEFAULT_STYLE_CONFIG, ctaPrompt: 'Forjado' }),
		};
		const adminDb = admin();
		await saveVideoEditPlan({
			db: database(stored),
			adminDb: adminDb as never,
			owner: { id: 'owner' } as never,
			episodeId,
			expectedVersion: 3,
			plan: { ...contextPlan(), styleBible: forged },
		});
		expect(style.resolveEpisodeStyleSnapshot).not.toHaveBeenCalled();
		expect(adminDb.rpc.mock.calls[0]?.[1].p_plan.styleBible).toEqual(stored);
	});

	it('strips a forged snapshot from a brand-new plan with no configured style', async () => {
		style.resolveEpisodeStyleSnapshot.mockResolvedValue({
			...snapshot(),
			presetId: null,
			presetRevision: null,
			presetHash: null,
			scopeType: null,
			scopeId: null,
			config: DEFAULT_STYLE_CONFIG,
		});
		const adminDb = admin();
		const forged = { ...snapshot(), presetRevision: 99 };
		await saveVideoEditPlan({
			db: database(null),
			adminDb: adminDb as never,
			owner: { id: 'owner' } as never,
			episodeId,
			expectedVersion: 0,
			plan: { ...contextPlan(), styleBible: forged },
		});
		expect(style.resolveEpisodeStyleSnapshot).toHaveBeenCalled();
		expect(adminDb.rpc.mock.calls[0]?.[1].p_plan.styleBible).toBeUndefined();
	});

	it('applies the current style only with explicit opt-in', async () => {
		const current = snapshot({ colorPresetId: 'cctv', colorStrength: 0.65 });
		style.resolveEpisodeStyleSnapshot.mockResolvedValue(current);
		const adminDb = admin();
		await saveVideoEditPlan({
			db: database(),
			adminDb: adminDb as never,
			owner: { id: 'owner' } as never,
			episodeId,
			expectedVersion: 3,
			plan: contextPlan(),
			applyStyle: true,
		});
		expect(style.resolveEpisodeStyleSnapshot).toHaveBeenCalled();
		const saved = adminDb.rpc.mock.calls[0]?.[1].p_plan;
		expect(saved.styleBible).toEqual(current);
		expect(saved.color).toEqual({
			presetId: 'cctv',
			presetVersion: 1,
			strength: 65,
			referenceClipId: null,
			overrides: [],
		});
	});
});
