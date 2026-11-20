import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadOwnerEpisodeSelection } from '#lib/server/episode-options.js';
import {
	comparePostVariants,
	deletePublishedPost,
	importRetentionCsv,
	loadRetentionContext,
	RetentionServiceError,
	saveAnalyticsSnapshot,
	saveCreativeVariant,
	savePublishedPost,
	saveRetentionExperiment,
} from '#lib/server/retention.js';
import { RETENTION_METRIC_DEFINITIONS, RetentionError } from '#lib/domain/retention.js';

function messageFor(cause: unknown): { status: number; message: string } {
	if (cause instanceof RetentionServiceError)
		return { status: cause.status, message: cause.message };
	if (cause instanceof RetentionError) return { status: 400, message: cause.message };
	return { status: 503, message: 'Não foi possível processar a retenção.' };
}

function rethrowRedirect(cause: unknown): void {
	if (cause && typeof cause === 'object' && 'location' in cause) throw cause;
}

function utcDate(value: string): string {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00Z` : value;
}

function nullableMetric(value: string, integer = true): number | null {
	if (!value.trim()) return null;
	const trimmed = value.trim();
	const pattern = integer ? /^\d+$/ : /^\d+(\.\d+)?$/;
	if (!pattern.test(trimmed))
		throw new RetentionError(
			'RETENTION_NUMBER_INVALID',
			`Valor inválido: "${trimmed}". Use dígitos${integer ? '' : ' e ponto decimal'}, sem separador de milhar.`,
		);
	return Number(trimmed);
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
			metrics: RETENTION_METRIC_DEFINITIONS,
			comparisons: [],
			refs: { hooks: [], covers: [], endCards: [] },
			loadError: 'Crie um episódio antes de registrar publicações.',
			notice: null,
		};
	let context;
	try {
		context = await loadRetentionContext(db, owner, selectedEpisode.id);
	} catch (cause) {
		const info = messageFor(cause);
		return {
			episodes,
			selectedEpisode,
			context: null,
			metrics: RETENTION_METRIC_DEFINITIONS,
			comparisons: [],
			refs: { hooks: [], covers: [], endCards: [] },
			loadError: info.message,
			notice: null,
		};
	}
	if (!context)
		return {
			episodes,
			selectedEpisode,
			context: null,
			metrics: RETENTION_METRIC_DEFINITIONS,
			comparisons: [],
			refs: { hooks: [], covers: [], endCards: [] },
			loadError: 'Episódio não encontrado.',
			notice: null,
		};
	const [hooks, covers, endCards] = await Promise.all([
		db
			.from('hook_variants')
			.select('id,label,variant_key')
			.eq('owner_id', owner.id)
			.eq('episode_id', selectedEpisode.id)
			.order('created_at', { ascending: false })
			.limit(20),
		db
			.from('cover_revisions')
			.select('id,revision_number,template_id,format')
			.eq('owner_id', owner.id)
			.eq('episode_id', selectedEpisode.id)
			.eq('status', 'APPROVED')
			.order('revision_number', { ascending: false })
			.limit(10),
		db
			.from('choice_end_cards')
			.select('id,revision_number,template_id,layout')
			.eq('owner_id', owner.id)
			.eq('episode_id', selectedEpisode.id)
			.eq('status', 'APPROVED')
			.order('revision_number', { ascending: false })
			.limit(10),
	]);
	const metric = RETENTION_METRIC_DEFINITIONS.some(
		(definition) => definition.id === event.url.searchParams.get('metric'),
	)
		? (event.url.searchParams.get('metric') as (typeof RETENTION_METRIC_DEFINITIONS)[number]['id'])
		: 'engagement_rate';
	const comparisons = context.experiments.map((experiment) => ({
		experiment,
		comparison: comparePostVariants(context, experiment, metric),
	}));
	const imported = Number(event.url.searchParams.get('imported') ?? '');
	const skipped = Number(event.url.searchParams.get('skipped') ?? '');
	const errors = Number(event.url.searchParams.get('errors') ?? '');
	const notice =
		Number.isSafeInteger(imported) && (imported > 0 || skipped > 0 || errors > 0)
			? {
					mode: 'imported' as const,
					imported,
					skipped,
					errors,
					detail: (event.url.searchParams.get('detail') ?? '').slice(0, 300),
				}
			: event.url.searchParams.get('saved')
				? { mode: 'saved' as const, imported: 0, skipped: 0, errors: 0, detail: '' }
				: null;
	return {
		episodes,
		selectedEpisode,
		context,
		metrics: RETENTION_METRIC_DEFINITIONS,
		comparisons,
		metric,
		refs: {
			hooks: hooks.data ?? [],
			covers: covers.data ?? [],
			endCards: endCards.data ?? [],
		},
		loadError: null,
		notice,
	};
};

export const actions: Actions = {
	post: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		if (!episodeId) return fail(400, { message: 'Episódio inválido.' });
		try {
			await savePublishedPost({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				postId: readFormText(form, 'postId') || null,
				values: {
					episodeId,
					platform: readFormText(form, 'platform') as never,
					url: readFormText(form, 'url'),
					publishedAt: utcDate(readFormText(form, 'publishedAt')),
					label: readFormText(form, 'label'),
					notes: readFormText(form, 'notes'),
					changeNote: readFormText(form, 'changeNote') || 'Cadastro manual',
				},
			});
			redirect(303, `/app/retention?episodeId=${episodeId}&saved=post`);
		} catch (cause) {
			rethrowRedirect(cause);
			if (cause instanceof Error && cause.name === 'ZodError')
				return fail(400, { message: 'Plataforma, URL ou data inválidas.' });
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	variant: async (event) => {
		const { owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		if (!episodeId) return fail(400, { message: 'Episódio inválido.' });
		try {
			await saveCreativeVariant({
				adminDb: createSupabaseAdminClient(),
				owner,
				values: {
					postId: readFormText(form, 'postId'),
					kind: readFormText(form, 'kind') as never,
					label: readFormText(form, 'label'),
					hookVariantId: readFormText(form, 'hookVariantId') || null,
					coverRevisionId: readFormText(form, 'coverRevisionId') || null,
					endCardId: readFormText(form, 'endCardId') || null,
				},
			});
			redirect(303, `/app/retention?episodeId=${episodeId}&saved=variant`);
		} catch (cause) {
			rethrowRedirect(cause);
			if (cause instanceof Error && cause.name === 'ZodError')
				return fail(400, { message: 'Variante inválida.' });
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	snapshot: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const postId = readFormText(form, 'postId');
		if (!episodeId || !postId) return fail(400, { message: 'Episódio ou publicação inválidos.' });
		try {
			const context = await loadRetentionContext(db, owner, episodeId);
			if (!context) return fail(404, { message: 'Episódio não encontrado.' });
			await saveAnalyticsSnapshot({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				durationMs: context.episode.durationMs,
				values: {
					postId,
					capturedAt: utcDate(readFormText(form, 'capturedAt')),
					periodStart: utcDate(readFormText(form, 'periodStart')),
					periodEnd: utcDate(readFormText(form, 'periodEnd')),
					source: 'MANUAL',
					note: readFormText(form, 'note'),
					supersedesSnapshotId: readFormText(form, 'supersedesSnapshotId') || null,
					metrics: {
						views: nullableMetric(readFormText(form, 'views')),
						likes: nullableMetric(readFormText(form, 'likes')),
						comments: nullableMetric(readFormText(form, 'comments')),
						shares: nullableMetric(readFormText(form, 'shares')),
						saves: nullableMetric(readFormText(form, 'saves')),
						followersGained: nullableMetric(readFormText(form, 'followersGained')),
						avgWatchMs: nullableMetric(readFormText(form, 'avgWatchMs')),
						completionPct: nullableMetric(readFormText(form, 'completionPct'), false),
					},
				},
			});
			redirect(303, `/app/retention?episodeId=${episodeId}&saved=snapshot`);
		} catch (cause) {
			rethrowRedirect(cause);
			if (cause instanceof Error && cause.name === 'ZodError')
				return fail(400, { message: 'Métricas ou datas inválidas.' });
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	import: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const csv = readFormText(form, 'csv');
		const filename = readFormText(form, 'filename') || 'import.csv';
		if (!episodeId || !csv.trim()) return fail(400, { message: 'Cole um CSV para importar.' });
		try {
			const context = await loadRetentionContext(db, owner, episodeId);
			if (!context) return fail(404, { message: 'Episódio não encontrado.' });
			const result = await importRetentionCsv({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				filename,
				csv,
				durationMs: context.episode.durationMs,
			});
			const detail = result.errors
				.slice(0, 2)
				.map((entry) => `L${entry.line}: ${entry.message}`)
				.join(' | ')
				.slice(0, 300);
			redirect(
				303,
				`/app/retention?episodeId=${episodeId}&imported=${result.imported}&skipped=${result.skipped}&errors=${result.errors.length}${
					detail ? `&detail=${encodeURIComponent(detail)}` : ''
				}`,
			);
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	experiment: async (event) => {
		const { owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		if (!episodeId) return fail(400, { message: 'Episódio inválido.' });
		try {
			await saveRetentionExperiment({
				adminDb: createSupabaseAdminClient(),
				owner,
				values: {
					episodeId,
					name: readFormText(form, 'name'),
					variantAId: readFormText(form, 'variantAId'),
					variantBId: readFormText(form, 'variantBId'),
					hypothesis: readFormText(form, 'hypothesis'),
				},
			});
			redirect(303, `/app/retention?episodeId=${episodeId}&saved=experiment`);
		} catch (cause) {
			rethrowRedirect(cause);
			if (cause instanceof Error && cause.name === 'ZodError')
				return fail(400, { message: 'Experimento inválido.' });
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
	delete: async (event) => {
		const { owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const postId = readFormText(form, 'postId');
		if (!episodeId || !postId) return fail(400, { message: 'Publicação inválida.' });
		try {
			await deletePublishedPost({ adminDb: createSupabaseAdminClient(), owner, postId });
			redirect(303, `/app/retention?episodeId=${episodeId}&saved=deleted`);
		} catch (cause) {
			rethrowRedirect(cause);
			const info = messageFor(cause);
			return fail(info.status, { message: info.message });
		}
	},
};
