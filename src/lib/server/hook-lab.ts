import type { SupabaseClient, User } from '@supabase/supabase-js';
import { captionTrackSchema, type CaptionTrack } from '#lib/schemas/captions.js';
import { hookVariantDraftSchema, type HookVariantRow } from '#lib/schemas/hook-variants.js';
import { applyHookVariant, buildHookVariants } from '#lib/domain/hook-lab.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';
import {
	loadEditPlan,
	manifestHash,
	restoreVideoEditPlan,
	saveVideoEditPlan,
} from './video-edit-plans.js';

export class HookLabError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'HookLabError';
	}
}

function mapRow(row: Record<string, unknown>): HookVariantRow {
	return {
		id: row.id as string,
		ownerId: row.owner_id as string,
		episodeId: row.episode_id as string,
		planId: row.plan_id as string,
		planVersion: Number(row.plan_version),
		variantKey: row.variant_key as HookVariantRow['variantKey'],
		label: row.label as string,
		objective: row.objective as HookVariantRow['objective'],
		sourcePlanHash: row.source_plan_hash as string,
		openingClipId: row.opening_clip_id as string,
		openingAssetId: row.opening_asset_id as string,
		openingClipIndex: Number(row.opening_clip_index),
		openingStartMs: Number(row.opening_start_ms),
		openingEndMs: Number(row.opening_end_ms),
		premise: row.premise as string,
		score: Number(row.score),
		reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
		status: row.status as HookVariantRow['status'],
		appliedVersion:
			row.applied_version === null || row.applied_version === undefined
				? null
				: Number(row.applied_version),
		appliedAt: (row.applied_at as string | null) ?? null,
		createdAt: row.created_at as string,
	};
}

async function loadCaptionForVersion(
	db: SupabaseClient,
	ownerId: string,
	episodeId: string,
	planVersion: number,
): Promise<CaptionTrack | null> {
	const { data, error } = await db
		.from('caption_tracks')
		.select('track')
		.eq('owner_id', ownerId)
		.eq('episode_id', episodeId)
		.eq('plan_version', planVersion)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error || !data) return null;
	const parsed = captionTrackSchema.safeParse(data.track);
	return parsed.success ? parsed.data : null;
}

export async function listEpisodeHookVariants(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
}): Promise<{ variants: HookVariantRow[]; sourcePlanVersion: number | null }> {
	const { data, error } = await input.db
		.from('hook_variants')
		.select('*')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.order('plan_version', { ascending: false })
		.order('score', { ascending: false })
		.limit(30);
	if (error)
		throw new HookLabError(503, 'HOOK_LIST_FAILED', 'Não foi possível listar as aberturas.');
	const variants = (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
	return {
		variants,
		sourcePlanVersion: variants[0]?.planVersion ?? null,
	};
}

export async function listHookVariants(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	planVersion: number;
}): Promise<HookVariantRow[]> {
	const { data, error } = await input.db
		.from('hook_variants')
		.select('*')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('plan_version', input.planVersion)
		.order('score', { ascending: false });
	if (error)
		throw new HookLabError(503, 'HOOK_LIST_FAILED', 'Não foi possível listar as aberturas.');
	return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function generateHookVariants(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
}): Promise<{ variants: HookVariantRow[]; limitations: string[]; planVersion: number }> {
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan)
		throw new HookLabError(409, 'HOOK_PLAN_MISSING', 'Salve a timeline antes de gerar aberturas.');
	const existing = await listHookVariants({
		db: input.db,
		owner: input.owner,
		episodeId: input.episodeId,
		planVersion: stored.plan.current_version,
	});
	if (existing.length)
		return {
			variants: existing,
			limitations: ['Variantes já geradas para esta versão; aplique uma ou salve uma nova versão.'],
			planVersion: stored.plan.current_version,
		};
	const plan = stored.plan.plan;
	const captions = await loadCaptionForVersion(
		input.db,
		input.owner.id,
		input.episodeId,
		stored.plan.current_version,
	);
	const result = buildHookVariants({ plan, captions });
	if (!result.variants.length)
		throw new HookLabError(
			409,
			'HOOK_MATERIAL_INSUFFICIENT',
			result.limitations[0] ?? 'Material insuficiente para gerar aberturas.',
		);
	if (!input.adminDb)
		throw new HookLabError(
			503,
			'HOOK_WRITER_UNAVAILABLE',
			'O writer do Hook Lab não está configurado.',
		);
	const rows = result.variants.map((variant) => {
		const draft = hookVariantDraftSchema.parse(variant);
		return {
			owner_id: input.owner.id,
			episode_id: input.episodeId,
			plan_id: stored.plan!.id,
			plan_version: stored.plan!.current_version,
			variant_key: draft.variantKey,
			label: draft.label,
			objective: draft.objective,
			source_plan_hash: manifestHash(plan),
			opening_clip_id: draft.openingClipId,
			opening_asset_id: draft.openingAssetId,
			opening_clip_index: draft.openingClipIndex,
			opening_start_ms: draft.openingStartMs,
			opening_end_ms: draft.openingEndMs,
			premise: draft.premise,
			score: draft.score,
			reasons: draft.reasons,
		};
	});
	const { error } = await input.adminDb.from('hook_variants').insert(rows);
	if (error)
		throw new HookLabError(503, 'HOOK_SAVE_FAILED', 'Não foi possível salvar as aberturas.');
	return {
		variants: await listHookVariants({
			db: input.db,
			owner: input.owner,
			episodeId: input.episodeId,
			planVersion: stored.plan.current_version,
		}),
		limitations: result.limitations,
		planVersion: stored.plan.current_version,
	};
}

