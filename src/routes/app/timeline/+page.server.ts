import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { firstRelation } from '#lib/server/relations.js';
import {
	defaultEditPlan,
	loadEditPlan,
	loadEditPlanContext,
	restoreVideoEditPlan,
	saveVideoEditPlan,
	setVideoEditPlanStatus,
	VideoEditPlanError,
} from '#lib/server/video-edit-plans.js';
import {
	editPlanRestoreSchema,
	editPlanStatusSchema,
	videoEditPlanSchema,
} from '#lib/schemas/video-edit-plan.js';
import { EditPlanError } from '#lib/domain/video-edit-plan.js';

function messageFor(cause: unknown): { status: number; message: string } {
	if (cause instanceof VideoEditPlanError) return { status: cause.status, message: cause.message };
	if (cause instanceof EditPlanError) return { status: 400, message: cause.message };
	return { status: 503, message: 'Não foi possível processar o plano de edição.' };
}

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

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data: episodes, error } = await db
		.from('episodes')
		.select(
			'id,episode_number,title,status,duration_ms,scene_duration_ms,seasons(id,title,planned_episode_count,series(title))',
		)
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error) throw new Error('Não foi possível carregar os episódios.');
	const episodeList = (episodes ?? []).map((episode) => {
		const season = firstRelation(episode.seasons);
		return {
			...episode,
			seasons: season ? { ...season, series: firstRelation(season.series) } : null,
		};
	});
	const requestedId = event.url.searchParams.get('episodeId');
	const selectedEpisode =
		episodeList.find((episode) => episode.id === requestedId) ?? episodeList[0] ?? null;
	if (!selectedEpisode)
		return {
			episodes: episodeList,
			selectedEpisode: null,
			plan: null,
			versions: [],
			context: null,
			planError: null,
		};

	try {
		const context = await loadEditPlanContext(db, owner, selectedEpisode.id);
		const stored = await loadEditPlan(db, owner, selectedEpisode.id);
		let plan = stored.plan?.plan ?? null;
		let planError: string | null = null;
		if (!plan) {
			try {
				plan = defaultEditPlan(context);
			} catch (cause) {
				planError = cause instanceof Error ? cause.message : 'Não foi possível criar o plano.';
			}
		}
		return {
			episodes: episodeList,
			selectedEpisode,
			plan,
			versions: stored.versions,
			storedPlan: stored.plan
				? {
						currentVersion: stored.plan.current_version,
						currentStatus: stored.plan.current_status,
						manifestHash: stored.plan.manifest_hash,
						updatedAt: stored.plan.updated_at,
					}
				: null,
			context,
			planError,
		};
	} catch (cause) {
		const errorInfo = messageFor(cause);
		return {
			episodes: episodeList,
			selectedEpisode,
			plan: null,
			versions: [],
			storedPlan: null,
			context: null,
			planError: errorInfo.message,
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
		if (!plan) return fail(400, { message: 'Plano de edição inválido.' });
		if (!episodeId || plan.episodeId !== episodeId)
			return fail(400, { message: 'O plano pertence a outro episódio.' });
		if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
			return fail(400, { message: 'Versão esperada inválida.' });
		try {
			const version = await saveVideoEditPlan({
				db,
				owner,
				episodeId,
				expectedVersion,
				plan,
				changeNote: readFormText(form, 'changeNote'),
			});
			return { success: true, version };
		} catch (cause) {
			const errorInfo = messageFor(cause);
			return fail(errorInfo.status, { message: errorInfo.message });
		}
	},
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const parsed = editPlanRestoreSchema.safeParse({
			episodeId: readFormText(form, 'episodeId'),
			version: readFormText(form, 'version'),
			expectedVersion: readFormText(form, 'expectedVersion'),
		});
		if (!parsed.success) return fail(400, { message: 'Versão de restauração inválida.' });
		try {
			const version = await restoreVideoEditPlan({ db, owner, ...parsed.data });
			return { success: true, version };
		} catch (cause) {
			const errorInfo = messageFor(cause);
			return fail(errorInfo.status, { message: errorInfo.message });
		}
	},
	status: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const parsed = editPlanStatusSchema.safeParse({
			episodeId: readFormText(form, 'episodeId'),
			expectedVersion: readFormText(form, 'expectedVersion'),
			status: readFormText(form, 'status'),
		});
		if (!parsed.success) return fail(400, { message: 'Status do plano inválido.' });
		try {
			await setVideoEditPlanStatus({ db, owner, ...parsed.data });
			return { success: true };
		} catch (cause) {
			const errorInfo = messageFor(cause);
			return fail(errorInfo.status, { message: errorInfo.message });
		}
	},
};
