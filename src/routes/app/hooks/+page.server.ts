import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadOwnerEpisodeOptions } from '#lib/server/episode-options.js';
import { loadEditPlan } from '#lib/server/video-edit-plans.js';
import {
	applyVariantAsPlan,
	generateHookVariants,
	HookLabError,
	listEpisodeHookVariants,
	revertHookVariant,
} from '#lib/server/hook-lab.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';

function actionError(cause: unknown) {
	if (cause instanceof HookLabError) return fail(cause.status, { message: cause.message });
	return fail(503, { message: 'Não foi possível processar o Hook Lab.' });
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
			variants: [],
			sourcePlanVersion: null,
			loadError: 'Crie um episódio e salve a timeline antes de usar o Hook Lab.',
		};
	const stored = await loadEditPlan(db, owner, selectedEpisode.id).catch(() => null);
	const listing = await listEpisodeHookVariants({
		db,
		owner,
		episodeId: selectedEpisode.id,
	}).catch(() => ({ variants: [], sourcePlanVersion: null }));
	return {
		episodes,
		selectedEpisode,
		plan: stored?.plan
			? { version: stored.plan.current_version, status: stored.plan.current_status }
			: null,
		variants: listing.variants,
		sourcePlanVersion: listing.sourcePlanVersion,
		loadError: null,
	};
};

export const actions: Actions = {
	generate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(episodeId)) return fail(400, { message: 'Episódio inválido.' });
		try {
			const result = await generateHookVariants({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
			});
			return {
				success: 'generated',
				count: result.variants.length,
				limitations: result.limitations.join(' '),
			};
		} catch (cause) {
			return actionError(cause);
		}
	},
	apply: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		const variantId = String(form.get('variantId') ?? '');
		try {
			const version = await applyVariantAsPlan({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				variantId,
			});
			return { success: 'applied', version };
		} catch (cause) {
			return actionError(cause);
		}
	},
	revert: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		const variantId = String(form.get('variantId') ?? '');
		try {
			const version = await revertHookVariant({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				variantId,
			});
			return { success: 'reverted', version };
		} catch (cause) {
			return actionError(cause);
		}
	},
};
