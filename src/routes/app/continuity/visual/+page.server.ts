import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadOwnerEpisodeSelection } from '#lib/server/episode-options.js';
import {
	decideVisualContinuity,
	generateVisualContinuityReport,
	loadContinuityInspectorContext,
	VisualContinuityError,
} from '#lib/server/visual-continuity.js';

function actionError(cause: unknown) {
	if (cause instanceof VisualContinuityError) return fail(cause.status, { message: cause.message });
	return fail(503, { message: 'Não foi possível processar a continuidade visual.' });
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { episodes, selectedEpisode } = await loadOwnerEpisodeSelection(
		db,
		owner,
		event.url.searchParams.get('episodeId'),
	);
	if (!selectedEpisode)
		return {
			episodes,
			selectedEpisode: null,
			context: null,
			notice: null,
			loadError: 'Crie um episódio e vincule frames antes de inspecionar a continuidade.',
		};
	let context;
	try {
		context = await loadContinuityInspectorContext(db, owner, selectedEpisode.id);
	} catch (cause) {
		if (cause instanceof VisualContinuityError) {
			return {
				episodes,
				selectedEpisode,
				context: null,
				notice: null,
				loadError: cause.message,
			};
		}
		throw cause;
	}
	const generated = Number(event.url.searchParams.get('generated') ?? '');
	const decided = Number(event.url.searchParams.get('decided') ?? '');
	const notice =
		Number.isSafeInteger(generated) && generated > 0
			? { mode: 'generated' as const, revision: generated }
			: Number.isSafeInteger(decided) && decided > 0
				? { mode: 'decided' as const, revision: decided }
				: null;
	return {
		episodes,
		selectedEpisode,
		context,
		notice,
		loadError: null,
	};
};

export const actions: Actions = {
	generate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		if (!episodeId) return fail(400, { message: 'Episódio inválido.' });
		try {
			const result = await generateVisualContinuityReport({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
			});
			redirect(303, `/app/continuity/visual?episodeId=${episodeId}&generated=${result.revision}`);
		} catch (cause) {
			if (cause instanceof VisualContinuityError) return actionError(cause);
			throw cause;
		}
	},
	decide: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const observationId = readFormText(form, 'observationId');
		const status = readFormText(form, 'status');
		const rationale = readFormText(form, 'rationale');
		const regenerate = readFormText(form, 'regenerate') === 'on';
		if (!episodeId || !observationId) return fail(400, { message: 'Decisão incompleta.' });
		try {
			const revision = await decideVisualContinuity({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				decision: {
					observationId,
					status: status as never,
					rationale,
					action: regenerate ? 'REGENERATE' : 'NONE',
				},
			});
			redirect(303, `/app/continuity/visual?episodeId=${episodeId}&decided=${revision}`);
		} catch (cause) {
			if (cause instanceof VisualContinuityError) return actionError(cause);
			throw cause;
		}
	},
};
