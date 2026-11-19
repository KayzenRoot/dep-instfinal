import type { SupabaseClient, User } from '@supabase/supabase-js';
import { colorGradeSchema, type ColorGrade } from '#lib/schemas/color-grade.js';
import { loadEditPlan, saveVideoEditPlan } from './video-edit-plans.js';

export class ColorGradeError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'ColorGradeError';
	}
}

export async function saveColorGrade(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	grade: ColorGrade;
}): Promise<number> {
	const parsed = colorGradeSchema.safeParse(input.grade);
	if (!parsed.success)
		throw new ColorGradeError(400, 'COLOR_GRADE_INVALID', 'Preset ou intensidade inválidos.');
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan)
		throw new ColorGradeError(409, 'COLOR_PLAN_MISSING', 'Salve a timeline antes de aplicar cor.');
	return saveVideoEditPlan({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: input.episodeId,
		expectedVersion: stored.plan.current_version,
		plan: { ...stored.plan.plan, color: parsed.data },
		changeNote: `Color Match: ${parsed.data.presetId} ${parsed.data.strength}%`,
	});
}

export async function clearColorGrade(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
}): Promise<number> {
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan)
		throw new ColorGradeError(
			409,
			'COLOR_PLAN_MISSING',
			'Salve a timeline antes de remover a cor.',
		);
	const plan = structuredClone(stored.plan.plan);
	delete plan.color;
	return saveVideoEditPlan({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: input.episodeId,
		expectedVersion: stored.plan.current_version,
		plan,
		changeNote: 'Color Match: remover correção cromática',
	});
}
