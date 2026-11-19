import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	characterIdentityProfileSchema,
	type CharacterIdentityProfile,
} from '#lib/schemas/character-identity.js';
import {
	buildContinuityChecklist,
	buildIdentityAnchor,
	buildSceneIdentityPrompts,
	identityProfileHash,
	type CharacterIdentityCandidate,
	type CharacterIdentityRecord,
	type IdentityPromptBundle,
} from '#lib/domain/character-identity.js';

export class CharacterIdentityError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'CharacterIdentityError';
	}
}

interface ProfileRow {
	profile_id: string;
	version: number;
	profile: unknown;
	profile_hash: string;
	change_note: string | null;
	created_at: string;
}

function mapRpcError(error: { code?: string; message?: string }): CharacterIdentityError {
	if (error.code === '40001')
		return new CharacterIdentityError(
			409,
			'IDENTITY_VERSION_CONFLICT',
			'O perfil foi alterado em outra aba. Recarregue antes de salvar.',
		);
	if (error.code === 'P0002')
		return new CharacterIdentityError(
			404,
			'IDENTITY_CHARACTER_NOT_FOUND',
			'Personagem não encontrado.',
		);
	if (error.code === '42501')
		return new CharacterIdentityError(403, 'IDENTITY_FORBIDDEN', 'Acesso não autorizado.');
	if (error.code === '23514')
		return new CharacterIdentityError(400, 'IDENTITY_INVALID', 'Perfil de identidade inválido.');
	return new CharacterIdentityError(
		503,
		'IDENTITY_SAVE_FAILED',
		'Não foi possível salvar o perfil de identidade.',
	);
}

function parseProfileRow(row: {
	profile: unknown;
	profile_hash: string;
}): CharacterIdentityProfile {
	const parsed = characterIdentityProfileSchema.safeParse(row.profile);
	if (!parsed.success)
		throw new CharacterIdentityError(500, 'IDENTITY_STORED_INVALID', 'Perfil armazenado inválido.');
	if (identityProfileHash(parsed.data) !== row.profile_hash)
		throw new CharacterIdentityError(
			500,
			'IDENTITY_HASH_MISMATCH',
			'O hash do perfil armazenado não confere.',
		);
	return parsed.data;
}

export interface CharacterIdentitySummary {
	characterId: string;
	name: string;
	role: string;
	status: string;
	version: number | null;
	profileStatus: 'DRAFT' | 'APPROVED' | null;
	primaryReferenceAssetId: string | null;
}

export interface CharacterIdentityDetail extends CharacterIdentitySummary {
	seriesId: string;
	seriesTitle: string;
	profile: CharacterIdentityProfile | null;
	versions: Array<{
		version: number;
		changeNote: string;
		createdAt: string;
	}>;
	referenceAssets: Array<{
		id: string;
		assetKind: string;
		width: number | null;
		height: number | null;
		createdAt: string;
	}>;
}

export async function loadOwnerSeriesOptions(db: SupabaseClient, owner: User) {
	const { data, error } = await db
		.from('series')
		.select('id,title')
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar as séries.',
		);
	return (data ?? []) as Array<{ id: string; title: string }>;
}

export async function loadSeriesCharacters(
	db: SupabaseClient,
	owner: User,
	seriesId: string,
): Promise<CharacterIdentitySummary[]> {
	const [characters, profiles] = await Promise.all([
		db
			.from('characters')
			.select('id,name,role,status')
			.eq('owner_id', owner.id)
			.eq('series_id', seriesId)
			.order('name'),
		db
			.from('character_identity_profiles')
			.select('character_id,current_version,profile,profile_hash')
			.eq('owner_id', owner.id)
			.eq('series_id', seriesId),
	]);
	if (characters.error || profiles.error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar os personagens.',
		);
	const profileByCharacter = new Map(
		(profiles.data ?? []).map((row) => [
			row.character_id,
			{
				version: Number(row.current_version),
				profile: parseProfileRow(row as { profile: unknown; profile_hash: string }),
			},
		]),
	);
	return (
		(characters.data ?? []) as Array<{
			id: string;
			name: string;
			role: string;
			status: string;
		}>
	).map((character) => {
		const current = profileByCharacter.get(character.id);
		return {
			characterId: character.id,
			name: character.name,
			role: character.role,
			status: character.status,
			version: current?.version ?? null,
			profileStatus: current?.profile.status ?? null,
			primaryReferenceAssetId: current?.profile.primaryReferenceAssetId ?? null,
		};
	});
}

