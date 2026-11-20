import type { RequestEvent } from '@sveltejs/kit';
import { ownerDatabase, readFormText } from './authorized.js';
import { createSupabaseAdminClient } from './supabase.js';
import { saveVideoEditPlan, VideoEditPlanError } from './video-edit-plans.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';
import { EditPlanError } from '#lib/domain/video-edit-plan.js';
import { defaultPreview } from '#lib/domain/platform-preview.js';

export type SavePlanResult =
	{ ok: true; version: number } | { ok: false; status: number; message: string };

function parsePlan(raw: string) {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = videoEditPlanSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function failureFor(cause: unknown): { status: number; message: string } {
	if (cause instanceof VideoEditPlanError) return { status: cause.status, message: cause.message };
	if (cause instanceof EditPlanError) return { status: 400, message: cause.message };
	return { status: 503, message: 'Não foi possível salvar o plano de edição.' };
}

/** Shared server-side save path for every plan editor page. */
export async function savePlanFromForm(
	event: RequestEvent,
	options: { invalidMessage: string; defaultNote: string },
): Promise<SavePlanResult> {
	const { db, owner } = ownerDatabase(event);
	const form = await event.request.formData();
	const episodeId = readFormText(form, 'episodeId');
	const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
	const plan = parsePlan(readFormText(form, 'plan'));
	if (!plan) return { ok: false, status: 400, message: options.invalidMessage };
	if (!episodeId || plan.episodeId !== episodeId)
		return { ok: false, status: 400, message: 'O plano pertence a outro episódio.' };
	if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
		return { ok: false, status: 400, message: 'Versão esperada inválida.' };
	const normalizedPlan = plan.preview ? plan : { ...plan, preview: defaultPreview() };
	try {
		const version = await saveVideoEditPlan({
			db,
			adminDb: createSupabaseAdminClient(),
			owner,
			episodeId,
			expectedVersion,
			plan: normalizedPlan,
			changeNote: readFormText(form, 'changeNote') || options.defaultNote,
			applyStyle: readFormText(form, 'applyStyle') === 'on',
		});
		return { ok: true, version };
	} catch (cause) {
		return { ok: false, ...failureFor(cause) };
	}
}
