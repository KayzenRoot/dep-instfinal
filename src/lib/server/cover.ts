import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	coverConfigSchema,
	type CoverConfig,
	type CoverRevisionStatus,
} from '#lib/schemas/cover.js';
import { coverConfigHash } from '#lib/domain/cover-hash.js';
import { firstRelation } from './relations.js';

export class CoverError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'CoverError';
	}
}

interface CoverRevisionRow {
	id: string;
	episode_id: string;
	revision_number: number;
	template_id: string;
	format: string;
	status: string;
	config: unknown;
	config_hash: string;
	hash_version: number;
	created_at: string;
}

export interface CoverRevision {
	id: string;
	episodeId: string;
	revision: number;
	templateId: string;
	format: string;
	status: string;
	config: CoverConfig;
	createdAt: string;
}

function parseRevision(row: CoverRevisionRow): CoverRevision {
	const parsed = coverConfigSchema.safeParse(row.config);
	if (!parsed.success)
		throw new CoverError(500, 'COVER_STORED_INVALID', 'Configuração de capa armazenada inválida.');
	let storedHash: string;
	try {
		storedHash = coverConfigHash(parsed.data, Number(row.hash_version));
	} catch {
		throw new CoverError(
			500,
			'COVER_HASH_VERSION_UNSUPPORTED',
			'A versão de hash desta capa não é suportada por este servidor.',
		);
	}
	if (storedHash !== row.config_hash)
		throw new CoverError(500, 'COVER_HASH_MISMATCH', 'O hash da capa armazenada não confere.');
	return {
		id: row.id,
		episodeId: row.episode_id,
		revision: Number(row.revision_number),
		templateId: row.template_id,
		format: row.format,
		status: row.status,
		config: parsed.data,
		createdAt: row.created_at,
	};
}

