import { describe, expect, it } from 'vitest';
import { buildCaptionAss } from './captions.js';
import { applyStyleToCaptionTrack, assFontForStyle } from './style-caption.js';
import { captionTrackSchema } from '#lib/schemas/captions.js';
import { DEFAULT_STYLE_CONFIG } from './style-bible.js';
import { styleConfigSchema, type StyleSnapshot } from '#lib/schemas/style-bible.js';

const track = captionTrackSchema.parse({
	schemaVersion: 1,
	episodeId: '11111111-1111-4111-8111-111111111111',
	planId: '22222222-2222-4222-8222-222222222222',
	planVersion: 3,
	style: 'clean',
	safeZone: 'tiktok',
	cues: [
		{
			id: '33333333-3333-4333-8333-333333333333',
			startMs: 0,
			endMs: 1_000,
			text: 'A fita começa agora.',
			words: [],
		},
	],
});

function snapshot(config: Record<string, unknown> = {}): StyleSnapshot {
	return {
		presetId: null,
		presetRevision: null,
		presetHash: null,
		scopeType: null,
		scopeId: null,
		config: styleConfigSchema.parse({ ...DEFAULT_STYLE_CONFIG, ...config }),
		sources: {},
		versions: {},
		warnings: [],
		capturedAt: '2026-11-20T12:00:00Z',
	};
}

describe('style caption mapping', () => {
	it('keeps legacy tracks untouched without a style snapshot', () => {
		expect(applyStyleToCaptionTrack(track, null)).toBe(track);
	});

	it('maps horror to the VHS caption treatment and applies the safe zone', () => {
		const styled = applyStyleToCaptionTrack(
			track,
			snapshot({ captionTemplate: 'horror', captionSafeZone: 'feed' }),
		);
		expect(styled.style).toBe('vhs');
		expect(styled.safeZone).toBe('feed');
	});

	it('applies the style font to the exported ASS', () => {
		expect(assFontForStyle('serif')).toBe('DejaVu Serif');
		expect(assFontForStyle(undefined)).toBeNull();
		expect(buildCaptionAss(track, undefined, 'serif')).toContain('Style: Default,DejaVu Serif');
		expect(buildCaptionAss(track, undefined, 'mono')).toContain('DejaVu Sans Mono');
	});
});
