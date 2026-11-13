import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { firstRelation } from '#lib/server/relations.js';
import {
	heuristicVoicePlan,
	listNarrationTakes,
	loadVoiceContext,
	loadVoicePlan,
	NarrationError,
	restoreVoicePlan,
	saveVoicePlan,
} from '#lib/server/narration.js';
import { voiceDirectionPlanSchema } from '#lib/schemas/voice-direction.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data: episodes, error } = await db
		.from('episodes')
		.select('id,episode_number,title,status,seasons(title,series(title))')
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
			storedPlan: null,
			takes: [],
			versions: [],
			planError: null,
		};
	try {
		const context = await loadVoiceContext(db, owner, selectedEpisode.id);
		const stored = await loadVoicePlan(db, owner, selectedEpisode.id);
		let plan = stored?.plan ?? null;
		let planError: string | null = null;
		if (!plan) {
			try {
				plan = heuristicVoicePlan(context);
			} catch (cause) {
				planError = cause instanceof Error ? cause.message : 'Não foi possível montar a direção.';
			}
		}
		return {
			episodes: episodeList,
			selectedEpisode,
			plan,
			storedPlan: stored
				? {
						currentVersion: stored.currentVersion,
						status: stored.status,
						estimatedDurationMs: stored.estimatedDurationMs,
					}
				: null,
			takes: await listNarrationTakes(db, owner, selectedEpisode.id),
			versions:
				stored?.versions
					.map((version) => ({
						version: version.version,
						createdAt: version.createdAt,
						note: version.note,
						hash: version.hash,
					}))
					.reverse() ?? [],
			planError,
		};
	} catch (cause) {
		return {
			episodes: episodeList,
			selectedEpisode,
			plan: null,
			storedPlan: null,
			takes: [],
			versions: [],
			planError: cause instanceof Error ? cause.message : 'Não foi possível carregar a narração.',
		};
	}
};

export const actions: Actions = {
	save: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const raw = readFormText(form, 'plan');
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			return fail(400, { message: 'Plano de voz inválido.' });
		}
		const parsed = voiceDirectionPlanSchema.safeParse(value);
		if (!parsed.success) return fail(400, { message: 'Plano de voz inválido.' });
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
			return fail(400, { message: 'Versão inválida.' });
		try {
			const version = await saveVoicePlan({
				adminDb: createSupabaseAdminClient(),
				db,
				owner,
				episodeId: parsed.data.episodeId,
				expectedVersion,
				plan: parsed.data,
				changeNote: readFormText(form, 'changeNote'),
			});
			return { success: true, version };
		} catch (cause) {
			if (cause instanceof NarrationError) return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível salvar a direção.' });
		}
	},
	approve: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const raw = readFormText(form, 'plan');
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			return fail(400, { message: 'Plano de voz inválido.' });
		}
		const parsed = voiceDirectionPlanSchema.safeParse(value);
		if (!parsed.success) return fail(400, { message: 'Plano de voz inválido.' });
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		try {
			const version = await saveVoicePlan({
				adminDb: createSupabaseAdminClient(),
				db,
				owner,
				episodeId: parsed.data.episodeId,
				expectedVersion,
				plan: parsed.data,
				changeNote: 'Direção aprovada',
				status: 'APPROVED',
			});
			return { success: true, version };
		} catch (cause) {
			if (cause instanceof NarrationError) return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível aprovar a direção.' });
		}
	},
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const version = Number.parseInt(readFormText(form, 'version'), 10);
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		if (!episodeId || !Number.isInteger(version) || version < 1)
			return fail(400, { message: 'Versão inválida.' });
		if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
			return fail(400, { message: 'Versão esperada inválida.' });
		try {
			const saved = await restoreVoicePlan({
				adminDb: createSupabaseAdminClient(),
				db,
				owner,
				episodeId,
				version,
				expectedVersion,
			});
			return { success: true, version: saved };
		} catch (cause) {
			if (cause instanceof NarrationError) return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível restaurar a direção.' });
		}
	},
};
