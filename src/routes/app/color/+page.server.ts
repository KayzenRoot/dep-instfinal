import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadOwnerEpisodeOptions } from '#lib/server/episode-options.js';
import { loadEditPlan } from '#lib/server/video-edit-plans.js';
import { clearColorGrade, ColorGradeError, saveColorGrade } from '#lib/server/color-grade.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { colorOverrideSchema, type ColorOverride } from '#lib/schemas/color-grade.js';

function actionError(cause: unknown) {
	if (cause instanceof ColorGradeError) return fail(cause.status, { message: cause.message });
	return fail(503, { message: 'Não foi possível salvar a correção cromática.' });
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
			plan: null,
			color: null,
			clips: [],
			loadError: 'Crie um episódio e salve a timeline antes de aplicar cor.',
		};
	const stored = await loadEditPlan(db, owner, selectedEpisode.id).catch(() => null);
	return {
		episodes,
		selectedEpisode,
		plan: stored?.plan
			? { version: stored.plan.current_version, status: stored.plan.current_status }
			: null,
		color: stored?.plan?.plan.color ?? null,
		clips: (stored?.plan?.plan.clips ?? []).map((clip, index) => ({
			id: clip.id,
			assetId: clip.assetId,
			label: `Cena ${index + 1}`,
			startMs: clip.timelineStartMs,
			endMs: clip.timelineEndMs,
		})),
		loadError: null,
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		const presetId = String(form.get('presetId') ?? 'neutral');
		const strength = Number(form.get('strength') ?? 60);
		const referenceClipId = form.get('referenceClipId');
		let overrides: ColorOverride[] = [];
		try {
			const raw = JSON.parse(String(form.get('overrides') ?? '[]'));
			const parsed = colorOverrideSchema.array().max(60).safeParse(raw);
			if (parsed.success) overrides = parsed.data;
		} catch {
			overrides = [];
		}
		try {
			const version = await saveColorGrade({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				grade: {
					presetId: presetId as never,
					presetVersion: 1,
					strength: Number.isFinite(strength) ? Math.round(strength) : 60,
					referenceClipId:
						typeof referenceClipId === 'string' && referenceClipId.length ? referenceClipId : null,
					overrides,
				},
			});
			return { success: 'saved', version };
		} catch (cause) {
			return actionError(cause);
		}
	},
	clear: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		try {
			const version = await clearColorGrade({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
			});
			return { success: 'cleared', version };
		} catch (cause) {
			return actionError(cause);
		}
	},
};
