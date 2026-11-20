import { beforeEach, describe, expect, it, vi } from 'vitest';

const style = vi.hoisted(() => {
	class StyleServiceError extends Error {
		constructor(
			readonly status: number,
			readonly code: string,
			message: string,
		) {
			super(message);
			this.name = 'StyleServiceError';
		}
	}
	return {
		StyleServiceError,
		clearEpisodeStyleOverride: vi.fn(),
		clearSceneStyleOverride: vi.fn(),
		exportStylePreset: vi.fn(),
		importStylePreset: vi.fn(),
		loadStylePageContext: vi.fn(),
		resolveEpisodeStyleSnapshot: vi.fn(),
		saveEpisodeStyleOverride: vi.fn(),
		saveSceneStyleOverride: vi.fn(),
		saveStylePreset: vi.fn(),
	};
});
const authorized = vi.hoisted(() => ({
	ownerDatabase: vi.fn(),
	readFormText: (form: FormData, key: string) => {
		const value = form.get(key);
		return typeof value === 'string' ? value : '';
	},
}));

vi.mock('#lib/server/style-bible.js', () => style);
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/supabase.js', () => ({ createSupabaseAdminClient: () => ({}) }));

import { actions } from './+page.server.js';

const scopeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const episodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sceneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const presetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const config = {
	schemaVersion: 1,
	paletteBackground: '#08090b',
	paletteForeground: '#e8e2d6',
	paletteAccent: '#b6ff9a',
	paletteMuted: '#8a8a8a',
	colorPresetId: 'neutral',
	colorStrength: 0.8,
	fontFamily: 'sans',
	captionTemplate: 'clean',
	captionSafeZone: 'tiktok',
	motion: 'restrained',
	reducedMotion: false,
	vhsIntensity: 1,
	sfxCategory: 'none',
	sfxAssetIds: [],
	voiceStyle: 'neutral',
	openingHookKind: 'none',
	coverTemplateId: 'noir',
	endCardTemplateId: 'doors',
	ctaPrompt: 'Comente A ou B',
};

function event(fields: Record<string, string>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return {
		request: new Request('http://localhost/app/style?/action', { method: 'POST', body: form }),
		url: new URL('http://localhost/app/style'),
	} as never;
}

function configFields(overrides: Record<string, string> = {}) {
	return {
		scopeType: 'SERIES',
		scopeId,
		episodeId,
		name: 'Noir',
		expectedRevision: '0',
		paletteBackground: '#08090b',
		paletteForeground: '#e8e2d6',
		paletteAccent: '#b6ff9a',
		paletteMuted: '#8a8a8a',
		colorPresetId: 'neutral',
		colorStrength: '80',
		fontFamily: 'sans',
		captionTemplate: 'clean',
		captionSafeZone: 'tiktok',
		motion: 'restrained',
		vhsIntensity: '1',
		sfxCategory: 'none',
		sfxAssetIds: '',
		voiceStyle: 'neutral',
		openingHookKind: 'none',
		coverTemplateId: 'noir',
		endCardTemplateId: 'doors',
		ctaPrompt: 'Comente A ou B',
		...overrides,
	};
}

