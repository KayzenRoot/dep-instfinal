import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { applyHookVariant } from '#lib/domain/hook-lab.js';
import { manifestHash } from '#lib/server/video-edit-plans.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data: variant, error } = await db
		.from('hook_variants')
		.select('*')
		.eq('owner_id', owner.id)
		.eq('id', event.params.variantId)
		.maybeSingle();
	if (error || !variant) return json({ error: 'HOOK_NOT_FOUND' }, { status: 404 });
	const { data: versionRow } = await db
		.from('video_edit_plan_versions')
		.select('plan,manifest_hash')
		.eq('owner_id', owner.id)
		.eq('plan_id', variant.plan_id)
		.eq('version', variant.plan_version)
		.maybeSingle();
	const parsed = versionRow ? videoEditPlanSchema.safeParse(versionRow.plan) : null;
	if (!versionRow || !parsed?.success)
		return json({ error: 'HOOK_SOURCE_MISSING' }, { status: 409 });
	const derived = applyHookVariant(parsed.data, variant.opening_clip_id);
	const payload = {
		schemaVersion: 1,
		variantId: variant.id,
		variantKey: variant.variant_key,
		label: variant.label,
		objective: variant.objective,
		sourcePlanId: variant.plan_id,
		sourcePlanVersion: variant.plan_version,
		sourcePlanSha256: versionRow.manifest_hash,
		derivedPlanSha256: manifestHash(derived),
		openingClipId: variant.opening_clip_id,
		openingAssetId: variant.opening_asset_id,
		openingClipIndex: variant.opening_clip_index,
		openingSourceStartMs: variant.opening_start_ms,
		openingSourceEndMs: variant.opening_end_ms,
		clipOrder: derived.clips.map((clip) => clip.id),
		score: variant.score,
		reasons: variant.reasons,
		disclaimer:
			'Score heurístico; não mede retenção. Aplicar a variante cria uma nova versão DRAFT que exige aprovar o plano e reaprovar as legendas antes do render.',
		nextSteps: [
			'Aplicar a variante no Hook Lab.',
			'Aprovar o novo plano na timeline.',
			'Reaprovar as legendas para a nova versão.',
			'Renderizar e revisar o MP4 no aparelho.',
		],
		generatedAt: new Date().toISOString(),
	};
	return json(payload, {
		headers: {
			'cache-control': 'private, no-store',
			'content-disposition': `attachment; filename="hook-${variant.variant_key}-${String(variant.id).slice(0, 8)}.json"`,
		},
	});
};