export async function loadCharacterIdentityDetail(
	db: SupabaseClient,
	owner: User,
	characterId: string,
): Promise<CharacterIdentityDetail | null> {
	const { data: character, error } = await db
		.from('characters')
		.select('id,name,role,status,series_id,series(title)')
		.eq('owner_id', owner.id)
		.eq('id', characterId)
		.maybeSingle();
	if (error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar o personagem.',
		);
	if (!character) return null;
	const series = Array.isArray(character.series) ? character.series[0] : character.series;
	const [{ data: profileRow, error: profileError }, { data: assets, error: assetsError }] =
		await Promise.all([
			db
				.from('character_identity_profiles')
				.select('id,current_version,profile,profile_hash')
				.eq('owner_id', owner.id)
				.eq('character_id', characterId)
				.maybeSingle(),
			db
				.from('media_assets')
				.select('id,asset_kind,width,height,created_at')
				.eq('owner_id', owner.id)
				.eq('upload_status', 'READY')
				.in('asset_kind', ['REFERENCE', 'FRAME'])
				.order('created_at', { ascending: false })
				.limit(80),
		]);
	if (profileError || assetsError)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar o perfil.',
		);
	let profile: CharacterIdentityProfile | null = null;
	let versions: CharacterIdentityDetail['versions'] = [];
	if (profileRow) {
		profile = parseProfileRow(profileRow as { profile: unknown; profile_hash: string });
		const { data: versionRows, error: versionError } = await db
			.from('character_identity_profile_versions')
			.select('version,change_note,created_at')
			.eq('owner_id', owner.id)
			.eq('profile_id', profileRow.id)
			.order('version', { ascending: false })
			.limit(20);
		if (versionError)
			throw new CharacterIdentityError(
				503,
				'IDENTITY_LOAD_FAILED',
				'Não foi possível carregar as versões.',
			);
		versions = ((versionRows ?? []) as ProfileRow[]).map((row) => ({
			version: Number(row.version),
			changeNote: row.change_note ?? '',
			createdAt: row.created_at,
		}));
	}
	return {
		characterId: character.id,
		name: character.name,
		role: character.role,
		status: character.status,
		seriesId: character.series_id,
		seriesTitle: (series as { title?: string } | null)?.title ?? 'Série',
		version: profileRow ? Number(profileRow.current_version) : null,
		profileStatus: profile?.status ?? null,
		primaryReferenceAssetId: profile?.primaryReferenceAssetId ?? null,
		profile,
		versions,
		referenceAssets: (
			(assets ?? []) as Array<{
				id: string;
				asset_kind: string;
				width: number | null;
				height: number | null;
				created_at: string;
			}>
		).map((asset) => ({
			id: asset.id,
			assetKind: asset.asset_kind,
			width: asset.width,
			height: asset.height,
			createdAt: asset.created_at,
		})),
	};
}

async function assertReferenceAssets(
	db: SupabaseClient,
	ownerId: string,
	profile: CharacterIdentityProfile,
): Promise<void> {
	const ids = [...new Set(profile.references.map((reference) => reference.assetId))];
	if (!ids.length) return;
	const { data, error } = await db
		.from('media_assets')
		.select('id,asset_kind')
		.eq('owner_id', ownerId)
		.eq('upload_status', 'READY')
		.in('id', ids);
	if (error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_REFERENCE_CHECK_FAILED',
			'Não foi possível validar as referências.',
		);
	const found = new Set((data ?? []).map((asset) => asset.id));
	if (ids.some((id) => !found.has(id)))
		throw new CharacterIdentityError(
			400,
			'IDENTITY_REFERENCE_UNKNOWN',
			'Uma referência não existe ou não está READY.',
		);
}

export async function saveCharacterIdentityProfile(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	characterId: string;
	expectedVersion: number;
	profile: CharacterIdentityProfile;
	changeNote?: string;
}): Promise<number> {
	const parsed = characterIdentityProfileSchema.safeParse(input.profile);
	if (!parsed.success)
		throw new CharacterIdentityError(400, 'IDENTITY_INVALID', 'Perfil de identidade inválido.');
	const { data: character, error } = await input.db
		.from('characters')
		.select('id,series_id')
		.eq('owner_id', input.owner.id)
		.eq('id', input.characterId)
		.maybeSingle();
	if (error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar o personagem.',
		);
	if (!character)
		throw new CharacterIdentityError(
			404,
			'IDENTITY_CHARACTER_NOT_FOUND',
			'Personagem não encontrado.',
		);
	if (parsed.data.seriesId !== character.series_id)
		throw new CharacterIdentityError(
			400,
			'IDENTITY_SERIES_MISMATCH',
			'O personagem não pertence à série informada.',
		);
	await assertReferenceAssets(input.db, input.owner.id, parsed.data);
	if (!input.adminDb)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_WRITE_UNAVAILABLE',
			'O writer do perfil não está configurado.',
		);
	const { data, error: rpcError } = await input.adminDb.rpc('save_character_identity_profile', {
		p_owner_id: input.owner.id,
		p_character_id: input.characterId,
		p_expected_version: input.expectedVersion,
		p_profile: parsed.data,
		p_profile_hash: identityProfileHash(parsed.data),
		p_change_note: input.changeNote ?? '',
	});
	if (rpcError) throw mapRpcError(rpcError);
	if (typeof data !== 'number')
		throw new CharacterIdentityError(
			503,
			'IDENTITY_SAVE_FAILED',
			'O servidor não retornou a versão.',
		);
	return data;
}

