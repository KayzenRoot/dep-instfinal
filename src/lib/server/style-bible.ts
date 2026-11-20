import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	styleConfigSchema,
	styleImportSchema,
	styleOverrideSchema,
	stylePresetSaveSchema,
	type StyleConfig,
	type StyleOverride,
	type StyleScopeType,
	type StyleSnapshot,
} from '#lib/schemas/style-bible.js';
import { resolveStyle, withdrawInvalidSfx, type StyleLayer } from '#lib/domain/style-bible.js';
import { styleConfigHash, STYLE_HASH_VERSION } from '#lib/domain/style-config-hash.js';
import { firstRelation } from './relations.js';

export class StyleServiceError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'StyleServiceError';
	}
}

interface PresetRow {
	id: string;
	owner_id: string;
	scope_type: string;
	scope_id: string;
	name: string;
	created_at: string;
	updated_at: string;
}

interface RevisionRow {
	id: string;
	preset_id: string;
	revision_number: number;
	config: unknown;
	config_hash: string;
	hash_version: number;
	status: string;
	created_at: string;
}

export interface StyleRevision {
	id: string;
	revision: number;
	status: 'DRAFT' | 'APPROVED';
	config: StyleConfig;
	configHash: string;
	createdAt: string;
}

export interface StylePreset {
	id: string;
	scopeType: StyleScopeType;
	scopeId: string;
	name: string;
	revisions: StyleRevision[];
	latestRevision: number;
	approved: StyleRevision | null;
}

export interface StylePageContext {
	presets: StylePreset[];
	series: Array<{ id: string; title: string }>;
	seasons: Array<{ id: string; title: string; seriesId: string; seriesTitle: string }>;
	episodes: Array<{
		id: string;
		title: string;
		number: number;
		seriesTitle: string;
		seriesId: string | null;
		seasonId: string | null;
	}>;
	episodeOverrides: Array<{ episodeId: string; config: StyleOverride }>;
	sceneOverrides: Array<{ sceneId: string; episodeId: string; config: StyleOverride }>;
}

function mapRpcError(error: { code?: string; message?: string }): StyleServiceError {
	if (error.code === '40001')
		return new StyleServiceError(
			409,
			'STYLE_REVISION_CONFLICT',
			'O estilo foi alterado em outra aba. Recarregue antes de salvar.',
		);
	if (error.code === 'P0002')
		return new StyleServiceError(404, 'STYLE_SCOPE_NOT_FOUND', 'Série/temporada não encontrada.');
	if (error.code === '55000')
		return new StyleServiceError(
			409,
			'STYLE_IMMUTABLE',
			'O histórico de estilo é imutável; crie uma nova revisão.',
		);
	if (error.code === '23514') {
		if (error.message?.includes('style_revision_quota'))
			return new StyleServiceError(
				409,
				'STYLE_REVISION_QUOTA',
				'Este preset atingiu 200 revisões. Duplique-o para continuar.',
			);
		return new StyleServiceError(400, 'STYLE_INVALID', 'Configuração de estilo inválida.');
	}
	if (error.code === '23505')
		return new StyleServiceError(
			409,
			'STYLE_REVISION_CONFLICT',
			'O preset foi criado em outra aba. Recarregue antes de salvar.',
		);
	if (error.code === '42501')
		return new StyleServiceError(403, 'STYLE_FORBIDDEN', 'Acesso não autorizado.');
	return new StyleServiceError(503, 'STYLE_SAVE_FAILED', 'Não foi possível salvar o estilo.');
}

