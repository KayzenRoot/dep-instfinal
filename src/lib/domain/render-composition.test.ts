import { describe, expect, it } from 'vitest';
import { buildSceneTimeline } from './timeline.js';
import { buildDefaultEditPlan, retimeClips, type EditPlanContext } from './video-edit-plan.js';
import {
	buildAudioMixCommand,
	buildNarrationMuxCommand,
	buildRenderCommand,
	RenderCompositionError,
} from './render-composition.js';
import type { EditDirectorPlan } from '#lib/schemas/edit-director.js';
import { directorEventDuration } from './edit-director.js';

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

function inputs(plan: ReturnType<typeof buildDefaultEditPlan>) {
	return plan.clips.map((clip) => ({
		assetId: clip.assetId,
		path: `/tmp/${clip.assetId}.mp4`,
		durationMs: 8_000,
		width: 1080,
		height: 1920,
	}));
}

function directorWith(
	type: 'VHS_STATIC' | 'SILENCE_BEFORE_REVEAL',
	startMs: number,
	durationMs: number,
): EditDirectorPlan {
	const eventId = '99999999-9999-4999-8999-999999999999';
	return {
		schemaVersion: 1,
		source: 'OFFLINE',
		preset: 'custom',
		seed: 1,
		reviewStatus: 'APPLIED',
		generatedAt: '2026-11-17T00:00:00.000Z',
		points: [
			{ timeMs: 0, tension: 10 },
			{ timeMs: 120_000, tension: 95 },
		],
		markers: [
			{
				timeMs: 0,
				phase: 'HOOK',
				label: 'Hook',
				rationale: 'Abre a história.',
			},
		],
		events: [
			{
				id: eventId,
				type,
				startMs,
				durationMs,
				intensity: 4,
				reason: 'Teste de render da direção.',
				assetId: null,
				cueId: null,
				status: 'ACCEPTED',
			},
		],
		cta: null,
		previousCta: null,
		acceptedEventIds: [eventId],
		planHash: null,
		note: '',
	};
}

