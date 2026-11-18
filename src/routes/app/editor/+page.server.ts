import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadOwnerEpisodeOptions } from '#lib/server/episode-options.js';
import {
	defaultEditPlan,
	loadEditPlan,
	loadEditPlanContext,
} from '#lib/server/video-edit-plans.js';
import { loadVoicePlan } from '#lib/server/narration.js';
import { loadCaptionTrack } from '#lib/server/captions.js';
import { listRenderJobs } from '#lib/server/render-jobs.js';
import { savePlanFromForm } from '#lib/server/plan-actions.js';

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
			planStale: false,
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
			planStale: Boolean(
				stored.plan && plan.episodeRevisionNumber !== context.episodeRevisionNumber,
			),
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
			planStale: false,
			loadError: cause instanceof Error ? cause.message : 'Não foi possível carregar o editor.',
		};
	}
};

export const actions: Actions = {
	save: async (event) => {
		const result = await savePlanFromForm(event, {
			invalidMessage: 'Plano do editor inválido.',
			defaultNote: 'Correções no editor visual',
		});
		return result.ok
			? { success: true, version: result.version }
			: fail(result.status, { message: result.message });
	},
};
