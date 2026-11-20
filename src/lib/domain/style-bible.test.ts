import { describe, expect, it } from 'vitest';
import {
	styleConfigSchema,
	styleImportSchema,
	styleOverrideSchema,
	styleSnapshotSchema,
} from '#lib/schemas/style-bible.js';
import {
	DEFAULT_STYLE_CONFIG,
	resolveStyle,
	STYLE_FIELDS,
	styleSnapshotDrift,
	withdrawInvalidSfx,
} from './style-bible.js';
import { styleConfigHash } from './style-config-hash.js';

function override(value: Record<string, unknown>) {
	return styleOverrideSchema.parse(value);
}

const ALTERNATIVES: Record<string, unknown> = {
	paletteBackground: '#101112',
	paletteForeground: '#f0e0d0',
	paletteAccent: '#ff5500',
	paletteMuted: '#777777',
	colorPresetId: 'vhs_1987',
	colorStrength: 0.33,
	fontFamily: 'mono',
	captionTemplate: 'horror',
	captionSafeZone: 'feed',
	motion: 'kinetic',
	reducedMotion: true,
	vhsIntensity: 3,
	sfxCategory: 'pulse',
	sfxAssetIds: ['a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'],
	voiceStyle: 'whisper',
	openingHookKind: 'sound_entry',
	coverTemplateId: 'cctv',
	endCardTemplateId: 'signal',
	ctaPrompt: 'Responda com uma palavra',
};

