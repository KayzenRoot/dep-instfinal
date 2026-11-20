import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadOwnerEpisodeSelection } from '#lib/server/episode-options.js';
import {
	CoverError,
	loadCoverContext,
	loadCoverRevision,
	restoreCoverRevision,
	saveCoverRevision,
} from '#lib/server/cover.js';
import {
	COVER_TEMPLATE_IDS,
	coverConfigSchema,
	type CoverConfig,
	type CoverTemplateId,
} from '#lib/schemas/cover.js';

function actionError(cause: unknown) {
	if (cause instanceof CoverError) return fail(cause.status, { message: cause.message });
	return fail(503, { message: 'Não foi possível processar as capas.' });
}

function readRevision(form: FormData, key: string): number | null {
	const raw = readFormText(form, key);
	if (!/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function configFromForm(
	form: FormData,
	episodeId: string,
	seriesTitle: string,
	templateId: CoverTemplateId,
): CoverConfig {
	const format = readFormText(form, 'format') || '9:16';
	const frameAssetId = readFormText(form, 'frameAssetId');
	return coverConfigSchema.parse({
		schemaVersion: 1,
		templateId,
		templateVersion: 1,
		format,
		frameAssetId: frameAssetId || null,
		title: readFormText(form, 'title'),
		subtitle: readFormText(form, 'subtitle'),
		badge: readFormText(form, 'badge'),
		seriesTitle,
		focusX: Number(readFormText(form, 'focusX') || 0.5),
		focusY: Number(readFormText(form, 'focusY') || 0.5),
		watermark: readFormText(form, 'watermark') === 'on',
	});
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
			defaultTitle: '',
			notice: null,
			loadError: 'Crie um episódio e vincule frames antes de gerar capas.',
		};
	let context;
	try {
		context = await loadCoverContext(db, owner, selectedEpisode.id);
	} catch (cause) {
		if (cause instanceof CoverError)
			return {
				episodes,
				selectedEpisode,
				context: null,
				defaultTitle: '',
				defaultSubtitle: '',
				defaultBadge: '',
				notice: null,
				loadError: cause.message,
			};
		throw cause;
	}
	const generated = Number(event.url.searchParams.get('generated') ?? '');
	const approved = Number(event.url.searchParams.get('approved') ?? '');
	const restored = Number(event.url.searchParams.get('restored') ?? '');
	const notice =
		Number.isSafeInteger(generated) && generated > 0
			? { mode: 'generated' as const, value: generated }
			: Number.isSafeInteger(approved) && approved > 0
				? { mode: 'approved' as const, value: approved }
				: Number.isSafeInteger(restored) && restored > 0
					? { mode: 'restored' as const, value: restored }
					: null;
	const latestConfig = context?.revisions[0]?.config;
	return {
		episodes,
		selectedEpisode,
		context,
		defaultTitle: latestConfig?.title ?? context?.episode.title ?? '',
		defaultSubtitle: latestConfig?.subtitle ?? '',
		defaultBadge:
			latestConfig?.badge ?? `E${String(context?.episode.number ?? 1).padStart(2, '0')}`,
		notice,
		loadError: null,
	};
};

export const actions: Actions = {
	generate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const expectedRevision = readRevision(form, 'expectedRevision');
		if (!episodeId || expectedRevision === null)
			return fail(400, { message: 'Episódio ou revisão inválidos. Recarregue a página.' });
		const context = await loadCoverContext(db, owner, episodeId);
		if (!context) return fail(404, { message: 'Episódio não encontrado.' });
		const templates = form
			.getAll('templates')
			.map(String)
			.filter((value): value is CoverTemplateId =>
				(COVER_TEMPLATE_IDS as readonly string[]).includes(value),
			);
		const selected: CoverTemplateId[] = templates.length
			? [...new Set(templates)]
			: ['noir', 'vhs_polaroid', 'archive'];
		try {
			let revision = expectedRevision;
			for (const templateId of selected) {
				let config: CoverConfig;
				try {
					config = configFromForm(form, episodeId, context.episode.seriesTitle, templateId);
				} catch {
					return fail(400, { message: 'Título, formato ou foco da capa inválidos.' });
				}
				revision = await saveCoverRevision({
					db,
					adminDb: createSupabaseAdminClient(),
					owner,
					episodeId,
					expectedRevision: revision,
					config,
				});
			}
			redirect(303, `/app/covers?episodeId=${episodeId}&generated=${selected.length}`);
		} catch (cause) {
			if (cause instanceof CoverError) return actionError(cause);
			throw cause;
		}
	},
	approve: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const revisionId = readFormText(form, 'revisionId');
		const expectedRevision = readRevision(form, 'expectedRevision');
		if (!revisionId || expectedRevision === null)
			return fail(400, { message: 'Revisão inválida.' });
		const revision = await loadCoverRevision(db, owner, revisionId);
		if (!revision) return fail(404, { message: 'Capa não encontrada.' });
		try {
			const version = await saveCoverRevision({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId: revision.episodeId,
				expectedRevision,
				config: revision.config,
				status: 'APPROVED',
			});
			redirect(303, `/app/covers?episodeId=${revision.episodeId}&approved=${version}`);
		} catch (cause) {
			if (cause instanceof CoverError) return actionError(cause);
			throw cause;
		}
	},
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const revisionId = readFormText(form, 'revisionId');
		const expectedRevision = readRevision(form, 'expectedRevision');
		if (!revisionId || expectedRevision === null)
			return fail(400, { message: 'Revisão inválida.' });
		const revision = await loadCoverRevision(db, owner, revisionId);
		if (!revision) return fail(404, { message: 'Capa não encontrada.' });
		try {
			const version = await restoreCoverRevision({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				revisionId,
				expectedRevision,
			});
			redirect(303, `/app/covers?episodeId=${revision.episodeId}&restored=${version}`);
		} catch (cause) {
			if (cause instanceof CoverError) return actionError(cause);
			throw cause;
		}
	},
};