export async function restoreCharacterIdentityProfileVersion(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	characterId: string;
	version: number;
	expectedVersion: number;
}): Promise<number> {
	const { data: profileRow, error } = await input.db
		.from('character_identity_profiles')
		.select('id')
		.eq('owner_id', input.owner.id)
		.eq('character_id', input.characterId)
		.maybeSingle();
	if (error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar o perfil.',
		);
	if (!profileRow)
		throw new CharacterIdentityError(404, 'IDENTITY_PROFILE_NOT_FOUND', 'Perfil não encontrado.');
	const { data: versionRow, error: versionError } = await input.db
		.from('character_identity_profile_versions')
		.select('profile,profile_hash')
		.eq('owner_id', input.owner.id)
		.eq('profile_id', profileRow.id)
		.eq('version', input.version)
		.maybeSingle();
	if (versionError)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar a versão.',
		);
	if (!versionRow)
		throw new CharacterIdentityError(404, 'IDENTITY_VERSION_NOT_FOUND', 'Versão não encontrada.');
	const profile = parseProfileRow(versionRow as { profile: unknown; profile_hash: string });
	return saveCharacterIdentityProfile({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		characterId: input.characterId,
		expectedVersion: input.expectedVersion,
		profile: { ...profile, status: 'DRAFT' },
		changeNote: `Restaurar perfil v${input.version}`,
	});
}

export async function loadIdentityPromptBundle(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<{
	episode: { id: string; number: number; title: string; seriesId: string; seriesTitle: string };
	bundle: IdentityPromptBundle;
	characters: CharacterIdentitySummary[];
}> {
	const { data: episode, error } = await db
		.from('episodes')
		.select('id,episode_number,title,seasons(series_id,series(title))')
		.eq('owner_id', owner.id)
		.eq('id', episodeId)
		.maybeSingle();
	if (error)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar o episódio.',
		);
	if (!episode)
		throw new CharacterIdentityError(404, 'IDENTITY_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	const season = Array.isArray(episode.seasons) ? episode.seasons[0] : episode.seasons;
	const series = season
		? Array.isArray((season as { series?: unknown }).series)
			? (season as { series: Array<{ title?: string }> }).series[0]
			: (season as { series?: { title?: string } }).series
		: null;
	const seriesId = (season as { series_id?: string } | null)?.series_id;
	if (!seriesId)
		throw new CharacterIdentityError(503, 'IDENTITY_LOAD_FAILED', 'O episódio não tem série.');
	const [{ data: scenes, error: scenesError }, characters] = await Promise.all([
		db
			.from('scenes')
			.select('id,scene_index,character_notes,visual_description,start_frame_prompt_en')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('scene_index'),
		loadSeriesCharacters(db, owner, seriesId),
	]);
	if (scenesError)
		throw new CharacterIdentityError(
			503,
			'IDENTITY_LOAD_FAILED',
			'Não foi possível carregar as cenas.',
		);
	const candidates: CharacterIdentityCandidate[] = [];
	for (const character of characters) {
		const detail = await loadCharacterIdentityDetail(db, owner, character.characterId);
		candidates.push({
			characterId: character.characterId,
			name: character.name,
			version: detail?.version ?? 0,
			profile: detail?.profile ?? null,
		});
	}
	return {
		episode: {
			id: episode.id,
			number: Number(episode.episode_number),
			title: episode.title,
			seriesId,
			seriesTitle: (series as { title?: string } | null)?.title ?? 'Série',
		},
		bundle: buildSceneIdentityPrompts(
			(
				(scenes ?? []) as Array<{
					id: string;
					scene_index: number;
					character_notes: string;
					visual_description: string;
					start_frame_prompt_en: string;
				}>
			).map((scene) => ({
				id: scene.id,
				sceneIndex: Number(scene.scene_index),
				characterNotes: scene.character_notes,
				visualDescription: scene.visual_description,
				startFramePromptEn: scene.start_frame_prompt_en,
			})),
			candidates,
			Number(episode.episode_number),
		),
		characters,
	};
}

export async function loadSeriesIdentityRecords(
	db: SupabaseClient,
	owner: User,
	seriesId: string,
): Promise<CharacterIdentityRecord[]> {
	const characters = await loadSeriesCharacters(db, owner, seriesId);
	const records: CharacterIdentityRecord[] = [];
	for (const character of characters) {
		const detail = await loadCharacterIdentityDetail(db, owner, character.characterId);
		if (detail?.profile && detail.version)
			records.push({
				characterId: detail.characterId,
				name: detail.name,
				version: detail.version,
				profile: detail.profile,
			});
	}
	return records;
}

export function identityBundleJson(
	seriesTitle: string,
	episodeNumber: number,
	records: CharacterIdentityRecord[],
) {
	return {
		format: 'dif-studio-character-identity/v1',
		seriesTitle,
		episodeNumber,
		characters: records.map((record) => ({
			characterId: record.characterId,
			name: record.name,
			profileVersion: record.version,
			aliases: record.profile.aliases,
			status: record.profile.status,
			anchor: buildIdentityAnchor(record.profile, record.name, episodeNumber),
			checklist: buildContinuityChecklist(record.profile, record.name, episodeNumber),
			references: record.profile.references.map((reference) => ({
				assetId: reference.assetId,
				label: reference.label,
				role: reference.role,
			})),
			negativePrompts: record.profile.negativePrompts,
		})),
	};
}
