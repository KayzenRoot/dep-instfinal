import type { EditPlanClip, EditPlanTrack, VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

export class EditPlanError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'EditPlanError';
	}
}

export interface EditPlanScene {
	id: string;
	sceneIndex: number;
	startMs: number;
	endMs: number;
}

export interface EditPlanAsset {
	id: string;
	sceneId: string;
	assetVersion: number;
	durationMs: number;
}

export interface EditPlanContext {
	episodeId: string;
	episodeRevisionNumber: number | null;
	durationMs: number;
	sceneDurationMs: 4_000 | 6_000 | 8_000;
	scenes: EditPlanScene[];
	assets: EditPlanAsset[];
}

const VIDEO_TRACK_ID = 'video-main';

function sortedScenes(context: EditPlanContext): EditPlanScene[] {
	return [...context.scenes].sort((left, right) => left.sceneIndex - right.sceneIndex);
}

function latestAssetByScene(context: EditPlanContext): Map<string, EditPlanAsset> {
	const assets = new Map<string, EditPlanAsset>();
	for (const asset of context.assets) {
		const current = assets.get(asset.sceneId);
		if (!current || asset.assetVersion > current.assetVersion) assets.set(asset.sceneId, asset);
	}
	return assets;
}

export function buildDefaultEditPlan(context: EditPlanContext): VideoEditPlan {
	const scenes = sortedScenes(context);
	if (scenes.length === 0)
		throw new EditPlanError('EDIT_PLAN_SCENES_EMPTY', 'O episódio não tem cenas.');
	const assets = latestAssetByScene(context);
	const clips: EditPlanClip[] = [];
	let cursor = 0;
	for (const scene of scenes) {
		const asset = assets.get(scene.id);
		if (!asset)
			throw new EditPlanError(
				'EDIT_PLAN_ASSET_MISSING',
				`A cena ${scene.sceneIndex} não tem clipe READY.`,
			);
		const durationMs = scene.endMs - scene.startMs;
		if (durationMs <= 0)
			throw new EditPlanError('EDIT_PLAN_SCENE_INVALID', `A cena ${scene.sceneIndex} é inválida.`);
		if (asset.durationMs < durationMs)
			throw new EditPlanError(
				'EDIT_PLAN_ASSET_TOO_SHORT',
				`O clipe da cena ${scene.sceneIndex} é menor que a cena.`,
			);
		clips.push({
			id: asset.id,
			sceneId: scene.id,
			assetId: asset.id,
			trackId: VIDEO_TRACK_ID,
			sourceInMs: 0,
			sourceOutMs: durationMs,
			timelineStartMs: cursor,
			timelineEndMs: cursor + durationMs,
			transition: 'cut',
			transitionMs: 0,
			gainDb: 0,
		});
		cursor += durationMs;
	}
	if (cursor > context.durationMs)
		throw new EditPlanError(
			'EDIT_PLAN_DURATION_EXCEEDED',
			'A timeline excede a duração do episódio.',
		);
	return {
		schemaVersion: 1,
		episodeId: context.episodeId,
		episodeRevisionNumber: context.episodeRevisionNumber,
		durationMs: context.durationMs,
		sceneDurationMs: context.sceneDurationMs,
		fps: 30,
		tracks: [{ id: VIDEO_TRACK_ID, kind: 'video', label: 'Vídeo principal' }],
		clips,
		captions: { template: 'clean' },
		cta: null,
	};
}

function assertInteger(value: number, code: string, message: string): void {
	if (!Number.isInteger(value) || value < 0) throw new EditPlanError(code, message);
}

export function retimeClips(clips: EditPlanClip[]): EditPlanClip[] {
	let cursor = 0;
	return clips.map((clip, index) => {
		const duration = clip.sourceOutMs - clip.sourceInMs;
		if (duration <= 0)
			throw new EditPlanError('EDIT_PLAN_TRIM_INVALID', 'O trim do clipe é inválido.');
		if (index > 0 && clip.transition === 'crossfade') {
			if (clip.transitionMs < 1 || clip.transitionMs > duration)
				throw new EditPlanError('EDIT_PLAN_TRANSITION_INVALID', 'A transição é inválida.');
			cursor = Math.max(0, cursor - clip.transitionMs);
		}
		const start = cursor;
		const end = start + duration;
		cursor = end;
		return { ...clip, timelineStartMs: start, timelineEndMs: end };
	});
}

