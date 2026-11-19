import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import {
	CharacterIdentityError,
	loadCharacterIdentityDetail,
	loadIdentityPromptBundle,
	loadOwnerSeriesOptions,
	loadSeriesCharacters,
	restoreCharacterIdentityProfileVersion,
	saveCharacterIdentityProfile,
} from '#lib/server/character-identity.js';
import {
	characterIdentityProfileSchema,
	type CharacterIdentityProfile,
	type IdentityLook,
	type IdentityReference,
} from '#lib/schemas/character-identity.js';
import {
	slugifyIdentityLook,
	buildContinuityChecklist,
	buildIdentityAnchor,
} from '#lib/domain/character-identity.js';

function actionError(cause: unknown) {
	if (cause instanceof CharacterIdentityError)
		return fail(cause.status, { message: cause.message });
	return fail(503, { message: 'Não foi possível processar o kit de identidade.' });
}

function readVersion(form: FormData, key: string): number | null {
	const raw = readFormText(form, key);
	if (!/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function splitList(value: string, separator: RegExp = /\r?\n/): string[] {
	return value
		.split(separator)
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseLooks(value: string): IdentityLook[] {
	return splitList(value).map((line, index) => {
		const parts = line.split('|').map((part) => part.trim());
		const label = parts[0] ?? '';
		const from = Number.parseInt(parts[1] ?? '', 10);
		const rawTo = parts[2] ?? '';
		const to = rawTo === '' ? null : Number.parseInt(rawTo, 10);
		return {
			id: slugifyIdentityLook(label, index),
			label,
			appliesFromEpisode: from,
			appliesToEpisode: rawTo === '' ? null : Number.isFinite(to) ? to : Number.NaN,
			wardrobe: parts[3] ?? '',
			hair: parts[4] ?? '',
			notes: parts[5] ?? '',
		};
	});
}

function profileFromForm(
	form: FormData,
	detail: NonNullable<Awaited<ReturnType<typeof loadCharacterIdentityDetail>>>,
	status: CharacterIdentityProfile['status'],
): CharacterIdentityProfile {
	const existing = new Map(
		(detail.profile?.references ?? []).map((reference) => [reference.assetId, reference] as const),
	);
	const primaryReferenceAssetId = readFormText(form, 'primaryReferenceAssetId') || null;
	const selected = new Set(form.getAll('referenceIds').map(String));
	if (primaryReferenceAssetId) selected.add(primaryReferenceAssetId);
	const references: IdentityReference[] = [...selected].map((assetId) => ({
		assetId,
		label: existing.get(assetId)?.label ?? `Referência ${assetId.slice(0, 8)}`,
		role: assetId === primaryReferenceAssetId ? 'PRIMARY' : 'SUPPORTING',
	}));
	return {
		schemaVersion: 1,
		characterId: detail.characterId,
		seriesId: detail.seriesId,
		status,
		aliases: splitList(readFormText(form, 'aliases'), /[\n,]/),
		visualTraits: {
			hair: readFormText(form, 'hair').trim(),
			wardrobe: readFormText(form, 'wardrobe').trim(),
			silhouette: readFormText(form, 'silhouette').trim(),
			marks: readFormText(form, 'marks').trim(),
			accessories: readFormText(form, 'accessories').trim(),
		},
		palette: readFormText(form, 'palette').trim(),
		lighting: readFormText(form, 'lighting').trim(),
		immutableAccessories: splitList(readFormText(form, 'immutableAccessories'), /[\n,]/),
		mutableAccessories: splitList(readFormText(form, 'mutableAccessories'), /[\n,]/),
		negativePrompts: splitList(readFormText(form, 'negativePrompts'), /[\n,]/),
		references,
		primaryReferenceAssetId,
		looks: parseLooks(readFormText(form, 'looks')),
		anchorOverrideEn: readFormText(form, 'anchorOverrideEn').trim(),
		notes: readFormText(form, 'notes').trim(),
	};
}

async function saveFromForm(event: RequestEvent, status: CharacterIdentityProfile['status']) {
	const { db, owner } = ownerDatabase(event);
	const form = await event.request.formData();
	const characterId = readFormText(form, 'characterId');
	const expectedVersion = readVersion(form, 'expectedVersion');
	if (!characterId || expectedVersion === null)
		return fail(400, { message: 'Personagem ou versão inválidos. Recarregue a página.' });
	const detail = await loadCharacterIdentityDetail(db, owner, characterId);
	if (!detail) return fail(404, { message: 'Personagem não encontrado.' });
	const parsedProfile = characterIdentityProfileSchema.safeParse(
		profileFromForm(form, detail, status),
	);
	if (!parsedProfile.success) {
		const issue = parsedProfile.error.issues[0];
		return fail(400, {
			message: `Perfil inválido${issue ? `: ${issue.path.join('.')} — ${issue.message}` : '.'}`,
		});
	}
	try {
		const version = await saveCharacterIdentityProfile({
			db,
			adminDb: createSupabaseAdminClient(),
			owner,
			characterId,
			expectedVersion,
			profile: parsedProfile.data,
			changeNote: status === 'APPROVED' ? 'Perfil aprovado' : 'Perfil salvo',
		});
		redirect(
			303,
			`/app/identity?seriesId=${detail.seriesId}&characterId=${characterId}&mode=${status === 'APPROVED' ? 'approved' : 'saved'}&saved=${version}`,
		);
	} catch (cause) {
		if (cause instanceof CharacterIdentityError) return actionError(cause);
		throw cause;
	}
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const series = await loadOwnerSeriesOptions(db, owner);
	const requestedSeries = event.url.searchParams.get('seriesId');
	const selectedSeries = series.find((item) => item.id === requestedSeries) ?? series[0] ?? null;
	if (!selectedSeries)
		return {
			series,
			selectedSeries: null,
			characters: [],
			selectedCharacter: null,
			detail: null,
			episodes: [],
			episodeId: null,
			bundle: null,
			notice: null,
			loadError: 'Crie uma série e personagens antes de montar o kit de identidade.',
		};
	const characters = await loadSeriesCharacters(db, owner, selectedSeries.id);
	const requestedCharacter = event.url.searchParams.get('characterId');
	const selectedCharacter =
		characters.find((character) => character.characterId === requestedCharacter) ??
		characters[0] ??
		null;
	const detail = selectedCharacter
		? await loadCharacterIdentityDetail(db, owner, selectedCharacter.characterId)
		: null;
	const { data: episodes, error: episodeError } = await db
		.from('episodes')
		.select('id,episode_number,title,seasons!inner(series_id)')
		.eq('owner_id', owner.id)
		.eq('seasons.series_id', selectedSeries.id)
		.order('episode_number');
	if (episodeError)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar os episódios.',
		);
	const episodeList = (
		(episodes ?? []) as Array<{
			id: string;
			episode_number: number;
			title: string;
		}>
	).map((episode) => ({
		id: episode.id,
		number: Number(episode.episode_number),
		title: episode.title,
	}));
	const requestedEpisode = event.url.searchParams.get('episodeId');
	const selectedEpisode =
		episodeList.find((episode) => episode.id === requestedEpisode) ?? episodeList[0] ?? null;
	let bundle = null;
	if (selectedEpisode) {
		try {
			bundle = (await loadIdentityPromptBundle(db, owner, selectedEpisode.id)).bundle;
		} catch {
			bundle = null;
		}
	}
	const savedVersion = Number(event.url.searchParams.get('saved') ?? '');
	const notice =
		Number.isSafeInteger(savedVersion) && savedVersion > 0
			? {
					mode: event.url.searchParams.get('mode') ?? 'saved',
					version: savedVersion,
				}
			: null;
	const episodeNumber = selectedEpisode?.number ?? 1;
	const anchorPreview =
		detail?.profile && detail.version
			? buildIdentityAnchor(detail.profile, detail.name, episodeNumber)
			: null;
	const checklistPreview =
		detail?.profile && detail.version
			? buildContinuityChecklist(detail.profile, detail.name, episodeNumber)
			: [];
	return {
		series,
		selectedSeries,
		characters,
		selectedCharacter,
		detail,
		episodes: episodeList,
		episodeId: selectedEpisode?.id ?? null,
		bundle,
		anchorPreview,
		checklistPreview,
		notice,
		loadError: null,
	};
};

export const actions: Actions = {
	save: (event) => saveFromForm(event, 'DRAFT'),
	approve: (event) => saveFromForm(event, 'APPROVED'),
	restore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const characterId = readFormText(form, 'characterId');
		const version = readVersion(form, 'version');
		const expectedVersion = readVersion(form, 'expectedVersion');
		if (!characterId || version === null || expectedVersion === null)
			return fail(400, { message: 'Personagem ou versão inválidos.' });
		const detail = await loadCharacterIdentityDetail(db, owner, characterId);
		if (!detail) return fail(404, { message: 'Personagem não encontrado.' });
		try {
			const restored = await restoreCharacterIdentityProfileVersion({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				characterId,
				version,
				expectedVersion,
			});
			redirect(
				303,
				`/app/identity?seriesId=${detail.seriesId}&characterId=${characterId}&mode=restored&saved=${restored}`,
			);
		} catch (cause) {
			if (cause instanceof CharacterIdentityError) return actionError(cause);
			throw cause;
		}
	},
};