function mapRpcError(error: { code?: string; message?: string }): CoverError {
	if (error.code === '40001')
		return new CoverError(
			409,
			'COVER_REVISION_CONFLICT',
			'As capas foram alteradas em outra aba. Recarregue antes de salvar.',
		);
	if (error.code === 'P0002')
		return new CoverError(404, 'COVER_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	if (error.code === '23514' && error.message?.includes('cover_revision_quota'))
		return new CoverError(
			409,
			'COVER_REVISION_QUOTA',
			'Limite de 500 revisões de capa atingido. Um operador pode podar o histórico antigo.',
		);
	if (error.code === '23514')
		return new CoverError(400, 'COVER_INVALID', 'Configuração de capa inválida.');
	if (error.code === '42501')
		return new CoverError(403, 'COVER_FORBIDDEN', 'Acesso não autorizado.');
	return new CoverError(503, 'COVER_SAVE_FAILED', 'Não foi possível salvar a capa.');
}

export interface CoverContext {
	episode: {
		id: string;
		number: number;
		title: string;
		seriesTitle: string;
	};
	frames: Array<{
		assetId: string;
		label: string;
		sceneIndex: number | null;
		role: 'START' | 'END' | 'ASSET';
	}>;
	assets: Array<{
		id: string;
		assetKind: string;
		width: number | null;
		height: number | null;
	}>;
	revisions: CoverRevision[];
}

export async function loadCoverContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<CoverContext | null> {
	const { data: episode, error } = await db
		.from('episodes')
		.select('id,title,episode_number,seasons(series(title))')
		.eq('owner_id', owner.id)
		.eq('id', episodeId)
		.maybeSingle();
	if (error)
		throw new CoverError(503, 'COVER_LOAD_FAILED', 'Não foi possível carregar o episódio.');
	if (!episode) return null;
	const season = firstRelation(episode.seasons);
	const series = season ? firstRelation((season as { series?: unknown }).series) : null;
	const [
		{ data: scenes, error: scenesError },
		{ data: assets, error: assetsError },
		{ data: revisions, error: revisionError },
	] = await Promise.all([
		db
			.from('scenes')
			.select('id,scene_index,start_frame_asset_id,end_frame_asset_id')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('scene_index'),
		db
			.from('media_assets')
			.select('id,asset_kind,width,height')
			.eq('owner_id', owner.id)
			.eq('upload_status', 'READY')
			.in('asset_kind', ['FRAME', 'REFERENCE'])
			.order('created_at', { ascending: false })
			.limit(80),
		db
			.from('cover_revisions')
			.select(
				'id,episode_id,revision_number,template_id,format,status,config,config_hash,created_at',
			)
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('revision_number', { ascending: false })
			.limit(30),
	]);
	if (scenesError || assetsError || revisionError)
		throw new CoverError(503, 'COVER_LOAD_FAILED', 'Não foi possível carregar as capas.');
	const frames = new Map<
		string,
		{ assetId: string; label: string; sceneIndex: number | null; role: 'START' | 'END' | 'ASSET' }
	>();
	for (const scene of (scenes ?? []) as Array<{
		scene_index: number;
		start_frame_asset_id: string | null;
		end_frame_asset_id: string | null;
	}>) {
		if (scene.start_frame_asset_id)
			frames.set(scene.start_frame_asset_id, {
				assetId: scene.start_frame_asset_id,
				label: `Cena ${scene.scene_index} · frame inicial`,
				sceneIndex: Number(scene.scene_index),
				role: 'START',
			});
		if (scene.end_frame_asset_id)
			frames.set(scene.end_frame_asset_id, {
				assetId: scene.end_frame_asset_id,
				label: `Cena ${scene.scene_index} · frame final`,
				sceneIndex: Number(scene.scene_index),
				role: 'END',
			});
	}
	for (const asset of (assets ?? []) as Array<{ id: string; asset_kind: string }>) {
		if (!frames.has(asset.id))
			frames.set(asset.id, {
				assetId: asset.id,
				label: `${asset.asset_kind} · ${asset.id.slice(0, 8)}`,
				sceneIndex: null,
				role: 'ASSET',
			});
	}
	return {
		episode: {
			id: episode.id,
			number: Number(episode.episode_number),
			title: episode.title,
			seriesTitle: (series as { title?: string } | null)?.title ?? 'Série',
		},
		frames: [...frames.values()],
		assets: (
			(assets ?? []) as Array<{
				id: string;
				asset_kind: string;
				width: number | null;
				height: number | null;
			}>
		).map((asset) => ({
			id: asset.id,
			assetKind: asset.asset_kind,
			width: asset.width,
			height: asset.height,
		})),
		revisions: ((revisions ?? []) as CoverRevisionRow[]).map(parseRevision),
	};
}

async function assertFrameAsset(
	db: SupabaseClient,
	ownerId: string,
	frameAssetId: string | null,
): Promise<void> {
	if (!frameAssetId) return;
	const { data, error } = await db
		.from('media_assets')
		.select('id,upload_status,resource_type')
		.eq('owner_id', ownerId)
		.eq('id', frameAssetId)
		.maybeSingle();
	if (error || !data || data.upload_status !== 'READY' || data.resource_type !== 'image')
		throw new CoverError(400, 'COVER_FRAME_INVALID', 'O frame precisa ser uma imagem READY.');
}

export async function saveCoverRevision(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	expectedRevision: number;
	config: CoverConfig;
	status?: CoverRevisionStatus;
}): Promise<number> {
	const parsed = coverConfigSchema.safeParse(input.config);
	if (!parsed.success) throw new CoverError(400, 'COVER_INVALID', 'Configuração de capa inválida.');
	const { data: episode, error } = await input.db
		.from('episodes')
		.select('id')
		.eq('owner_id', input.owner.id)
		.eq('id', input.episodeId)
		.maybeSingle();
	if (error)
		throw new CoverError(503, 'COVER_LOAD_FAILED', 'Não foi possível carregar o episódio.');
	if (!episode) throw new CoverError(404, 'COVER_EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	await assertFrameAsset(input.db, input.owner.id, parsed.data.frameAssetId);
	if (!input.adminDb)
		throw new CoverError(503, 'COVER_WRITE_UNAVAILABLE', 'O writer de capas não está configurado.');
	const { data, error: rpcError } = await input.adminDb.rpc('save_cover_revision', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_expected_revision: input.expectedRevision,
		p_config: parsed.data,
		p_config_hash: coverConfigHash(parsed.data),
		p_status: input.status ?? 'DRAFT',
	});
	if (rpcError) throw mapRpcError(rpcError);
	if (typeof data !== 'number')
		throw new CoverError(503, 'COVER_SAVE_FAILED', 'O servidor não retornou a revisão.');
	return data;
}

export async function loadCoverRevision(
	db: SupabaseClient,
	owner: User,
	revisionId: string,
): Promise<CoverRevision | null> {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(revisionId))
		return null;
	const { data, error } = await db
		.from('cover_revisions')
		.select(
			'id,episode_id,revision_number,template_id,format,status,config,config_hash,hash_version,created_at',
		)
		.eq('owner_id', owner.id)
		.eq('id', revisionId)
		.maybeSingle();
	if (error) throw new CoverError(503, 'COVER_LOAD_FAILED', 'Não foi possível carregar a capa.');
	return data ? parseRevision(data as CoverRevisionRow) : null;
}

export async function restoreCoverRevision(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	revisionId: string;
	expectedRevision: number;
}): Promise<number> {
	const revision = await loadCoverRevision(input.db, input.owner, input.revisionId);
	if (!revision)
		throw new CoverError(404, 'COVER_REVISION_NOT_FOUND', 'Revisão de capa não encontrada.');
	return saveCoverRevision({
		db: input.db,
		adminDb: input.adminDb,
		owner: input.owner,
		episodeId: revision.episodeId,
		expectedRevision: input.expectedRevision,
		config: revision.config,
		status: 'DRAFT',
	});
}
