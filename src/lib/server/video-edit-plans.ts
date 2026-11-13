import { createHash } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	buildDefaultEditPlan,
	canonicalEditPlanJson,
	EditPlanError,
	validateEditPlan,
	type EditPlanContext,
} from '#lib/domain/video-edit-plan.js';
import { videoEditPlanSchema, type VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

export class VideoEditPlanError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'VideoEditPlanError';
	}
}

export interface StoredEditPlan {
	id: string;
	current_version: number;
	current_status: 'DRAFT' | 'APPROVED' | 'RENDERED';
	plan: VideoEditPlan;
	manifest_hash: string;
	updated_at: string;
}

export interface EditPlanVersionSummary {
	id: string;
	version: number;
	change_note: string;
	manifest_hash: string;
	created_at: string;
}

function mapRpcError(error: { code?: string; message?: string }): VideoEditPlanError {
	const code = error.code ?? '';
	if (code === '40001') {
		return new VideoEditPlanError(
			409,
			'EDIT_PLAN_VERSION_CONFLICT',
			'O plano foi alterado em outra aba. Recarregue antes de salvar.',
		);
	}
	if (code === '55000') {
		return new VideoEditPlanError(
			409,
			'EDIT_PLAN_IMMUTABLE',
			'Episódio publicado ou plano imutável não pode ser editado.',
		);
	}
	if (code === 'P0002') {
		return new VideoEditPlanError(404, 'EDIT_PLAN_NOT_FOUND', 'Plano não encontrado.');
	}
	if (code === '23514') {
		return new VideoEditPlanError(400, 'EDIT_PLAN_INVALID', 'Plano de edição inválido.');
	}
	return new VideoEditPlanError(503, 'EDIT_PLAN_SAVE_FAILED', 'Não foi possível salvar o plano.');
}

export async function loadEditPlanContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<EditPlanContext> {
	const [episodeResult, scenesResult, assetsResult, revisionResult] = await Promise.all([
		db
			.from('episodes')
			.select('id,duration_ms,scene_duration_ms,status')
			.eq('id', episodeId)
			.eq('owner_id', owner.id)
			.maybeSingle(),
		db
			.from('scenes')
			.select('id,scene_index,start_ms,end_ms')
			.eq('episode_id', episodeId)
			.eq('owner_id', owner.id)
			.order('scene_index'),
		db
			.from('video_assets')
			.select('id,scene_id,asset_version,duration_ms,status')
			.eq('episode_id', episodeId)
			.eq('owner_id', owner.id)
			.eq('status', 'READY')
			.order('asset_version', { ascending: false }),
		db
			.from('episode_revisions')
			.select('revision_number')
			.eq('episode_id', episodeId)
			.eq('owner_id', owner.id)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);
	if (episodeResult.error || !episodeResult.data)
		throw new VideoEditPlanError(404, 'EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	if (scenesResult.error || assetsResult.error || revisionResult.error)
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_CONTEXT_FAILED',
			'Não foi possível carregar a timeline.',
		);
	const episode = episodeResult.data as {
		id: string;
		duration_ms: number;
		scene_duration_ms: number;
		status: string;
	};
	const sceneDurationMs = episode.scene_duration_ms;
	if (![4_000, 6_000, 8_000].includes(sceneDurationMs))
		throw new VideoEditPlanError(
			409,
			'EDIT_PLAN_SCENE_DURATION_INVALID',
			'Duração de cena inválida.',
		);
	if (!Array.isArray(scenesResult.data) || scenesResult.data.length === 0)
		throw new VideoEditPlanError(409, 'EDIT_PLAN_SCENES_EMPTY', 'O episódio não tem cenas.');
	const assets = (assetsResult.data ?? [])
		.filter((asset) => typeof asset.duration_ms === 'number')
		.map((asset) => ({
			id: asset.id as string,
			sceneId: asset.scene_id as string,
			assetVersion: asset.asset_version as number,
			durationMs: asset.duration_ms as number,
		}));
	const revisionNumber =
		typeof revisionResult.data?.revision_number === 'number'
			? (revisionResult.data.revision_number as number)
			: null;
	return {
		episodeId: episode.id,
		episodeRevisionNumber: revisionNumber,
		durationMs: episode.duration_ms,
		sceneDurationMs: sceneDurationMs as 4_000 | 6_000 | 8_000,
		scenes: scenesResult.data.map((scene) => ({
			id: scene.id as string,
			sceneIndex: scene.scene_index as number,
			startMs: scene.start_ms as number,
			endMs: scene.end_ms as number,
		})),
		assets,
	};
}

export async function loadEditPlan(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<{ plan: StoredEditPlan | null; versions: EditPlanVersionSummary[] }> {
	const { data, error } = await db
		.from('video_edit_plans')
		.select('id,current_version,current_status,plan,manifest_hash,updated_at')
		.eq('owner_id', owner.id)
		.eq('episode_id', episodeId)
		.maybeSingle();
	if (error)
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_LOAD_FAILED',
			'Não foi possível carregar o plano.',
		);
	if (!data) return { plan: null, versions: [] };
	const parsed = videoEditPlanSchema.safeParse(data.plan);
	if (!parsed.success)
		throw new VideoEditPlanError(500, 'EDIT_PLAN_STORED_INVALID', 'O plano armazenado é inválido.');
	if (manifestHash(parsed.data) !== data.manifest_hash)
		throw new VideoEditPlanError(
			500,
			'EDIT_PLAN_HASH_MISMATCH',
			'O hash do plano armazenado não confere.',
		);
	const { data: versionRows, error: versionsError } = await db
		.from('video_edit_plan_versions')
		.select('id,version,change_note,manifest_hash,created_at')
		.eq('owner_id', owner.id)
		.eq('plan_id', data.id)
		.order('version', { ascending: false })
		.limit(50);
	if (versionsError)
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_LOAD_FAILED',
			'Não foi possível carregar as versões.',
		);
	return {
		plan: {
			id: data.id as string,
			current_version: data.current_version as number,
			current_status: data.current_status as StoredEditPlan['current_status'],
			plan: parsed.data,
			manifest_hash: data.manifest_hash as string,
			updated_at: data.updated_at as string,
		},
		versions: (versionRows ?? []) as EditPlanVersionSummary[],
	};
}

