import type { SupabaseClient, User } from '@supabase/supabase-js';
import { colorGradeSchema, type ColorGrade } from '#lib/schemas/color-grade.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
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

function assertColorTargets(plan: VideoEditPlan, grade: ColorGrade): void {
	const clipIds = new Set(plan.clips.map((clip) => clip.id));
	if (grade.referenceClipId && !clipIds.has(grade.referenceClipId))
		throw new ColorGradeError(
			400,
			'COLOR_REFERENCE_UNKNOWN',
			'A cena de referência não pertence ao plano atual.',
		);
	const seen = new Set<string>();
	for (const override of grade.overrides) {
		if (!clipIds.has(override.clipId))
			throw new ColorGradeError(
				400,
				'COLOR_OVERRIDE_UNKNOWN',
				'Um ajuste por cena aponta para um clipe que não existe no plano atual.',
			);
		if (seen.has(override.clipId))
			throw new ColorGradeError(
				400,
				'COLOR_OVERRIDE_DUPLICATE',
				'Cada cena aceita apenas um ajuste de cor.',
			);
		seen.add(override.clipId);
	}
}

export async function saveColorGrade(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	expectedVersion: number;
	grade: ColorGrade;
}): Promise<number> {
	const parsed = colorGradeSchema.safeParse(input.grade);
	if (!parsed.success)
		throw new ColorGradeError(400, 'COLOR_GRADE_INVALID', 'Preset ou intensidade inválidos.');
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan)
		throw new ColorGradeError(409, 'COLOR_PLAN_MISSING', 'Salve a timeline antes de aplicar cor.');
	assertColorTargets(stored.plan.plan, parsed.data);
	return saveVideoEditPlan({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: input.episodeId,
		expectedVersion: input.expectedVersion,
		plan: { ...stored.plan.plan, color: parsed.data },
		changeNote: `Color Match: ${parsed.data.presetId} ${parsed.data.strength}%`,
	});
}

export async function clearColorGrade(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	expectedVersion: number;
}): Promise<number> {
	const stored = await loadEditPlan(input.db, input.owner, input.episodeId);
	if (!stored.plan)
		throw new ColorGradeError(
			409,
			'COLOR_PLAN_MISSING',
			'Salve a timeline antes de remover a cor.',
		);
	const plan = structuredClone(stored.plan.plan);
	if (!plan.color)
		throw new ColorGradeError(
			409,
			'COLOR_ALREADY_CLEAR',
			'Este plano não tem correção cromática para remover.',
		);
	delete plan.color;
	return saveVideoEditPlan({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: input.episodeId,
		expectedVersion: input.expectedVersion,
		plan,
		changeNote: 'Color Match: remover correção cromática',
	});
}