export async function applyVariantAsPlan(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	variantId: string;
}): Promise<number> {
	const { data, error } = await input.db
		.from('hook_variants')
		.select('*')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('id', input.variantId)
		.maybeSingle();
	if (error || !data) throw new HookLabError(404, 'HOOK_NOT_FOUND', 'Abertura não encontrada.');
	const variant = mapRow(data as Record<string, unknown>);
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan) throw new HookLabError(409, 'HOOK_PLAN_MISSING', 'Plano atual não encontrado.');
	const { data: sourceVersion } = await input.db
		.from('video_edit_plan_versions')
		.select('plan')
		.eq('owner_id', input.owner.id)
		.eq('plan_id', variant.planId)
		.eq('version', variant.planVersion)
		.maybeSingle();
	const sourcePlan = sourceVersion ? videoEditPlanSchema.safeParse(sourceVersion.plan) : null;
	if (!sourcePlan?.success)
		throw new HookLabError(409, 'HOOK_STALE', 'Versão base da abertura não está disponível.');
	const signature = (clips: typeof stored.plan.plan.clips) =>
		clips
			.map((clip) => `${clip.id}:${clip.assetId}:${clip.sourceInMs}:${clip.sourceOutMs}`)
			.sort()
			.join('|');
	if (signature(sourcePlan.data.clips) !== signature(stored.plan.plan.clips))
		throw new HookLabError(
			409,
			'HOOK_STALE',
			'O plano atual tem cortes diferentes da versão base; gere aberturas novamente.',
		);
	if (!stored.plan.plan.clips.some((clip) => clip.id === variant.openingClipId))
		throw new HookLabError(
			409,
			'HOOK_STALE',
			'A cena inicial não existe mais no plano atual; gere novamente.',
		);
	const nextPlan = applyHookVariant(stored.plan.plan, variant.openingClipId);
	const version = await saveVideoEditPlan({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: input.episodeId,
		expectedVersion: stored.plan.current_version,
		plan: nextPlan,
		changeNote: `Hook Lab: ${variant.label}`,
	});
	if (!input.adminDb)
		throw new HookLabError(
			503,
			'HOOK_WRITER_UNAVAILABLE',
			'O writer do Hook Lab não está configurado.',
		);
	await input.adminDb
		.from('hook_variants')
		.update({ status: 'DRAFT', applied_version: null, applied_at: null })
		.eq('owner_id', input.owner.id)
		.eq('plan_id', variant.planId)
		.eq('plan_version', variant.planVersion)
		.eq('status', 'APPLIED');
	await input.adminDb
		.from('hook_variants')
		.update({
			status: 'APPLIED',
			applied_version: version,
			applied_at: new Date().toISOString(),
		})
		.eq('owner_id', input.owner.id)
		.eq('id', variant.id);
	return version;
}

export async function revertHookVariant(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	variantId: string;
}): Promise<number> {
	const { data, error } = await input.db
		.from('hook_variants')
		.select('*')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.eq('id', input.variantId)
		.maybeSingle();
	if (error || !data) throw new HookLabError(404, 'HOOK_NOT_FOUND', 'Abertura não encontrada.');
	const variant = mapRow(data as Record<string, unknown>);
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan) throw new HookLabError(409, 'HOOK_PLAN_MISSING', 'Plano atual não encontrado.');
	const version = await restoreVideoEditPlan({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: input.episodeId,
		version: variant.planVersion,
		expectedVersion: stored.plan.current_version,
		changeNote: `Hook Lab: reverter para a versão base da abertura ${variant.label}`,
	});
	return version;
}