export function defaultEditPlan(context: EditPlanContext): VideoEditPlan {
	return buildDefaultEditPlan(context);
}

export function manifestHash(plan: VideoEditPlan): string {
	return createHash('sha256').update(canonicalEditPlanJson(plan)).digest('hex');
}

export function validateForContext(plan: VideoEditPlan, context: EditPlanContext): VideoEditPlan {
	try {
		return validateEditPlan(plan, context);
	} catch (error) {
		if (error instanceof EditPlanError)
			throw new VideoEditPlanError(400, error.code, error.message);
		throw error;
	}
}

export async function saveVideoEditPlan(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	expectedVersion: number;
	plan: VideoEditPlan;
	changeNote?: string;
}): Promise<number> {
	const context = await loadEditPlanContext(input.db, input.owner, input.episodeId);
	const plan = validateForContext(input.plan, context);
	if (!input.adminDb)
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_WRITE_UNAVAILABLE',
			'O writer do plano não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('save_video_edit_plan', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_expected_version: input.expectedVersion,
		p_plan: plan,
		p_manifest_hash: manifestHash(plan),
		p_change_note: input.changeNote ?? '',
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new VideoEditPlanError(503, 'EDIT_PLAN_SAVE_FAILED', 'O servidor não retornou a versão.');
	return data;
}

export async function restoreVideoEditPlan(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	version: number;
	expectedVersion: number;
	changeNote?: string;
}): Promise<number> {
	const context = await loadEditPlanContext(input.db, input.owner, input.episodeId);
	const { data: source, error: sourceError } = await input.db
		.from('video_edit_plan_versions')
		.select('plan,manifest_hash')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('version', input.version)
		.maybeSingle();
	if (sourceError || !source)
		throw new VideoEditPlanError(404, 'EDIT_PLAN_VERSION_NOT_FOUND', 'Versão não encontrada.');
	const parsedSource = videoEditPlanSchema.safeParse(source.plan);
	if (!parsedSource.success)
		throw new VideoEditPlanError(
			409,
			'EDIT_PLAN_STORED_INVALID',
			'A versão armazenada é inválida.',
		);
	validateForContext(parsedSource.data, context);
	if (manifestHash(parsedSource.data) !== source.manifest_hash)
		throw new VideoEditPlanError(409, 'EDIT_PLAN_HASH_MISMATCH', 'O hash da versão não confere.');
	if (!input.adminDb)
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_WRITE_UNAVAILABLE',
			'O writer do plano não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('restore_video_edit_plan', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_version: input.version,
		p_expected_version: input.expectedVersion,
		p_change_note: input.changeNote ?? '',
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_RESTORE_FAILED',
			'O servidor não retornou a versão.',
		);
	return data;
}

export async function setVideoEditPlanStatus(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	expectedVersion: number;
	status: 'DRAFT' | 'APPROVED';
}): Promise<void> {
	if (!input.adminDb)
		throw new VideoEditPlanError(
			503,
			'EDIT_PLAN_WRITE_UNAVAILABLE',
			'O writer do plano não está configurado.',
		);
	const { error } = await input.adminDb.rpc('set_video_edit_plan_status', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_expected_version: input.expectedVersion,
		p_status: input.status,
	});
	if (error) throw mapRpcError(error);
}