describe('style bible resolution', () => {
	it('resolves defaults, series, season, episode and scene precedence per field', () => {
		const resolved = resolveStyle([
			{ source: 'SERIES', config: override({ paletteAccent: '#ff0000', fontFamily: 'serif' }) },
			{ source: 'SEASON', config: override({ paletteAccent: '#00ff00', vhsIntensity: 0 }) },
			{ source: 'EPISODE', config: override({ captionTemplate: 'horror' }) },
			{ source: 'SCENE', config: override({ motion: 'kinetic', reducedMotion: true }) },
		]);
		expect(resolved.config.paletteAccent).toBe('#00ff00');
		expect(resolved.config.fontFamily).toBe('serif');
		expect(resolved.config.vhsIntensity).toBe(0);
		expect(resolved.config.captionTemplate).toBe('horror');
		expect(resolved.config.motion).toBe('kinetic');
		expect(resolved.config.reducedMotion).toBe(true);
		expect(resolved.sources.paletteAccent).toBe('SEASON');
		expect(resolved.sources.fontFamily).toBe('SERIES');
		expect(resolved.sources.vhsIntensity).toBe('SEASON');
		expect(resolved.sources.captionTemplate).toBe('EPISODE');
		expect(resolved.sources.motion).toBe('SCENE');
		expect(resolved.sources.paletteBackground).toBe('DEFAULT');
	});

	it('lets a scene override win every field without mutating the series layer', () => {
		for (const field of STYLE_FIELDS) {
			const series = override({ [field]: ALTERNATIVES[field] });
			const seriesBefore = structuredClone(series);
			const resolved = resolveStyle([
				{ source: 'SERIES', config: series },
				{ source: 'EPISODE', config: override({ [field]: DEFAULT_STYLE_CONFIG[field] }) },
				{ source: 'SCENE', config: override({ [field]: ALTERNATIVES[field] }) },
			]);
			expect(resolved.config[field], field).toEqual(ALTERNATIVES[field]);
			expect(resolved.sources[field], field).toBe('SCENE');
			expect(series, field).toEqual(seriesBefore);
		}
	});

	it('keeps a scene caption override scoped without changing the series preset', () => {
		const series = override({ paletteAccent: '#123456', captionTemplate: 'clean' });
		const resolved = resolveStyle([
			{ source: 'SERIES', config: series },
			{ source: 'SCENE', config: override({ captionTemplate: 'horror' }) },
		]);
		expect(resolved.config.captionTemplate).toBe('horror');
		expect(resolved.sources.captionTemplate).toBe('SCENE');
		expect(resolved.config.paletteAccent).toBe('#123456');
		expect(resolved.sources.paletteAccent).toBe('SERIES');
		expect(series.captionTemplate).toBe('clean');
	});

	it('treats false and zero as explicit overrides', () => {
		const resolved = resolveStyle([
			{ source: 'EPISODE', config: override({ reducedMotion: false, vhsIntensity: 0 }) },
		]);
		expect(resolved.config.reducedMotion).toBe(false);
		expect(resolved.config.vhsIntensity).toBe(0);
		expect(resolved.sources.reducedMotion).toBe('EPISODE');
	});

	it('hashes deterministically and changes with any visual field', () => {
		const base = DEFAULT_STYLE_CONFIG;
		expect(styleConfigHash(base)).toBe(styleConfigHash({ ...base }));
		expect(styleConfigHash(base)).not.toBe(
			styleConfigHash(styleConfigSchema.parse({ ...base, paletteAccent: '#abcdef' })),
		);
		expect(styleConfigHash(base)).not.toBe(
			styleConfigHash(styleConfigSchema.parse({ ...base, captionTemplate: 'horror' })),
		);
		expect(STYLE_FIELDS.every((field) => field in base)).toBe(true);
	});

	it('roundtrips the versioned import envelope and rejects unknown fields or versions', () => {
		const payload = {
			format: 'dif-studio-style-preset/v1',
			name: 'Noir reutilizável',
			scopeType: 'SERIES',
			scopeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			config: DEFAULT_STYLE_CONFIG,
		};
		expect(styleImportSchema.parse(payload)).toMatchObject({ name: 'Noir reutilizável' });
		expect(styleImportSchema.safeParse({ ...payload, format: 'v2' }).success).toBe(false);
		expect(
			styleImportSchema.safeParse({
				...payload,
				config: { ...DEFAULT_STYLE_CONFIG, shellCommand: 'rm -rf /' },
			}).success,
		).toBe(false);
		expect(styleOverrideSchema.parse({})).toEqual({});
	});

	it('withdraws only missing or unlicensed SFX and keeps the rest', () => {
		const config = styleConfigSchema.parse({
			...DEFAULT_STYLE_CONFIG,
			sfxAssetIds: ['a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2'],
		});
		const filtered = withdrawInvalidSfx(config, new Set(['b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2']));
		expect(filtered.sfxAssetIds).toEqual(['b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2']);
		expect(withdrawInvalidSfx(config, new Set(config.sfxAssetIds))).toBe(config);
	});

	it('detects preset, config and scene drift without mutating frozen snapshots', () => {
		const base = styleSnapshotSchema.parse({
			presetId: null,
			presetRevision: 4,
			presetHash: 'a'.repeat(64),
			scopeType: 'SERIES',
			scopeId: null,
			config: DEFAULT_STYLE_CONFIG,
			sources: {},
			scenes: [],
			warnings: [],
			capturedAt: '2026-11-20T12:00:00Z',
		});
		expect(styleSnapshotDrift(base, base).stale).toBe(false);
		expect(styleSnapshotDrift(base, { ...base, presetRevision: 5 }).stale).toBe(true);
		expect(
			styleSnapshotDrift(base, {
				...base,
				config: { ...base.config, paletteAccent: '#ff0000' },
			}).stale,
		).toBe(true);
		expect(
			styleSnapshotDrift(base, {
				...base,
				scenes: [
					{
						sceneId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
						sceneIndex: 1,
						config: { ...base.config, captionTemplate: 'horror' },
						sources: { captionTemplate: 'SCENE' },
					},
				],
			}).stale,
		).toBe(true);
		expect(base.presetRevision).toBe(4);
	});

	it('accepts frozen scene snapshots with per-field sources', () => {
		const snapshot = styleSnapshotSchema.parse({
			presetId: null,
			presetRevision: null,
			presetHash: null,
			scopeType: null,
			scopeId: null,
			config: DEFAULT_STYLE_CONFIG,
			sources: { paletteAccent: 'DEFAULT' },
			scenes: [
				{
					sceneId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
					sceneIndex: 1,
					config: { ...DEFAULT_STYLE_CONFIG, captionTemplate: 'horror' },
					sources: { captionTemplate: 'SCENE' },
				},
			],
			warnings: ['STYLE_PRESET_MISSING'],
			capturedAt: '2026-11-20T12:00:00Z',
		});
		expect(snapshot.scenes?.[0]?.sources.captionTemplate).toBe('SCENE');
		expect(
			styleSnapshotSchema.safeParse({
				...snapshot,
				capturedAt: 'not-a-date',
			}).success,
		).toBe(false);
	});
});