async function validateSfxAssets(
	db: SupabaseClient,
	owner: User,
	config: StyleConfig,
): Promise<void> {
	if (!config.sfxAssetIds.length) return;
	const { data, error } = await db
		.from('audio_assets')
		.select('id,license_status,commercial_allowed,social_allowed')
		.eq('owner_id', owner.id)
		.in('id', config.sfxAssetIds);
	if (error)
		throw new StyleServiceError(503, 'STYLE_ASSET_LOAD_FAILED', 'Não foi possível validar os SFX.');
	const rows = data ?? [];
	if (rows.length !== new Set(config.sfxAssetIds).size)
		throw new StyleServiceError(
			409,
			'STYLE_ASSET_MISSING',
			'Um ou mais SFX do preset não existem mais. Corrija o preset.',
		);
	const unlicensed = rows.some(
		(row) => row.license_status !== 'VERIFIED' || !row.commercial_allowed || !row.social_allowed,
	);
	if (unlicensed)
		throw new StyleServiceError(
			409,
			'STYLE_LICENSE_BLOCKED',
			'Um ou mais SFX não têm licença verificada para uso comercial/social.',
		);
}

function parseRevision(row: RevisionRow): StyleRevision {
	if (Number(row.hash_version) !== STYLE_HASH_VERSION)
		throw new StyleServiceError(
			500,
			'STYLE_HASH_VERSION_UNSUPPORTED',
			'Versão de hash de estilo não suportada.',
		);
	const parsed = styleConfigSchema.safeParse(row.config);
	if (!parsed.success)
		throw new StyleServiceError(500, 'STYLE_STORED_INVALID', 'Estilo armazenado inválido.');
	if (styleConfigHash(parsed.data) !== row.config_hash)
		throw new StyleServiceError(500, 'STYLE_HASH_MISMATCH', 'O hash do estilo não confere.');
	return {
		id: row.id,
		revision: Number(row.revision_number),
		status: row.status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
		config: parsed.data,
		configHash: row.config_hash,
		createdAt: row.created_at,
	};
}

async function loadPresetForScope(
	db: SupabaseClient,
	owner: User,
	scopeType: StyleScopeType,
	scopeId: string,
): Promise<StylePreset | null> {
	const { data: preset, error } = await db
		.from('style_presets')
		.select('*')
		.eq('owner_id', owner.id)
		.eq('scope_type', scopeType)
		.eq('scope_id', scopeId)
		.maybeSingle();
	if (error)
		throw new StyleServiceError(503, 'STYLE_LOAD_FAILED', 'Não foi possível carregar o estilo.');
	if (!preset) return null;
	const { data: revisions, error: revisionsError } = await db
		.from('style_preset_revisions')
		.select('*')
		.eq('owner_id', owner.id)
		.eq('preset_id', preset.id)
		.order('revision_number', { ascending: false })
		.limit(200);
	if (revisionsError)
		throw new StyleServiceError(503, 'STYLE_LOAD_FAILED', 'Não foi possível carregar o estilo.');
	const mapped = ((revisions ?? []) as RevisionRow[]).map(parseRevision);
	return {
		id: preset.id as string,
		scopeType: preset.scope_type as StyleScopeType,
		scopeId: preset.scope_id as string,
		name: preset.name as string,
		revisions: mapped,
		latestRevision: mapped[0]?.revision ?? 0,
		approved: mapped.find((revision) => revision.status === 'APPROVED') ?? null,
	};
}

export async function saveStylePreset(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	values: unknown;
}): Promise<{ revision: number }> {
	const parsed = stylePresetSaveSchema.safeParse(input.values);
	if (!parsed.success)
		throw new StyleServiceError(400, 'STYLE_INVALID', 'Configuração de estilo inválida.');
	await validateSfxAssets(input.db, input.owner, parsed.data.config);
	if (!input.adminDb)
		throw new StyleServiceError(
			503,
			'STYLE_WRITE_UNAVAILABLE',
			'O writer de estilo não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('save_style_preset_revision', {
		p_owner_id: input.owner.id,
		p_scope_type: parsed.data.scopeType,
		p_scope_id: parsed.data.scopeId,
		p_name: parsed.data.name,
		p_expected_revision: parsed.data.expectedRevision,
		p_config: parsed.data.config,
		p_config_hash: styleConfigHash(parsed.data.config),
		p_status: parsed.data.status,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new StyleServiceError(503, 'STYLE_SAVE_FAILED', 'O servidor não retornou a revisão.');
	return { revision: data };
}

export async function saveEpisodeStyleOverride(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	config: unknown;
}): Promise<void> {
	const parsed = styleOverrideSchema.safeParse(input.config);
	if (!parsed.success)
		throw new StyleServiceError(400, 'STYLE_OVERRIDE_INVALID', 'Override de episódio inválido.');
	if (parsed.data.sfxAssetIds?.length)
		await validateSfxAssets(
			input.db,
			input.owner,
			styleConfigSchema.parse({ schemaVersion: 1, ...parsed.data }),
		);
	if (!input.adminDb)
		throw new StyleServiceError(
			503,
			'STYLE_WRITE_UNAVAILABLE',
			'O writer de estilo não está configurado.',
		);
	const { error } = await input.adminDb.rpc('save_episode_style_override', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_config: parsed.data,
	});
	if (error) throw mapRpcError(error);
}