describe('render composition command', () => {
	it('builds a deterministic 120s H.264 command for 15 clips', () => {
		const plan = buildDefaultEditPlan(context());
		const command = buildRenderCommand(plan, inputs(plan), '/tmp/out.mp4', { vhsIntensity: 1 });
		expect(command.inputPaths).toHaveLength(15);
		expect(command.args.filter((value) => value === '-i')).toHaveLength(15);
		expect(command.args).toContain('libx264');
		expect(command.args).toContain('+faststart');
		expect(command.args).toContain('120.000');
		expect(command.filterGraph).toContain('scale=1080:1920');
		expect(command.filterGraph).toContain('noise=alls=8');
		expect(command.filterGraph).toContain('concat=n=15');
		expect(command.filterGraph).toContain('[outv]');
	});

	it('applies per-clip color filters and respects scene exclusions', () => {
		const plan = buildDefaultEditPlan(context());
		const color = {
			presetId: 'cursed_tape' as const,
			presetVersion: 1 as const,
			strength: 80,
			referenceClipId: null,
			overrides: [{ clipId: plan.clips[1]!.id, strength: 80, exclude: true }],
		};
		const command = buildRenderCommand({ ...plan, color }, inputs(plan), '/tmp/out.mp4');
		expect(command.filterGraph).toContain('eq=brightness=0.016');
		const secondClipFilter =
			command.filterGraph.split(';').find((segment) => segment.includes('[v1]')) ?? '';
		expect(secondClipFilter).not.toContain('colorbalance=');
	});

	it('resolves per-clip color by clip id when plan.clips is out of order', () => {
		const plan = buildDefaultEditPlan(context());
		const chronologicalFirst = plan.clips[0]!;
		const chronologicalSecond = plan.clips[1]!;
		const shuffled = {
			...plan,
			clips: [chronologicalSecond, chronologicalFirst, ...plan.clips.slice(2)],
			color: {
				presetId: 'cursed_tape' as const,
				presetVersion: 1 as const,
				strength: 80,
				referenceClipId: null,
				overrides: [{ clipId: chronologicalFirst.id, strength: 80, exclude: true }],
			},
		};
		const command = buildRenderCommand(shuffled, inputs(plan), '/tmp/out.mp4');
		const filterFor = (label: string) =>
			command.filterGraph
				.split(';')
				.find((segment) => segment.includes('trim=') && segment.includes(`[${label}]`)) ?? '';
		expect(filterFor('v0')).not.toContain('colorbalance=');
		expect(filterFor('v1')).toContain('colorbalance=');
	});

	it('supports the 720p fallback and the high quality tier', () => {
		const plan = buildDefaultEditPlan(context());
		const command = buildRenderCommand(plan, inputs(plan), '/tmp/out.mp4', {
			width: 720,
			height: 1280,
			quality: 'high',
			threads: 1,
		});
		expect(command.filterGraph).toContain('scale=720:1280');
		expect(command.filterGraph).toContain('crop=720:1280');
		expect(command.args).toContain('slow');
		expect(command.args).toContain('18');
		expect(command.args.join(' ')).toContain('-threads 1');
		expect(command.args.join(' ')).toContain('-filter_threads 1');
		expect(() =>
			buildRenderCommand(plan, inputs(plan), '/tmp/out.mp4', { width: 1080, height: 1280 }),
		).toThrow(RenderCompositionError);
		expect(() => buildRenderCommand(plan, inputs(plan), '/tmp/out.mp4', { threads: 0 })).toThrow(
			RenderCompositionError,
		);
	});

	it('uses xfade for a crossfade between segments', () => {
		const plan = buildDefaultEditPlan(context());
		const clips = retimeClips([
			plan.clips[0]!,
			{ ...plan.clips[1]!, transition: 'crossfade' as const, transitionMs: 500 },
			...plan.clips.slice(2),
		]);
		const command = buildRenderCommand({ ...plan, clips }, inputs(plan), '/tmp/out.mp4');
		expect(command.filterGraph).toContain('xfade=transition=fade:duration=0.500:offset=7.500');
		expect(command.filterGraph).toContain('concat=n=14');
	});

	it('rejects missing/short assets and unsafe output paths', () => {
		const plan = buildDefaultEditPlan(context());
		expect(() => buildRenderCommand(plan, inputs(plan).slice(1), '/tmp/out.mp4')).toThrow(
			RenderCompositionError,
		);
		expect(() =>
			buildRenderCommand(
				plan,
				inputs(plan).map((input, index) => (index === 0 ? { ...input, durationMs: 1_000 } : input)),
				'/tmp/out.mp4',
			),
		).toThrow(RenderCompositionError);
		expect(() => buildRenderCommand(plan, inputs(plan), '/tmp/../out.mp4')).toThrow(
			RenderCompositionError,
		);
	});
});

