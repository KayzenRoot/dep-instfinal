import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { firstRelation } from '#lib/server/relations.js';
import {
	CaptionServiceError,
	generateCaptionTrack,
	loadCaptionContext,
	loadCaptionTrack,
	restoreCaptionTrack,
	saveCaptionTrack,
} from '#lib/server/captions.js';
import {
	captionAsrImportSchema,
	captionTrackSchema,
	type CaptionTrack,
} from '#lib/schemas/captions.js';

function parseTrackForm(
	form: FormData,
): { track: CaptionTrack; expectedVersion: number } | { error: string } {
	let value: unknown;
	try {
		value = JSON.parse(readFormText(form, 'track'));
	} catch {
		return { error: 'Legenda inválida.' };
	}
	const parsed = captionTrackSchema.safeParse(value);
	if (!parsed.success) return { error: 'Legenda inválida.' };
	const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
	if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
		return { error: 'Versão esperada inválida.' };
	return { track: parsed.data, expectedVersion };
}

async function saveFromForm(event: Parameters<Actions['save']>[0], status: 'DRAFT' | 'APPROVED') {
	const { db, owner } = ownerDatabase(event);
	const form = await event.request.formData();
	const parsed = parseTrackForm(form);
	if ('error' in parsed) return fail(400, { message: parsed.error });
	const episodeId = readFormText(form, 'episodeId');
	if (!episodeId || parsed.track.episodeId !== episodeId)
		return fail(400, { message: 'O plano pertence a outro episódio.' });
	try {
		const version = await saveCaptionTrack({
			adminDb: createSupabaseAdminClient(),
			db,
			owner,
			episodeId,
			planVersion: parsed.track.planVersion,
			expectedVersion: parsed.expectedVersion,
			track: parsed.track,
			changeNote: readFormText(form, 'changeNote'),
			status,
		});
		return { success: true, version };
	} catch (cause) {
		if (cause instanceof CaptionServiceError) return fail(cause.status, { message: cause.message });
		return fail(503, { message: 'Não foi possível salvar as legendas.' });
	}
}

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
			context: null,
			track: null,
			trackVersion: 0,
			trackStatus: null,
			versions: [],
			loadError: 'Crie/selecione um episódio.',
		};
	try {
		const context = await loadCaptionContext(db, owner, selectedEpisode.id);
		const stored = await loadCaptionTrack(db, owner, selectedEpisode.id, context.planVersion);
		const track =
			stored?.track ??
			captionTrackSchema.parse({
				schemaVersion: 1,
				episodeId: context.episodeId,
				planId: context.planId,
				planVersion: context.planVersion,
				narrationTakeId: context.narrationTakeId,
				style: 'clean',
				safeZone: 'tiktok',
				source: 'MANUAL',
				scriptSha256: null,
				audioSha256: context.audioSha256,
				alignmentScore: null,
				cues: [],
			});
		return {
			episodes: episodeList,
			selectedEpisode,
			context: {
				episodeId: context.episodeId,
				planId: context.planId,
				planVersion: context.planVersion,
				planStatus: context.planStatus,
				durationMs: context.durationMs,
				narrationTakeId: context.narrationTakeId,
				episodeRevisionNumber: context.episodeRevisionNumber,
			},
			track,
			trackVersion: stored?.currentVersion ?? 0,
			trackStatus: stored?.status ?? null,
			versions:
				stored?.versions
					.map((version) => ({
						version: version.version,
						createdAt: version.createdAt,
						note: version.note,
					}))
					.reverse() ?? [],
			loadError: null,
		};
	} catch (cause) {
		return {
			episodes: episodeList,
			selectedEpisode,
			context: null,
			track: null,
			trackVersion: 0,
			trackStatus: null,
			versions: [],
			loadError: cause instanceof Error ? cause.message : 'Não foi possível carregar as legendas.',
		};
	}
};

export const actions: Actions = {
	save: async (event) => saveFromForm(event, 'DRAFT'),
	approve: async (event) => saveFromForm(event, 'APPROVED'),
	generate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		let value: unknown;
		try {
			value = JSON.parse(readFormText(form, 'asr'));
		} catch {
			return fail(400, { message: 'JSON de ASR inválido.' });
		}
		const parsed = captionAsrImportSchema.safeParse(value);
		if (!parsed.success) return fail(400, { message: 'JSON de ASR inválido.' });
		const episodeId = readFormText(form, 'episodeId');
		const planVersion = Number.parseInt(readFormText(form, 'planVersion'), 10);
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		if (!episodeId || !Number.isInteger(planVersion) || planVersion < 1)
			return fail(400, { message: 'Plano inválido.' });
		try {
			const generated = await generateCaptionTrack({
				adminDb: createSupabaseAdminClient(),
				db,
				owner,
				episodeId,
				planVersion,
				expectedVersion,
				asrWords: parsed.data.words,
				style: parsed.data.style,
				safeZone: parsed.data.safeZone,
				changeNote: 'Alinhamento ASR importado',
			});
			return { success: true, version: generated.version, cues: generated.track.cues.length };
		} catch (cause) {
			if (cause instanceof CaptionServiceError)
				return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível alinhar as legendas.' });
		}
	},
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const planVersion = Number.parseInt(readFormText(form, 'planVersion'), 10);
		const version = Number.parseInt(readFormText(form, 'version'), 10);
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		if (!episodeId || !Number.isInteger(planVersion) || planVersion < 1)
			return fail(400, { message: 'Plano inválido.' });
		if (!Number.isInteger(version) || version < 1)
			return fail(400, { message: 'Versão inválida.' });
		try {
			const saved = await restoreCaptionTrack({
				adminDb: createSupabaseAdminClient(),
				db,
				owner,
				episodeId,
				planVersion,
				version,
				expectedVersion,
			});
			return { success: true, version: saved };
		} catch (cause) {
			if (cause instanceof CaptionServiceError)
				return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível restaurar as legendas.' });
		}
	},
};