export async function saveSceneStyleOverride(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	sceneId: string;
	config: unknown;
}): Promise<void> {
	const parsed = styleOverrideSchema.safeParse(input.config);
	if (!parsed.success)
		throw new StyleServiceError(400, 'STYLE_OVERRIDE_INVALID', 'Override de cena inválido.');
	if (parsed.data.sfxAssetIds?.length)
		await validateSfxAssets(
			input.db,
			input.owner,
			styleConfigSchema.parse({ schemaVersion: 1, ...parsed.data }),
		);
	if (!input.adminDb)
		throw new StyleServiceError(
			503,
			'STYLE_WRITE_UNAVAILABLE',
			'O writer de estilo não está configurado.',
		);
	const { error } = await input.adminDb.rpc('save_scene_style_override', {
		p_owner_id: input.owner.id,
		p_scene_id: input.sceneId,
		p_config: parsed.data,
	});
	if (error) throw mapRpcError(error);
}

export async function clearEpisodeStyleOverride(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
}): Promise<boolean> {
	if (!input.adminDb)
		throw new StyleServiceError(
			503,
			'STYLE_WRITE_UNAVAILABLE',
			'O writer de estilo não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('clear_episode_style_override', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
	});
	if (error) throw mapRpcError(error);
	return data === true;
}

export async function clearSceneStyleOverride(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	sceneId: string;
}): Promise<boolean> {
	if (!input.adminDb)
		throw new StyleServiceError(
			503,
			'STYLE_WRITE_UNAVAILABLE',
			'O writer de estilo não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('clear_scene_style_override', {
		p_owner_id: input.owner.id,
		p_scene_id: input.sceneId,
	});
	if (error) throw mapRpcError(error);
	return data === true;
}

export async function loadPresetsBulk(
	db: SupabaseClient,
	owner: User,
	rows: PresetRow[],
): Promise<StylePreset[]> {
	const ids = rows.map((row) => row.id);
	const revisionsByPreset = new Map<string, StyleRevision[]>();
	for (let index = 0; index < ids.length; index += 25) {
		const chunk = ids.slice(index, index + 25);
		for (let from = 0; ; from += 1_000) {
			const { data, error } = await db
				.from('style_preset_revisions')
				.select('*')
				.eq('owner_id', owner.id)
				.in('preset_id', chunk)
				.order('revision_number', { ascending: false })
				.range(from, from + 999);
			if (error)
				throw new StyleServiceError(
					503,
					'STYLE_LOAD_FAILED',
					'Não foi possível carregar o estilo.',
				);
			for (const revision of (data ?? []) as RevisionRow[]) {
				const parsed = parseRevision(revision);
				const list = revisionsByPreset.get(revision.preset_id) ?? [];
				list.push(parsed);
				revisionsByPreset.set(revision.preset_id, list);
			}
			if ((data ?? []).length < 1_000) break;
		}
	}
	return rows.map((preset) => {
		const revisions = (revisionsByPreset.get(preset.id) ?? []).sort(
			(left, right) => right.revision - left.revision,
		);
		return {
			id: preset.id,
			scopeType: preset.scope_type as StyleScopeType,
			scopeId: preset.scope_id,
			name: preset.name,
			revisions,
			latestRevision: revisions[0]?.revision ?? 0,
			approved: revisions.find((revision) => revision.status === 'APPROVED') ?? null,
		};
	});
}

