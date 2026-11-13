import { describe, expect, it } from 'vitest';
import { buildSceneTimeline } from './timeline.js';
import {
	buildDefaultEditPlan,
	canonicalEditPlanJson,
	EditPlanError,
	reorderClips,
	retimeClips,
	trimClip,
	validateEditPlan,
	type EditPlanContext,
} from './video-edit-plan.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';

function context(durationMs: number, sceneDurationMs: 4_000 | 6_000 | 8_000): EditPlanContext {
	const scenes = buildSceneTimeline(durationMs, sceneDurationMs).map((scene) => ({
		id: `00000000-0000-4000-8000-${String(scene.index).padStart(12, '0')}`,
		sceneIndex: scene.index,
		startMs: scene.startMs,
		endMs: scene.endMs,
	}));
	return {
		episodeId: '11111111-1111-4111-8111-111111111111',
		episodeRevisionNumber: null,
		durationMs,
		sceneDurationMs,
		scenes,
		assets: scenes.map((scene) => ({
			id: `22222222-2222-4222-8222-${String(scene.sceneIndex).padStart(12, '0')}`,
			sceneId: scene.id,
			assetVersion: 1,
			durationMs: sceneDurationMs,
		})),
	};
}

describe('default video edit plan', () => {
	it('builds 15 contiguous eight-second clips for 120 seconds', () => {
		const context120 = context(120_000, 8_000);
		const plan = buildDefaultEditPlan(context120);
		expect(plan.clips).toHaveLength(15);
		expect(plan.clips[0]).toMatchObject({ timelineStartMs: 0, timelineEndMs: 8_000 });
		expect(plan.clips[14]).toMatchObject({ timelineStartMs: 112_000, timelineEndMs: 120_000 });
		expect(videoEditPlanSchema.parse(plan)).toEqual(plan);
		expect(validateEditPlan(plan, context120)).toEqual(plan);
	});

	it('keeps the last clip partial for 90 and 150 seconds', () => {
		const context90 = context(90_000, 8_000);
		const plan90 = buildDefaultEditPlan(context90);
		expect(plan90.clips).toHaveLength(12);
		expect(plan90.clips.at(-1)).toMatchObject({ sourceOutMs: 2_000, timelineEndMs: 90_000 });

		const context150 = context(150_000, 8_000);
		const plan150 = buildDefaultEditPlan(context150);
		expect(plan150.clips).toHaveLength(19);
		expect(plan150.clips.at(-1)).toMatchObject({ sourceOutMs: 6_000, timelineEndMs: 150_000 });
	});
});

describe('editing and retiming', () => {
	it('reorders clips and recalculates contiguous offsets', () => {
		const context120 = context(120_000, 8_000);
		const plan = buildDefaultEditPlan(context120);
		const reordered = retimeClips(reorderClips(plan.clips, 0, 1));
		expect(reordered[0]?.sceneId).toBe(plan.clips[1]?.sceneId);
		expect(reordered[0]).toMatchObject({ timelineStartMs: 0, timelineEndMs: 8_000 });
		expect(reordered[1]).toMatchObject({ timelineStartMs: 8_000, timelineEndMs: 16_000 });
		expect(validateEditPlan({ ...plan, clips: reordered }, context120).clips).toHaveLength(15);
	});

	it('trims a clip and keeps the selected source duration', () => {
		const context120 = context(120_000, 8_000);
		const plan = buildDefaultEditPlan(context120);
		const trimmed = retimeClips([trimClip(plan.clips[0]!, 1_000, 5_000), ...plan.clips.slice(1)]);
		expect(trimmed[0]).toMatchObject({
			sourceInMs: 1_000,
			sourceOutMs: 5_000,
			timelineEndMs: 4_000,
		});
		expect(trimmed[1]?.timelineStartMs).toBe(4_000);
	});

	it('allows a short crossfade overlap and rejects an excessive one', () => {
		const context120 = context(120_000, 8_000);
		const plan = buildDefaultEditPlan(context120);
		const clips = retimeClips([
			plan.clips[0]!,
			{ ...plan.clips[1]!, transition: 'crossfade' as const, transitionMs: 500 },
			...plan.clips.slice(2),
		]);
		expect(validateEditPlan({ ...plan, clips }, context120).clips[1]).toMatchObject({
			timelineStartMs: 7_500,
			timelineEndMs: 15_500,
		});
		const invalid = clips.map((clip, index) =>
			index === 1 ? { ...clip, transitionMs: 5_000 } : clip,
		);
		expect(() => validateEditPlan({ ...plan, clips: invalid }, context120)).toThrow(EditPlanError);
	});

	it('rejects a foreign asset and a double-booked scene', () => {
		const context120 = context(120_000, 8_000);
		const plan = buildDefaultEditPlan(context120);
		expect(() =>
			validateEditPlan(
				{
					...plan,
					clips: plan.clips.map((clip, index) =>
						index === 0 ? { ...clip, assetId: plan.clips[1]!.assetId } : clip,
					),
				},
				context120,
			),
		).toThrow(EditPlanError);
		expect(() =>
			validateEditPlan(
				{
					...plan,
					clips: plan.clips.map((clip, index) =>
						index === 1 ? { ...clip, sceneId: plan.clips[0]!.sceneId } : clip,
					),
				},
				context120,
			),
		).toThrow(EditPlanError);
	});
});

describe('manifest canonicalization', () => {
	it('is stable when object keys are reordered', () => {
		const plan = buildDefaultEditPlan(context(120_000, 8_000));
		const reordered = {
			...plan,
			tracks: plan.tracks.map((track) => ({
				label: track.label,
				kind: track.kind,
				id: track.id,
			})),
		};
		expect(canonicalEditPlanJson(reordered)).toBe(canonicalEditPlanJson(plan));
	});
});