export function reorderClips(clips: EditPlanClip[], from: number, to: number): EditPlanClip[] {
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= clips.length)
		throw new EditPlanError('EDIT_PLAN_REORDER_INVALID', 'Posição de reordenação inválida.');
	const boundedTo = Math.max(0, Math.min(clips.length - 1, to));
	const next = [...clips];
	const [moved] = next.splice(from, 1);
	if (!moved) throw new EditPlanError('EDIT_PLAN_REORDER_INVALID', 'Clipe não encontrado.');
	next.splice(boundedTo, 0, moved);
	return next;
}

export function trimClip(
	clip: EditPlanClip,
	sourceInMs: number,
	sourceOutMs: number,
): EditPlanClip {
	assertInteger(sourceInMs, 'EDIT_PLAN_TRIM_INVALID', 'O início do trim é inválido.');
	assertInteger(sourceOutMs, 'EDIT_PLAN_TRIM_INVALID', 'O fim do trim é inválido.');
	if (sourceOutMs <= sourceInMs)
		throw new EditPlanError('EDIT_PLAN_TRIM_INVALID', 'O fim do trim deve ser depois do início.');
	return { ...clip, sourceInMs, sourceOutMs };
}

export function validateEditPlan(plan: VideoEditPlan, context: EditPlanContext): VideoEditPlan {
	if (plan.episodeId !== context.episodeId)
		throw new EditPlanError('EDIT_PLAN_EPISODE_MISMATCH', 'O plano pertence a outro episódio.');
	if (plan.durationMs !== context.durationMs)
		throw new EditPlanError('EDIT_PLAN_DURATION_MISMATCH', 'A duração do plano não confere.');
	if (plan.sceneDurationMs !== context.sceneDurationMs)
		throw new EditPlanError('EDIT_PLAN_SCENE_DURATION_MISMATCH', 'A duração de cena não confere.');

	const trackIds = new Set<string>();
	let videoTracks = 0;
	for (const track of plan.tracks) {
		if (trackIds.has(track.id))
			throw new EditPlanError('EDIT_PLAN_TRACK_DUPLICATE', 'Track duplicada.');
		trackIds.add(track.id);
		if (track.kind === 'video') videoTracks += 1;
	}
	if (videoTracks !== 1)
		throw new EditPlanError(
			'EDIT_PLAN_VIDEO_TRACK_REQUIRED',
			'O plano precisa de uma track de vídeo.',
		);

	const videoTrack = plan.tracks.find((track) => track.kind === 'video') as EditPlanTrack;
	const sceneById = new Map(context.scenes.map((scene) => [scene.id, scene]));
	const assetById = new Map(context.assets.map((asset) => [asset.id, asset]));
	const seenScenes = new Set<string>();
	const seenAssets = new Set<string>();
	const clipsByTrack = new Map<string, EditPlanClip[]>();
	for (const clip of plan.clips) {
		if (!trackIds.has(clip.trackId))
			throw new EditPlanError('EDIT_PLAN_TRACK_UNKNOWN', 'Clipe aponta para track inexistente.');
		assertInteger(clip.sourceInMs, 'EDIT_PLAN_TRIM_INVALID', 'Trim inicial inválido.');
		assertInteger(clip.sourceOutMs, 'EDIT_PLAN_TRIM_INVALID', 'Trim final inválido.');
		assertInteger(clip.timelineStartMs, 'EDIT_PLAN_TIMELINE_INVALID', 'Offset inicial inválido.');
		assertInteger(clip.timelineEndMs, 'EDIT_PLAN_TIMELINE_INVALID', 'Offset final inválido.');
		const duration = clip.sourceOutMs - clip.sourceInMs;
		if (duration <= 0 || clip.timelineEndMs - clip.timelineStartMs !== duration)
			throw new EditPlanError('EDIT_PLAN_TRIM_INVALID', 'Trim e timeline não conferem.');
		if (clip.timelineEndMs > plan.durationMs)
			throw new EditPlanError('EDIT_PLAN_DURATION_EXCEEDED', 'Clipe excede a duração do episódio.');
		const scene = sceneById.get(clip.sceneId);
		if (!scene)
			throw new EditPlanError('EDIT_PLAN_SCENE_FOREIGN', 'Cena não pertence ao episódio.');
		const asset = assetById.get(clip.assetId);
		if (!asset || asset.sceneId !== clip.sceneId)
			throw new EditPlanError('EDIT_PLAN_ASSET_FOREIGN', 'Clipe não usa um asset READY da cena.');
		if (clip.sourceOutMs > asset.durationMs)
			throw new EditPlanError('EDIT_PLAN_SOURCE_OUT_OF_RANGE', 'Trim excede o clipe original.');
		if (seenAssets.has(clip.assetId))
			throw new EditPlanError(
				'EDIT_PLAN_ASSET_DOUBLE_BOOKED',
				'O mesmo clipe foi usado duas vezes.',
			);
		seenAssets.add(clip.assetId);
		if (clip.trackId === videoTrack.id) {
			if (seenScenes.has(clip.sceneId))
				throw new EditPlanError(
					'EDIT_PLAN_SCENE_DOUBLE_BOOKED',
					'A mesma cena foi usada duas vezes.',
				);
			seenScenes.add(clip.sceneId);
		}
		const list = clipsByTrack.get(clip.trackId) ?? [];
		list.push(clip);
		clipsByTrack.set(clip.trackId, list);
	}
	if (seenScenes.size !== context.scenes.length)
		throw new EditPlanError(
			'EDIT_PLAN_SCENE_MISSING',
			'Todas as cenas precisam estar na timeline.',
		);

	for (const list of clipsByTrack.values()) {
		const ordered = [...list].sort((left, right) => left.timelineStartMs - right.timelineStartMs);
		for (let index = 0; index < ordered.length; index += 1) {
			const clip = ordered[index];
			if (!clip) continue;
			if (clip.transition === 'cut') {
				if (clip.transitionMs !== 0)
					throw new EditPlanError('EDIT_PLAN_TRANSITION_INVALID', 'Corte não tem duração.');
				if (index > 0 && clip.timelineStartMs < (ordered[index - 1]?.timelineEndMs ?? 0))
					throw new EditPlanError('EDIT_PLAN_OVERLAP', 'Clipes se sobrepõem sem crossfade.');
			} else {
				if (index === 0 || clip.transitionMs < 1 || clip.transitionMs > 1_000)
					throw new EditPlanError('EDIT_PLAN_TRANSITION_INVALID', 'Crossfade inválido.');
				const previous = ordered[index - 1];
				if (!previous) continue;
				const previousDuration = previous.sourceOutMs - previous.sourceInMs;
				const duration = clip.sourceOutMs - clip.sourceInMs;
				if (clip.transitionMs > Math.min(previousDuration, duration) / 2)
					throw new EditPlanError('EDIT_PLAN_TRANSITION_INVALID', 'Crossfade longo demais.');
				if (clip.timelineStartMs !== previous.timelineEndMs - clip.transitionMs)
					throw new EditPlanError('EDIT_PLAN_TRANSITION_OFFSET', 'Offset do crossfade inválido.');
			}
		}
	}

	if (plan.cta?.enabled) {
		if (!plan.cta.text)
			throw new EditPlanError('EDIT_PLAN_CTA_INVALID', 'CTA habilitada exige texto.');
		if (plan.cta.endMs <= plan.cta.startMs || plan.cta.endMs > plan.durationMs)
			throw new EditPlanError('EDIT_PLAN_CTA_INVALID', 'Janela da CTA inválida.');
	}

	return {
		...plan,
		clips: plan.clips.map((clip) => ({ ...clip })),
		tracks: plan.tracks.map((track) => ({ ...track })),
	};
}

export function canonicalEditPlanJson(plan: VideoEditPlan): string {
	const sort = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(sort);
		if (value && typeof value === 'object') {
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, entry]) => [key, sort(entry)]),
			);
		}
		return value;
	};
	return JSON.stringify(sort(plan));
}
