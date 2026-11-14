import { describe, expect, it } from 'vitest';
import { buildSceneTimeline } from './timeline.js';
import { buildDefaultEditPlan, retimeClips, type EditPlanContext } from './video-edit-plan.js';
import {
	buildNarrationMuxCommand,
	buildRenderCommand,
	RenderCompositionError,
} from './render-composition.js';

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