export async function loadStylePageContext(
	db: SupabaseClient,
	owner: User,
): Promise<StylePageContext> {
	const [
		seriesResult,
		seasonsResult,
		episodesResult,
		presetsResult,
		episodesOverrides,
		scenesOverrides,
	] = await Promise.all([
		db.from('series').select('id,title').eq('owner_id', owner.id).order('title').limit(200),
		db
			.from('seasons')
			.select('id,title,series_id,series(title)')
			.eq('owner_id', owner.id)
			.order('season_number')
			.limit(500),
		db
			.from('episodes')
			.select('id,title,episode_number,seasons(id,series_id,title,series(title))')
			.eq('owner_id', owner.id)
			.order('episode_number')
			.limit(1_000),
		db.from('style_presets').select('*').eq('owner_id', owner.id).limit(500),
		db
			.from('episode_style_overrides')
			.select('episode_id,config')
			.eq('owner_id', owner.id)
			.limit(1_000),
		db
			.from('scene_style_overrides')
			.select('scene_id,config,scenes(episode_id)')
			.eq('owner_id', owner.id)
			.limit(1_000),
	]);
	if (
		seriesResult.error ||
		seasonsResult.error ||
		episodesResult.error ||
		presetsResult.error ||
		episodesOverrides.error ||
		scenesOverrides.error
	)
		throw new StyleServiceError(503, 'STYLE_LOAD_FAILED', 'Não foi possível carregar a bíblia.');
	const presets = await loadPresetsBulk(db, owner, (presetsResult.data ?? []) as PresetRow[]);
	const series = (seriesResult.data ?? []).map((row) => ({
		id: row.id as string,
		title: row.title as string,
	}));
	const seasons = ((seasonsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
		const related = firstRelation(row.series) as { title?: string } | null;
		return {
			id: row.id as string,
			title: row.title as string,
			seriesId: row.series_id as string,
			seriesTitle: related?.title ?? 'Série',
		};
	});
	const episodes = ((episodesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
		const season = firstRelation(row.seasons) as {
			id?: string;
			title?: string;
			series_id?: string;
			series?: unknown;
		} | null;
		const related = season ? (firstRelation(season.series) as { title?: string } | null) : null;
		return {
			id: row.id as string,
			title: row.title as string,
			number: Number(row.episode_number),
			seriesTitle: related?.title ?? 'Série',
			seriesId: season?.series_id ?? null,
			seasonId: season?.id ?? null,
		};
	});
	const episodeOverrides = ((episodesOverrides.data ?? []) as Array<Record<string, unknown>>).map(
		(row) => ({
			episodeId: row.episode_id as string,
			config: styleOverrideSchema.parse(row.config),
		}),
	);
	const sceneOverrides = ((scenesOverrides.data ?? []) as Array<Record<string, unknown>>).map(
		(row) => {
			const scene = firstRelation(row.scenes) as { episode_id?: string } | null;
			return {
				sceneId: row.scene_id as string,
				episodeId: scene?.episode_id ?? '',
				config: styleOverrideSchema.parse(row.config),
			};
		},
	);
	return { presets, series, seasons, episodes, episodeOverrides, sceneOverrides };
}

interface SfxAudit {
	valid: Set<string>;
	missing: boolean;
	unlicensed: boolean;
}

