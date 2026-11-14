import { describe, expect, it } from 'vitest';
import {
	audioAssetMetadataSchema,
	editPlanAudioEventSchema,
	editPlanAudioSchema,
} from '#lib/schemas/audio-library.js';
import { buildAudioMixCommand, RenderCompositionError } from './render-composition.js';
import { buildDefaultEditPlan } from './video-edit-plan.js';
import { buildSuspenseAudioTemplate, AudioTemplateError } from './audio-template.js';
import { assertAudioEventsUsable, AudioEventError } from './audio-events.js';
import type { AudioAsset } from '#lib/schemas/audio-library.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';

const metadata = {
	kind: 'SFX' as const,
	title: 'Porta rangendo',
	author: 'DIF Studio',
	source: 'Gravação própria',
	licenseName: 'CC0 1.0',
	licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
	attribution: 'DIF Studio, CC0',
	commercialAllowed: true,
	socialAllowed: true,
	licenseStatus: 'VERIFIED' as const,
	tags: ['porta', 'impacto'],
	intensity: 4,
};

const event = {
	id: '44444444-4444-4444-8444-444444444444',
	assetId: '33333333-3333-4333-8333-333333333333',
	kind: 'MUSIC' as const,
	startMs: 500,
	durationMs: 2_000,
	sourceInMs: 0,
	gainDb: -18,
	fadeInMs: 200,
	fadeOutMs: 300,
	pan: -0.4,
	loop: false,
	ducking: true,
	spatialPreset: 'corridor' as const,
	spatialMode: 'binaural_simulated' as const,
};

describe('audio library/licensing contract', () => {
	it('requires verified licences to allow commercial and social use', () => {
		expect(audioAssetMetadataSchema.safeParse(metadata).success).toBe(true);
		expect(
			audioAssetMetadataSchema.safeParse({ ...metadata, commercialAllowed: false }).success,
		).toBe(false);
		expect(
			audioAssetMetadataSchema.safeParse({
				...metadata,
				licenseStatus: 'UNKNOWN',
				commercialAllowed: false,
			}).success,
		).toBe(true);
		expect(audioAssetMetadataSchema.safeParse({ ...metadata, tags: [] }).success).toBe(false);
	});

	it('validates fades, ranges and loop offsets', () => {
		expect(editPlanAudioEventSchema.safeParse(event).success).toBe(true);
		expect(
			editPlanAudioEventSchema.safeParse({ ...event, fadeInMs: 900, fadeOutMs: 1_200 }).success,
		).toBe(false);
		expect(
			editPlanAudioEventSchema.safeParse({ ...event, loop: true, sourceInMs: 500 }).success,
		).toBe(false);
		expect(editPlanAudioSchema.safeParse({ events: [event, event] }).success).toBe(true);
	});

	it('blocks missing, unlicensed and out-of-range audio events', () => {
		const asset: AudioAsset = {
			id: event.assetId,
			kind: 'MUSIC',
			title: 'Bed',
			author: 'DIF',
			source: 'fixture',
			licenseName: 'CC0',
			licenseUrl: null,
			attribution: 'DIF CC0',
			commercialAllowed: true,
			socialAllowed: true,
			licenseStatus: 'VERIFIED',
			tags: ['drone'],
			intensity: 3,
			sha256: 'a'.repeat(64),
			byteSize: 1024,
			durationMs: 5_000,
			sampleRate: 48_000,
			channels: 1,
			format: 'wav',
			peakDb: -2,
			truePeakDb: -1,
			lufs: -18,
			createdAt: '2026-11-14T00:00:00.000Z',
		};
		expect(() => assertAudioEventsUsable([event], [])).toThrow(AudioEventError);
		expect(() =>
			assertAudioEventsUsable(
				[{ ...event, durationMs: 2_000, sourceInMs: 0 }],
				[{ ...asset, durationMs: 1_000 }],
			),
		).toThrow(AudioEventError);
		expect(() =>
			assertAudioEventsUsable([event], [{ ...asset, licenseStatus: 'UNKNOWN' }]),
		).toThrow(AudioEventError);
		expect(assertAudioEventsUsable([event], [asset]).get(asset.id)?.title).toBe('Bed');
	});

	it('keeps audio optional for legacy plans and includes empty audio on new plans', () => {
		const scenes = Array.from({ length: 30 }, (_, index) => ({
			id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
			sceneIndex: index + 1,
			startMs: index * 4_000,
			endMs: (index + 1) * 4_000,
		}));
		const assets = scenes.map((scene) => ({
			id: `33333333-3333-4333-8333-${String(scene.sceneIndex).padStart(12, '0')}`,
			sceneId: scene.id,
			assetVersion: 1,
			durationMs: 4_000,
		}));
		const plan = buildDefaultEditPlan({
			episodeId: '11111111-1111-4111-8111-111111111111',
			episodeRevisionNumber: 1,
			durationMs: 120_000,
			sceneDurationMs: 4_000,
			scenes,
			assets,
		});
		expect(plan.audio).toEqual({ masterGainDb: 0, events: [] });
		const legacy = { ...plan } as Record<string, unknown>;
		delete legacy.audio;
		expect(videoEditPlanSchema.safeParse(legacy).success).toBe(true);
	});
});

