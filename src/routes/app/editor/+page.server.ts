import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadOwnerEpisodeOptions } from '#lib/server/episode-options.js';
import {
	defaultEditPlan,
	loadEditPlan,
	loadEditPlanContext,
	saveVideoEditPlan,
	VideoEditPlanError,
} from '#lib/server/video-edit-plans.js';
import { videoEditPlanSchema } from '#lib/schemas/video-edit-plan.js';
import { EditPlanError } from '#lib/domain/video-edit-plan.js';
import { loadVoicePlan } from '#lib/server/narration.js';
import { loadCaptionTrack } from '#lib/server/captions.js';
import { listRenderJobs } from '#lib/server/render-jobs.js';

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

function messageFor(cause: unknown): { status: number; message: string } {
	if (cause instanceof VideoEditPlanError) return { status: cause.status, message: cause.message };
	if (cause instanceof EditPlanError) return { status: 400, message: cause.message };
	return { status: 503, message: 'Não foi possível salvar o editor.' };
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodes = await loadOwnerEpisodeOptions(db, owner);
	const requestedId = event.url.searchParams.get('episodeId');
	const selectedEpisode =
		episodes.find((episode) => episode.id === requestedId) ?? episodes[0] ?? null;
	if (!selectedEpisode)
		return {
			episodes,
			selectedEpisode: null,
			context: null,
			plan: null,
			storedPlan: null,
			versions: [],
			captions: null,
			narration: null,
			renderJobs: [],
			loadError: 'Crie ou selecione um episódio.',
		};
	try {
		const context = await loadEditPlanContext(db, owner, selectedEpisode.id);
		const stored = await loadEditPlan(db, owner, selectedEpisode.id);
		const plan = stored.plan?.plan ?? defaultEditPlan(context);
		const planVersion = stored.plan?.current_version ?? 0;
		const voice = await loadVoicePlan(db, owner, selectedEpisode.id).catch(() => null);
		const renderJobs = await listRenderJobs({
			db,
			owner,
			episodeId: selectedEpisode.id,
		}).catch(() => []);
		const captionTrack = planVersion
			? await loadCaptionTrack(
					db,
					owner,
					selectedEpisode.id,
					planVersion,
					voice?.plan.takeId ?? undefined,
				).catch(() => null)
			: null;
		return {
			episodes,
			selectedEpisode,
			context,
			plan,
			storedPlan: stored.plan
				? {
						currentVersion: stored.plan.current_version,
						currentStatus: stored.plan.current_status,
						manifestHash: stored.plan.manifest_hash,
					}
				: null,
			versions: stored.versions,
			captions: captionTrack
				? {
						status: captionTrack.status,
						version: captionTrack.currentVersion,
						track: captionTrack.track,
					}
				: null,
			narration: voice
				? {
						status: voice.status,
						takeId: voice.plan.takeId,
						estimatedDurationMs: voice.estimatedDurationMs,
					}
				: null,
			renderJobs,
			loadError: null,
		};
	} catch (cause) {
		return {
			episodes,
			selectedEpisode,
			context: null,
			plan: null,
			storedPlan: null,
			versions: [],
			captions: null,
			narration: null,
			renderJobs: [],
			loadError: cause instanceof Error ? cause.message : 'Não foi possível carregar o editor.',
		};
	}
};

export const actions: Actions = {
	save: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		const plan = parsePlan(readFormText(form, 'plan'));
		if (!plan) return fail(400, { message: 'Plano do editor inválido.' });
		if (!episodeId || plan.episodeId !== episodeId)
			return fail(400, { message: 'O plano pertence a outro episódio.' });
		if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
			return fail(400, { message: 'Versão esperada inválida.' });
		try {
			const version = await saveVideoEditPlan({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion,
				plan,
				changeNote: readFormText(form, 'changeNote') || 'Correções no editor visual',
			});
			return { success: true, version };
		} catch (cause) {
			const mapped = messageFor(cause);
			return fail(mapped.status, { message: mapped.message });
		}
	},
};