describe('director render windows', () => {
	it('applies the VHS color shift only inside accepted VHS_STATIC windows', () => {
		const plan = buildDefaultEditPlan(context());
		const director = directorWith('VHS_STATIC', 10_000, 500);
		const durationMs = directorEventDuration(director, director.events[0]!);
		const command = buildRenderCommand({ ...plan, director }, inputs(plan), '/tmp/out.mp4');
		expect(command.filterGraph).toContain(
			`eq=contrast=1.35:brightness=0.03:saturation=0.45:enable='between(t,10.000,${((10_000 + durationMs) / 1_000).toFixed(3)})'`,
		);
	});

	it('burns a standalone end-card ASS after captions and rejects unsafe names', () => {
		const plan = buildDefaultEditPlan(context());
		const command = buildRenderCommand(plan, inputs(plan), '/tmp/out.mp4', {
			captionAssFile: 'captions.ass',
			endCardAssFile: 'endcard.ass',
		});
		expect(command.filterGraph).toContain('ass=filename=captions.ass[captioned]');
		expect(command.filterGraph).toContain('[captioned]ass=filename=endcard.ass[endcard]');
		expect(() =>
			buildRenderCommand(plan, inputs(plan), '/tmp/out.mp4', {
				endCardAssFile: '../endcard.ass',
			}),
		).toThrow(RenderCompositionError);
	});

	it('can mute narration only during the end card', () => {
		const command = buildAudioMixCommand({
			videoPath: '/tmp/output.mp4',
			outputPath: '/tmp/final.mp4',
			videoDurationMs: 120_000,
			narration: { path: '/tmp/voice.wav', durationMs: 120_000 },
			events: [
				{
					id: '44444444-4444-4444-8444-444444444444',
					path: '/tmp/endcard.wav',
					kind: 'SFX',
					startMs: 114_000,
					durationMs: 6_000,
					sourceInMs: 0,
					gainDb: 0,
					fadeInMs: 60,
					fadeOutMs: 120,
					pan: 0,
					distance: 0.5,
					loop: false,
					ducking: false,
					spatialPreset: 'none',
					spatialMode: 'stereo_pan',
					intensity: 1,
				},
			],
			narrationMuteWindows: [{ startMs: 114_000, durationMs: 6_000 }],
		});
		const graph = command.args[command.args.indexOf('-filter_complex') + 1]!;
		expect(graph).toContain("[narrbase]volume=0:enable='between(t,114.000,120.000)'[narrmute]");
		expect(graph).toContain('[narrmute]');
	});

	it('duck-mutes music only inside accepted silence windows', () => {
		const command = buildAudioMixCommand({
			videoPath: '/tmp/output.mp4',
			outputPath: '/tmp/final.mp4',
			videoDurationMs: 120_000,
			events: [
				{
					id: '44444444-4444-4444-8444-444444444444',
					path: '/tmp/music.wav',
					kind: 'MUSIC',
					startMs: 0,
					durationMs: 120_000,
					sourceInMs: 0,
					gainDb: -18,
					fadeInMs: 0,
					fadeOutMs: 0,
					pan: 0,
					distance: 0,
					loop: true,
					ducking: false,
					spatialPreset: 'none',
					spatialMode: 'stereo_pan',
					intensity: 3,
				},
			],
			silenceWindows: [{ startMs: 10_000, durationMs: 1_500 }],
		});
		const graph = command.args[command.args.indexOf('-filter_complex') + 1]!;
		expect(graph).toContain("[unduckedbus]volume=0:enable='between(t,10.000,11.500)'");
	});

	it('ignores proposed or rejected director windows', () => {
		const plan = buildDefaultEditPlan(context());
		const director = directorWith('VHS_STATIC', 10_000, 1_500);
		const proposed = {
			...director,
			acceptedEventIds: [],
			events: director.events.map((event) => ({ ...event, status: 'PROPOSED' as const })),
		};
		const command = buildRenderCommand(
			{ ...plan, director: proposed },
			inputs(plan),
			'/tmp/out.mp4',
		);
		expect(command.filterGraph).not.toContain('eq=contrast=1.35');
	});
});