describe('suspense audio template', () => {
	const baseAsset = {
		sha256: 'a'.repeat(64),
		byteSize: 1024,
		format: 'wav',
		sampleRate: 48_000,
		channels: 1,
		peakDb: -2,
		truePeakDb: -1,
		lufs: -18,
		createdAt: '2026-11-14T00:00:00.000Z',
	};
	const ambience: AudioAsset = {
		...baseAsset,
		id: '11111111-1111-4111-8111-111111111111',
		kind: 'MUSIC',
		title: 'Drone',
		author: 'DIF',
		source: 'fixture',
		licenseName: 'CC0',
		licenseUrl: null,
		attribution: 'DIF CC0',
		commercialAllowed: true,
		socialAllowed: true,
		licenseStatus: 'VERIFIED',
		tags: ['drone'],
		intensity: 3,
		durationMs: 30_000,
	};
	const impact: AudioAsset = {
		...baseAsset,
		id: '22222222-2222-4222-8222-222222222222',
		kind: 'SFX',
		title: 'Impacto',
		author: 'DIF',
		source: 'fixture',
		licenseName: 'CC0',
		licenseUrl: null,
		attribution: 'DIF CC0',
		commercialAllowed: true,
		socialAllowed: true,
		licenseStatus: 'VERIFIED',
		tags: ['impacto'],
		intensity: 5,
		durationMs: 1_000,
	};

	it('inserts ambience and a timed impact for a 120s bed', () => {
		const template = buildSuspenseAudioTemplate({
			durationMs: 120_000,
			assets: [ambience, impact],
		});
		expect(template.events).toHaveLength(2);
		expect(template.events[0]).toMatchObject({
			assetId: ambience.id,
			startMs: 0,
			durationMs: 120_000,
			loop: true,
			ducking: true,
		});
		expect(template.events[1]).toMatchObject({
			assetId: impact.id,
			startMs: 105_000,
			kind: 'SFX',
		});
		const impactEvent = template.events[1];
		expect(impactEvent.fadeInMs + impactEvent.fadeOutMs).toBeLessThanOrEqual(
			impactEvent.durationMs,
		);
	});

	it('fails when a licensed ambience or impact is missing', () => {
		expect(() => buildSuspenseAudioTemplate({ durationMs: 120_000, assets: [] })).toThrow(
			AudioTemplateError,
		);
		expect(() => buildSuspenseAudioTemplate({ durationMs: 120_000, assets: [ambience] })).toThrow(
			AudioTemplateError,
		);
	});
});

describe('audio mix command', () => {
	const base = {
		videoPath: 'C:/work/video.mp4',
		outputPath: 'C:/work/output.mp4',
		videoDurationMs: 4_000,
		narration: { path: 'C:/work/voice.wav', durationMs: 3_000 },
		events: [
			{
				id: 'music',
				path: 'C:/work/music.wav',
				kind: 'MUSIC' as const,
				startMs: 0,
				durationMs: 4_000,
				sourceInMs: 0,
				gainDb: -18,
				fadeInMs: 300,
				fadeOutMs: 400,
				pan: 0,
				loop: true,
				ducking: true,
				spatialPreset: 'corridor' as const,
				spatialMode: 'binaural_simulated' as const,
				intensity: 3,
			},
			{
				id: 'impact',
				path: 'C:/work/impact.wav',
				kind: 'SFX' as const,
				startMs: 2_000,
				durationMs: 800,
				sourceInMs: 0,
				gainDb: -6,
				fadeInMs: 100,
				fadeOutMs: 100,
				pan: 0.7,
				loop: false,
				ducking: false,
				spatialPreset: 'steps-behind' as const,
				spatialMode: 'binaural_simulated' as const,
				intensity: 5,
			},
		],
	};

	it('builds narration priority, ducking, spatial stereo and limiting', () => {
		const command = buildAudioMixCommand(base);
		const graph = command.args[command.args.indexOf('-filter_complex') + 1]!;
		expect(graph).toContain('sidechaincompress=threshold=0.005');
		expect(graph).toContain('asplit=2[narr][duck]');
		expect(graph).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
		expect(graph).toContain('alimiter=limit=0.891');
		expect(graph).toContain('aecho=');
		expect(graph).toContain('pan=stereo|c0=0.7071*c0|c1=0.7071*c1');
		expect(graph).toContain('adelay=2000|2000');
		expect(command.args).toContain('-stream_loop');
		expect(command.eventCount).toBe(2);
		expect(command.duckedCount).toBe(1);
		expect(command.spatialModes.binaural_simulated).toBe(2);
	});

	it('mixes without narration and rejects empty/oversized mixes', () => {
		const command = buildAudioMixCommand({
			...base,
			narration: null,
		});
		const graph = command.args[command.args.indexOf('-filter_complex') + 1]!;
		expect(graph).not.toContain('sidechaincompress');
		expect(command.narrationDurationMs).toBeNull();
		expect(() => buildAudioMixCommand({ ...base, events: [] })).toThrow(RenderCompositionError);
		expect(() =>
			buildAudioMixCommand({
				...base,
				events: Array.from({ length: 65 }, (_, index) => ({
					...base.events[0]!,
					id: `e${index}`,
				})),
			}),
		).toThrow(RenderCompositionError);
	});
});