async function auditSfxAssets(db: SupabaseClient, owner: User, ids: string[]): Promise<SfxAudit> {
	const unique = [...new Set(ids)];
	if (!unique.length) return { valid: new Set(), missing: false, unlicensed: false };
	const rows: Array<Record<string, unknown>> = [];
	for (let index = 0; index < unique.length; index += 50) {
		const { data, error } = await db
			.from('audio_assets')
			.select('id,license_status,commercial_allowed,social_allowed')
			.eq('owner_id', owner.id)
			.in('id', unique.slice(index, index + 50));
		if (error)
			throw new StyleServiceError(
				503,
				'STYLE_ASSET_LOAD_FAILED',
				'Não foi possível validar os SFX.',
			);
		rows.push(...(data ?? []));
	}
	const present = new Set(rows.map((row) => row.id as string));
	const valid = new Set(
		rows
			.filter(
				(row) =>
					row.license_status === 'VERIFIED' &&
					row.commercial_allowed === true &&
					row.social_allowed === true,
			)
			.map((row) => row.id as string),
	);
	return {
		valid,
		missing: unique.some((id) => !present.has(id)),
		unlicensed: rows.some((row) => !valid.has(row.id as string)),
	};
}

export async function resolveEpisodeStyleSnapshot(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<StyleSnapshot> {
	const { data: episode, error } = await db
		.from('episodes')
		.select('id,seasons(id,series_id)')
		.eq('owner_id', owner.id)
		.eq('id', episodeId)
		.maybeSingle();
	if (error || !episode)
		throw new StyleServiceError(404, 'STYLE_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	const season = firstRelation(episode.seasons) as { id?: string; series_id?: string } | null;
	const seriesId = season?.series_id ?? null;
	const seasonId = season?.id ?? null;
	const [seriesPreset, seasonPreset, episodeOverride, scenesResult] = await Promise.all([
		seriesId ? loadPresetForScope(db, owner, 'SERIES', seriesId) : Promise.resolve(null),
		seasonId ? loadPresetForScope(db, owner, 'SEASON', seasonId) : Promise.resolve(null),
		db
			.from('episode_style_overrides')
			.select('config')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.maybeSingle(),
		db
			.from('scenes')
			.select('id,scene_index')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('scene_index')
			.limit(200),
	]);
	if (episodeOverride.error || scenesResult.error)
		throw new StyleServiceError(503, 'STYLE_LOAD_FAILED', 'Não foi possível carregar o estilo.');
	const sceneRows = (scenesResult.data ?? []).map((row) => ({
		id: row.id as string,
		index: Number(row.scene_index),
	}));
	const sceneIds = sceneRows.map((scene) => scene.id);
	const sceneOverrideRows: Array<Record<string, unknown>> = [];
	for (let index = 0; index < sceneIds.length; index += 50) {
		const { data, error } = await db
			.from('scene_style_overrides')
			.select('scene_id,config')
			.eq('owner_id', owner.id)
			.in('scene_id', sceneIds.slice(index, index + 50));
		if (error)
			throw new StyleServiceError(503, 'STYLE_LOAD_FAILED', 'Não foi possível carregar o estilo.');
		sceneOverrideRows.push(...(data ?? []));
	}
	const overridesByScene = new Map(
		sceneOverrideRows.map((row) => [row.scene_id as string, styleOverrideSchema.parse(row.config)]),
	);
	const layers: StyleLayer[] = [
		{
			source: 'SERIES',
			config: seriesPreset?.approved?.config ?? null,
			revision: seriesPreset?.approved?.revision ?? null,
		},
		{
			source: 'SEASON',
			config: seasonPreset?.approved?.config ?? null,
			revision: seasonPreset?.approved?.revision ?? null,
		},
		{
			source: 'EPISODE',
			config: episodeOverride.data ? styleOverrideSchema.parse(episodeOverride.data.config) : null,
			revision: null,
		},
	];
	const resolved = resolveStyle(layers);
	const resolvedScenes = sceneRows.flatMap((scene) => {
		const override = overridesByScene.get(scene.id);
		if (!override) return [];
		const sceneResolved = resolveStyle([
			...layers,
			{ source: 'SCENE', config: override, revision: null },
		]);
		return [
			{
				sceneId: scene.id,
				sceneIndex: scene.index,
				config: sceneResolved.config,
				sources: sceneResolved.sources,
				versions: sceneResolved.versions,
			},
		];
	});
	if (resolvedScenes.length > 60)
		throw new StyleServiceError(
			409,
			'STYLE_SCENE_LIMIT',
			'O snapshot aceita no máximo 60 cenas com override.',
		);
	const audit = await auditSfxAssets(db, owner, [
		...resolved.config.sfxAssetIds,
		...resolvedScenes.flatMap((scene) => scene.config.sfxAssetIds),
	]);
	const chosen = seasonPreset?.approved ?? seriesPreset?.approved ?? null;
	const warnings: string[] = [];
	if (!chosen) warnings.push('STYLE_PRESET_MISSING');
	if (audit.missing) warnings.push('STYLE_SFX_UNAVAILABLE');
	if (audit.unlicensed) warnings.push('STYLE_SFX_LICENSE');
	return {
		presetId:
			(seasonPreset?.approved
				? seasonPreset.id
				: seriesPreset?.approved
					? seriesPreset.id
					: null) ?? null,
		presetRevision: chosen?.revision ?? null,
		presetHash: chosen?.configHash ?? null,
		scopeType: seasonPreset?.approved ? 'SEASON' : seriesPreset?.approved ? 'SERIES' : null,
		scopeId: seasonPreset?.approved ? seasonId : seriesPreset?.approved ? seriesId : null,
		config: withdrawInvalidSfx(resolved.config, audit.valid),
		sources: resolved.sources,
		versions: resolved.versions,
		scenes: resolvedScenes.map((scene) => ({
			...scene,
			config: withdrawInvalidSfx(scene.config, audit.valid),
		})),
		warnings,
		capturedAt: new Date().toISOString(),
	};
}

export async function exportStylePreset(
	db: SupabaseClient,
	owner: User,
	presetId: string,
): Promise<{
	format: 'dif-studio-style-preset/v1';
	scopeType: string;
	scopeId: string;
	name: string;
	config: StyleConfig;
}> {
	const { data: preset, error } = await db
		.from('style_presets')
		.select('*')
		.eq('owner_id', owner.id)
		.eq('id', presetId)
		.maybeSingle();
	if (error)
		throw new StyleServiceError(503, 'STYLE_LOAD_FAILED', 'Não foi possível carregar o preset.');
	if (!preset) throw new StyleServiceError(404, 'STYLE_NOT_FOUND', 'Preset não encontrado.');
	const loaded = await loadPresetForScope(
		db,
		owner,
		preset.scope_type as StyleScopeType,
		preset.scope_id,
	);
	const revision = loaded?.approved ?? loaded?.revisions[0] ?? null;
	if (!revision) throw new StyleServiceError(404, 'STYLE_NOT_FOUND', 'O preset não tem revisões.');
	return {
		format: 'dif-studio-style-preset/v1',
		scopeType: preset.scope_type as string,
		scopeId: preset.scope_id as string,
		name: preset.name as string,
		config: revision.config,
	};
}

export async function importStylePreset(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	payload: unknown;
}): Promise<number> {
	const parsed = styleImportSchema.safeParse(input.payload);
	if (!parsed.success)
		throw new StyleServiceError(400, 'STYLE_IMPORT_INVALID', 'JSON de estilo inválido.');
	const existing = await loadPresetForScope(
		input.db,
		input.owner,
		parsed.data.scopeType,
		parsed.data.scopeId,
	);
	return (
		await saveStylePreset({
			db: input.db,
			adminDb: input.adminDb,
			owner: input.owner,
			values: {
				scopeType: parsed.data.scopeType,
				scopeId: parsed.data.scopeId,
				name: existing?.name ?? parsed.data.name,
				expectedRevision: existing?.latestRevision ?? 0,
				config: parsed.data.config,
				status: 'DRAFT',
			},
		})
	).revision;
}

export const STYLE_HASH_VERSION_EXPORT = STYLE_HASH_VERSION;
