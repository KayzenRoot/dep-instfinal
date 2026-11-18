import { describe, expect, it } from 'vitest';
import {
	assertPreviewLayout,
	defaultPreview,
	detectPreviewCollisions,
	layoutFromPlan,
	PLATFORM_PREVIEW_PROFILES,
	resolvePreviewLayout,
	PlatformPreviewError,
} from './platform-preview.js';
import { buildCaptionAss, CaptionError } from './captions.js';
import { captionTextFitsBox } from './caption-metrics.js';
import { editPlanPreviewSchema, type EditPlanPreview } from '#lib/schemas/platform-preview.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';

function layout(overrides: Partial<EditPlanPreview> = {}): EditPlanPreview {
	return {
		profileId: 'tiktok',
		profileVersion: 1,
		captionBox: { x: 90, y: 1_320, width: 810, height: 240 },
		ctaBox: { x: 120, y: 1_020, width: 780, height: 220 },
		...overrides,
	};
}

describe('platform preview profiles', () => {
	it('ships distinct versioned TikTok, Reels and clean profiles without default collisions', () => {
		expect(PLATFORM_PREVIEW_PROFILES.tiktok.captionBox).not.toEqual(
			PLATFORM_PREVIEW_PROFILES.reels.captionBox,
		);
		expect(PLATFORM_PREVIEW_PROFILES.clean.uiZones).toEqual([]);
		for (const profile of Object.values(PLATFORM_PREVIEW_PROFILES)) {
			expect(profile.version).toBe(1);
			expect(resolvePreviewLayout({ profileId: profile.id, profileVersion: 1 }).profile).toBe(
				profile,
			);
			expect(detectPreviewCollisions({ profileId: profile.id, profileVersion: 1 })).toEqual([]);
			expect(() => assertPreviewLayout({ profileId: profile.id, profileVersion: 1 })).not.toThrow();
		}
	});

	it('detects collisions with simulated UI and between caption/CTA', () => {
		const bottom = layout({ captionBox: { x: 90, y: 1_700, width: 810, height: 180 } });
		const collisions = detectPreviewCollisions(bottom);
		expect(collisions.some((collision) => collision.code === 'CAPTION_UI_COLLISION')).toBe(true);
		expect(() => assertPreviewLayout(bottom)).toThrow(PlatformPreviewError);
		const overlap = layout({ captionBox: { x: 100, y: 1_050, width: 800, height: 260 } });
		expect(
			detectPreviewCollisions(overlap).some(
				(collision) => collision.code === 'CAPTION_CTA_OVERLAP',
			),
		).toBe(true);
	});

	it('accepts a corrected position inside the safe area and persists it in the plan', () => {
		const corrected = layout({ captionBox: { x: 90, y: 1_250, width: 810, height: 200 } });
		expect(detectPreviewCollisions(corrected)).toEqual([]);
		expect(() => assertPreviewLayout(corrected)).not.toThrow();
		const plan = videoEditPlanSchema.parse({
			schemaVersion: 1,
			episodeId: '11111111-1111-4111-8111-111111111111',
			episodeRevisionNumber: 1,
			durationMs: 90_000,
			sceneDurationMs: 6_000,
			fps: 30,
			tracks: [{ id: 'video-main', kind: 'video', label: 'Vídeo principal' }],
			clips: [
				{
					id: '22222222-2222-4222-8222-222222222222',
					sceneId: '33333333-3333-4333-8333-333333333333',
					assetId: '44444444-4444-4444-8444-444444444444',
					trackId: 'video-main',
					sourceInMs: 0,
					sourceOutMs: 90_000,
					timelineStartMs: 0,
					timelineEndMs: 90_000,
				},
			],
			preview: corrected,
		});
		expect(plan.preview?.captionBox?.y).toBe(1_250);
	});

	it('rejects boxes outside the canvas and malformed profiles', () => {
		expect(
			editPlanPreviewSchema.safeParse({
				profileId: 'tiktok',
				captionBox: { x: 1_000, y: 0, width: 200, height: 200 },
			}).success,
		).toBe(false);
		expect(editPlanPreviewSchema.safeParse({ profileId: 'youtube' }).success).toBe(false);
	});

	it('falls back to safe default boxes for legacy plans without preview', () => {
		expect(layoutFromPlan({})).toEqual({
			captionBox: PLATFORM_PREVIEW_PROFILES.tiktok.captionBox,
			ctaBox: PLATFORM_PREVIEW_PROFILES.tiktok.ctaBox,
		});
		expect(defaultPreview()).toMatchObject({
			profileId: 'tiktok',
			profileVersion: 1,
		});
	});

	it('rejects text that would overflow its box height', () => {
		expect(
			captionTextFitsBox('A'.repeat(200), {
				x: 120,
				y: 1_000,
				width: 500,
				height: 120,
			}),
		).toBe(false);
		expect(captionTextFitsBox('Linha curta', { x: 120, y: 1_000, width: 780, height: 220 })).toBe(
			true,
		);
	});
});

describe('positioned caption ASS', () => {
	const track = {
		schemaVersion: 1 as const,
		episodeId: '11111111-1111-4111-8111-111111111111',
		planId: '22222222-2222-4222-8222-222222222222',
		planVersion: 1,
		narrationTakeId: null,
		style: 'clean' as const,
		safeZone: 'tiktok' as const,
		source: 'MANUAL' as const,
		scriptSha256: null,
		audioSha256: null,
		alignmentScore: null,
		cues: [
			{
				id: '33333333-3333-4333-8333-333333333333',
				startMs: 0,
				endMs: 1_000,
				text: 'Frase de legenda comum.',
				words: [],
			},
			{
				id: '44444444-4444-4444-8444-444444444444',
				startMs: 1_000,
				endMs: 2_000,
				text: 'Escolha 1 ou 2.',
				role: 'CTA' as const,
				words: [],
			},
		],
	};

	it('positions caption and CTA in their own boxes', () => {
		const ass = buildCaptionAss(track, {
			captionBox: { x: 100, y: 1_200, width: 800, height: 200 },
			ctaBox: { x: 200, y: 900, width: 600, height: 160 },
		});
		const dialogues = ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
		expect(dialogues[0]).toContain('{\\an5\\pos(500,1300)}');
		expect(dialogues[1]).toContain('{\\an5\\pos(500,980)}');
		expect(ass).toContain('PlayResX: 1080');
	});

	it('keeps the legacy margin output when no layout is supplied', () => {
		const ass = buildCaptionAss(track);
		expect(ass).not.toContain('\\pos(');
		expect(ass).toContain(',2,90,90,220,1');
	});

	it('fails closed when stored text overflows its box', () => {
		expect(() =>
			buildCaptionAss(
				{
					...track,
					cues: [{ ...track.cues[0]!, text: 'A'.repeat(200) }],
				},
				{
					captionBox: { x: 120, y: 1_000, width: 500, height: 120 },
					ctaBox: { x: 120, y: 800, width: 500, height: 120 },
				},
			),
		).toThrow(CaptionError);
	});
});
