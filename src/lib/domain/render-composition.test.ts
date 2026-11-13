import { describe, expect, it } from 'vitest';
import { buildSceneTimeline } from './timeline.js';
import { buildDefaultEditPlan, retimeClips, type EditPlanContext } from './video-edit-plan.js';
import { buildRenderCommand, RenderCompositionError } from './render-composition.js';

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