describe('narration mux command', () => {
	it('copies video, pads audio to the exact duration and reports timing', () => {
		const command = buildNarrationMuxCommand({
			videoPath: '/tmp/output.mp4',
			narrationPath: '/tmp/voice.wav',
			outputPath: '/tmp/final.mp4',
			videoDurationMs: 120_000,
			narrationDurationMs: 100_000,
			volumeDb: -1.5,
		});
		expect(command.paddedMs).toBe(20_000);
		expect(command.trimmedMs).toBe(0);
		expect(command.args).toContain('copy');
		expect(command.args).toContain('aac');
		expect(command.args).toContain('48000');
		expect(command.args).toContain('2');
		expect(command.args).toContain('120.000');
		expect(command.args.filter((value) => value === '-i')).toHaveLength(2);
		const af = command.args[command.args.indexOf('-af') + 1];
		expect(af).toContain('volume=-1.5dB');
		expect(af).toContain('apad=whole_dur=120.000');
		expect(af).toContain('atrim=0:120.000');
	});

	it('allows tolerance-level overflow but rejects hidden speech loss', () => {
		expect(
			buildNarrationMuxCommand({
				videoPath: '/tmp/output.mp4',
				narrationPath: '/tmp/voice.wav',
				outputPath: '/tmp/final.mp4',
				videoDurationMs: 120_000,
				narrationDurationMs: 120_200,
			}).trimmedMs,
		).toBe(200);
		expect(() =>
			buildNarrationMuxCommand({
				videoPath: '/tmp/output.mp4',
				narrationPath: '/tmp/voice.wav',
				outputPath: '/tmp/final.mp4',
				videoDurationMs: 120_000,
				narrationDurationMs: 121_000,
			}),
		).toThrow('A narração excede o vídeo em 750 ms.');
		expect(() =>
			buildNarrationMuxCommand({
				videoPath: '/tmp/output.mp4',
				narrationPath: '/tmp/voice.wav',
				outputPath: '/tmp/final.mp4',
				videoDurationMs: 120_000,
				narrationDurationMs: 10_000,
			}),
		).toThrow('A narração cobre menos da metade do vídeo');
	});

	it('rejects unsafe paths and invalid durations', () => {
		expect(() =>
			buildNarrationMuxCommand({
				videoPath: '/tmp/output.mp4',
				narrationPath: '/tmp/voice.wav',
				outputPath: '/tmp/../final.mp4',
				videoDurationMs: 120_000,
				narrationDurationMs: 100_000,
			}),
		).toThrow(RenderCompositionError);
		expect(() =>
			buildNarrationMuxCommand({
				videoPath: '/tmp/output.mp4',
				narrationPath: '/tmp/voice.wav',
				outputPath: '/tmp/final.mp4',
				videoDurationMs: 120_000,
				narrationDurationMs: 0,
			}),
		).toThrow('Duração da narração ou do vídeo inválida.');
	});
});

describe('render ordering and gaps', () => {
	it('uses the sorted clip source trims when the stored array is shuffled', () => {
		const plan = buildDefaultEditPlan(context());
		const clipped = plan.clips.map((clip, index) => ({
			...clip,
			sourceInMs: index * 100,
			sourceOutMs: index * 100 + 8_000,
		}));
		const shuffled = [...clipped].reverse();
		const command = buildRenderCommand(
			{ ...plan, clips: shuffled },
			plan.clips.map((clip) => ({
				assetId: clip.assetId,
				path: `/tmp/${clip.assetId}.mp4`,
				durationMs: 10_000,
				width: 1080,
				height: 1920,
			})),
			'/tmp/out.mp4',
		);
		const trims = [...command.filterGraph.matchAll(/trim=start=([0-9.]+)/g)].map(
			(match) => match[1],
		);
		expect(trims[0]).toBe('0.000');
		expect(trims[1]).toBe('0.100');
		expect(trims[14]).toBe('1.400');
	});

	it('rejects a timeline with a gap instead of silently compressing it', () => {
		const plan = buildDefaultEditPlan(context());
		const clips = plan.clips.map((clip, index) =>
			index === 1
				? {
						...clip,
						timelineStartMs: clip.timelineStartMs + 2_000,
						timelineEndMs: clip.timelineEndMs + 2_000,
					}
				: clip,
		);
		expect(() => buildRenderCommand({ ...plan, clips }, inputs(plan), '/tmp/out.mp4')).toThrow(
			'A timeline tem lacuna ou offset não suportado pelo render.',
		);
	});
});