describe('style page actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authorized.ownerDatabase.mockReturnValue({ db: {}, owner: { id: 'owner-id' } });
		style.saveStylePreset.mockResolvedValue({ revision: 1 });
		style.saveEpisodeStyleOverride.mockResolvedValue(undefined);
		style.saveSceneStyleOverride.mockResolvedValue(undefined);
		style.clearEpisodeStyleOverride.mockResolvedValue(true);
		style.clearSceneStyleOverride.mockResolvedValue(true);
		style.importStylePreset.mockResolvedValue(1);
	});

	it('saves a full preset with parsed numbers and redirects to the scope', async () => {
		await expect(
			(actions.save as (event: never) => Promise<unknown>)(event(configFields())),
		).rejects.toMatchObject({
			status: 303,
			location: `/app/style?scopeType=SERIES&scopeId=${scopeId}&episodeId=${episodeId}&saved=preset`,
		});
		expect(style.saveStylePreset).toHaveBeenCalledWith(
			expect.objectContaining({
				values: expect.objectContaining({
					scopeType: 'SERIES',
					scopeId,
					name: 'Noir',
					expectedRevision: 0,
					status: 'DRAFT',
					config: expect.objectContaining({
						colorStrength: 0.8,
						vhsIntensity: 1,
						sfxAssetIds: [],
					}),
				}),
			}),
		);
	});

	it('keeps an episode override sparse so unspecified fields inherit', async () => {
		await expect(
			(actions.override as (event: never) => Promise<unknown>)(
				event({ episodeId, captionTemplate: 'horror', motion: 'kinetic' }),
			),
		).rejects.toMatchObject({ status: 303, location: expect.stringContaining('saved=override') });
		expect(style.saveEpisodeStyleOverride).toHaveBeenCalledWith(
			expect.objectContaining({
				episodeId,
				config: { captionTemplate: 'horror', motion: 'kinetic' },
			}),
		);
	});

	it('clears the episode override when the sparse form is empty', async () => {
		await expect(
			(actions.override as (event: never) => Promise<unknown>)(event({ episodeId })),
		).rejects.toMatchObject({ status: 303 });
		expect(style.clearEpisodeStyleOverride).toHaveBeenCalledWith(
			expect.objectContaining({ episodeId }),
		);
		expect(style.saveEpisodeStyleOverride).not.toHaveBeenCalled();
	});

	it('can force reducedMotion=false in an override', async () => {
		await expect(
			(actions.override as (event: never) => Promise<unknown>)(
				event({ episodeId, reducedMotion: 'false' }),
			),
		).rejects.toMatchObject({ status: 303 });
		expect(style.saveEpisodeStyleOverride).toHaveBeenCalledWith(
			expect.objectContaining({ config: { reducedMotion: false } }),
		);
	});

	it('lets a scene override replace the SFX list with an explicit empty list', async () => {
		await expect(
			(actions.sceneOverride as (event: never) => Promise<unknown>)(
				event({ episodeId, sceneId, sfxOverride: 'on', sfxAssetIds: '' }),
			),
		).rejects.toMatchObject({ status: 303 });
		expect(style.saveSceneStyleOverride).toHaveBeenCalledWith(
			expect.objectContaining({ sceneId, config: { sfxAssetIds: [] } }),
		);
	});

	it('approves the clicked revision with optimistic concurrency', async () => {
		style.loadStylePageContext.mockResolvedValue({
			presets: [
				{
					id: presetId,
					scopeType: 'SERIES',
					scopeId,
					name: 'Noir',
					latestRevision: 4,
					revisions: [
						{ revision: 4, status: 'DRAFT', config: { ...config, ctaPrompt: 'Quatro' } },
						{ revision: 2, status: 'DRAFT', config },
					],
					approved: null,
				},
			],
			series: [],
			seasons: [],
			episodes: [],
			episodeOverrides: [],
			sceneOverrides: [],
		});
		await expect(
			(actions.approve as (event: never) => Promise<unknown>)(
				event({ presetId, revision: '2', scopeType: 'SERIES', scopeId, episodeId }),
			),
		).rejects.toMatchObject({ status: 303 });
		expect(style.saveStylePreset).toHaveBeenCalledWith(
			expect.objectContaining({
				values: expect.objectContaining({
					expectedRevision: 4,
					status: 'APPROVED',
					config,
				}),
			}),
		);
	});

	it('rejects malformed import JSON with a readable 400 before any write', async () => {
		const result = (await (actions.import as (event: never) => Promise<unknown>)(
			event({
				json: '{"format":',
				scopeType: 'SERIES',
				scopeId,
				episodeId,
			}),
		)) as { status: number; data: { message: string } };
		expect(result.status).toBe(400);
		expect(result.data.message).toContain('JSON');
		expect(style.importStylePreset).not.toHaveBeenCalled();
	});

	it('surfaces a stale revision conflict instead of redirecting', async () => {
		style.saveStylePreset.mockRejectedValueOnce(
			new style.StyleServiceError(409, 'STYLE_REVISION_CONFLICT', 'Recarregue antes de salvar.'),
		);
		const result = (await (actions.save as (event: never) => Promise<unknown>)(
			event(configFields({ expectedRevision: '2' })),
		)) as { status: number; data: { message: string } };
		expect(result.status).toBe(409);
		expect(result.data.message).toBe('Recarregue antes de salvar.');
	});
});
