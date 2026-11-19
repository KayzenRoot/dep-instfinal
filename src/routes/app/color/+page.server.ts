import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadOwnerEpisodeSelection } from '#lib/server/episode-options.js';
import {
	loadEditPlan,
	loadEditPlanContext,
	VideoEditPlanError,
} from '#lib/server/video-edit-plans.js';
import { colorSceneLabel } from '#lib/domain/color-grade.js';
import { clearColorGrade, ColorGradeError, saveColorGrade } from '#lib/server/color-grade.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import {
	colorOverrideSchema,
	type ColorGrade,
	type ColorOverride,
} from '#lib/schemas/color-grade.js';

function actionError(cause: unknown) {
	if (cause instanceof ColorGradeError) return fail(cause.status, { message: cause.message });
	if (cause instanceof VideoEditPlanError) return fail(cause.status, { message: cause.message });
	return fail(503, { message: 'Não foi possível salvar a correção cromática.' });
}

function readExpectedVersion(form: FormData): number | null {
	const raw = String(form.get('expectedVersion') ?? '');
	if (!/^\d+$/.test(raw)) return null;
	const version = Number(raw);
	return Number.isSafeInteger(version) ? version : null;
}

function readStrength(form: FormData): number | null {
	const raw = String(form.get('strength') ?? '');
	const strength = Number(raw);
	if (raw.trim() === '' || !Number.isInteger(strength) || strength < 0 || strength > 100)
		return null;
	return strength;
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
			plan: null,
			color: null,
			clips: [],
			notice: null,
			loadError: 'Crie um episódio e salve a timeline antes de aplicar cor.',
		};
	let stored: Awaited<ReturnType<typeof loadEditPlan>> = { plan: null, versions: [] };
	let loadError: string | null = null;
	try {
		stored = await loadEditPlan(db, owner, selectedEpisode.id);
	} catch (cause) {
		if (cause instanceof VideoEditPlanError) loadError = cause.message;
		else throw cause;
	}
	let sceneIndexById = new Map<string, number>();
	if (stored.plan) {
		try {
			const context = await loadEditPlanContext(db, owner, selectedEpisode.id);
			sceneIndexById = new Map(context.scenes.map((scene) => [scene.id, scene.sceneIndex]));
		} catch {
			// O plano continua utilizável; os rótulos caem para a ordem cronológica.
		}
	}
	const clips = [...(stored.plan?.plan.clips ?? [])]
		.sort((left, right) => left.timelineStartMs - right.timelineStartMs)
		.map((clip, index) => {
			const sceneIndex = sceneIndexById.get(clip.sceneId);
			return {
				id: clip.id,
				assetId: clip.assetId,
				label: colorSceneLabel(sceneIndex, index),
				startMs: clip.timelineStartMs,
				endMs: clip.timelineEndMs,
			};
		});
	const savedVersion = Number(event.url.searchParams.get('saved') ?? '');
	const clearedVersion = Number(event.url.searchParams.get('cleared') ?? '');
	const notice =
		Number.isSafeInteger(savedVersion) && savedVersion > 0
			? { kind: 'saved' as const, version: savedVersion }
			: Number.isSafeInteger(clearedVersion) && clearedVersion > 0
				? { kind: 'cleared' as const, version: clearedVersion }
				: null;
	return {
		episodes,
		selectedEpisode,
		plan: stored.plan
			? { version: stored.plan.current_version, status: stored.plan.current_status }
			: null,
		color: stored.plan?.plan.color ?? null,
		clips,
		notice,
		loadError,
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		const expectedVersion = readExpectedVersion(form);
		if (!episodeId || expectedVersion === null)
			return fail(400, { message: 'Episódio ou versão do plano inválidos. Recarregue a página.' });
		const strength = readStrength(form);
		if (strength === null)
			return fail(400, { message: 'A intensidade precisa ser um inteiro entre 0 e 100.' });
		let overrides: ColorOverride[];
		try {
			const raw = JSON.parse(String(form.get('overrides') ?? '[]'));
			const parsed = colorOverrideSchema.array().max(60).safeParse(raw);
			if (!parsed.success)
				return fail(400, { message: 'Ajustes por cena inválidos. Recarregue a página.' });
			overrides = parsed.data;
		} catch {
			return fail(400, { message: 'Ajustes por cena inválidos. Recarregue a página.' });
		}
		const referenceClipId = form.get('referenceClipId');
		let version: number;
		try {
			version = await saveColorGrade({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion,
				grade: {
					presetId: String(form.get('presetId') ?? 'neutral') as ColorGrade['presetId'],
					presetVersion: 1,
					strength,
					referenceClipId:
						typeof referenceClipId === 'string' && referenceClipId.length ? referenceClipId : null,
					overrides,
				},
			});
		} catch (cause) {
			return actionError(cause);
		}
		redirect(303, `/app/color?episodeId=${encodeURIComponent(episodeId)}&saved=${version}`);
	},
	clear: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = String(form.get('episodeId') ?? '');
		const expectedVersion = readExpectedVersion(form);
		if (!episodeId || expectedVersion === null)
			return fail(400, { message: 'Episódio ou versão do plano inválidos. Recarregue a página.' });
		let version: number;
		try {
			version = await clearColorGrade({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion,
			});
		} catch (cause) {
			return actionError(cause);
		}
		redirect(303, `/app/color?episodeId=${encodeURIComponent(episodeId)}&cleared=${version}`);
	},
};
