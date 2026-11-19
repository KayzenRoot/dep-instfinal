import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	visualContinuityDecisionSchema,
	visualContinuityReportSchema,
	type VisualContinuityDecision,
	type VisualContinuityReport,
} from '#lib/schemas/visual-continuity.js';
import {
	applyContinuityDecision,
	buildVisualContinuityReport,
	visualContinuityReportHash,
	type VisualContinuityInput,
	type VisualSceneInput,
} from '#lib/domain/visual-continuity.js';
import type { CharacterIdentityProfile } from '#lib/schemas/character-identity.js';
import { characterIdentityProfileSchema } from '#lib/schemas/character-identity.js';
import { identityProfileHash } from '#lib/domain/character-identity.js';
import { measurePrivateImageAssets, type PrivateImageAsset } from './media-stats.js';
import { firstRelation } from './relations.js';

export class VisualContinuityError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'VisualContinuityError';
	}
}

interface ReportRow {
	id: string;
	revision_number: number;
	status: string;
	blocking_count: number;
	observation_count: number;
	report: unknown;
	report_hash: string;
	created_at: string;
	supersedes_report_id?: string | null;
}

export interface StoredContinuityReport {
	id: string;
	revision: number;
	status: string;
	blockingCount: number;
	observationCount: number;
	report: VisualContinuityReport;
	reportHash: string;
	createdAt: string;
}

function parseReportRow(row: ReportRow): StoredContinuityReport {
	const parsed = visualContinuityReportSchema.safeParse(row.report);
	if (!parsed.success)
		throw new VisualContinuityError(
			500,
			'CONTINUITY_STORED_INVALID',
			'O relatório de continuidade armazenado é inválido.',
		);
	if (visualContinuityReportHash(parsed.data) !== row.report_hash)
		throw new VisualContinuityError(
			500,
			'CONTINUITY_HASH_MISMATCH',
			'O hash do relatório de continuidade não confere.',
		);
	return {
		id: row.id,
		revision: Number(row.revision_number),
		status: row.status,
		blockingCount: Number(row.blocking_count),
		observationCount: Number(row.observation_count),
		report: parsed.data,
		reportHash: row.report_hash,
		createdAt: row.created_at,
	};
}

function mapRpcError(error: { code?: string; message?: string }): VisualContinuityError {
	if (error.code === '40001')
		return new VisualContinuityError(
			409,
			'CONTINUITY_REVISION_CONFLICT',
			'O relatório foi atualizado em outra aba. Recarregue antes de decidir.',
		);
	if (error.code === 'P0002')
		return new VisualContinuityError(
			404,
			'CONTINUITY_NOT_FOUND',
			'Episódio ou relatório não encontrado.',
		);
	if (error.code === '42501')
		return new VisualContinuityError(403, 'CONTINUITY_FORBIDDEN', 'Acesso não autorizado.');
	if (error.code === '23514')
		return new VisualContinuityError(
			400,
			'CONTINUITY_INVALID',
			'Relatório de continuidade inválido.',
		);
	return new VisualContinuityError(
		503,
		'CONTINUITY_SAVE_FAILED',
		'Não foi possível salvar o relatório de continuidade.',
	);
}

export async function loadLatestVisualContinuityReport(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<StoredContinuityReport | null> {
	const { data, error } = await db
		.from('visual_continuity_reports')
		.select(
			'id,revision_number,status,blocking_count,observation_count,report,report_hash,created_at,supersedes_report_id',
		)
		.eq('owner_id', owner.id)
		.eq('episode_id', episodeId)
		.order('revision_number', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar o relatório de continuidade.',
		);
	return data ? parseReportRow(data as ReportRow) : null;
}

export async function loadContinuityReportHistory(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<Array<{ revision: number; status: string; blockingCount: number; createdAt: string }>> {
	const { data, error } = await db
		.from('visual_continuity_reports')
		.select('revision_number,status,blocking_count,created_at')
		.eq('owner_id', owner.id)
		.eq('episode_id', episodeId)
		.order('revision_number', { ascending: false })
		.limit(20);
	if (error)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar o histórico de continuidade.',
		);
	return (
		(data ?? []) as Array<{
			revision_number: number;
			status: string;
			blocking_count: number;
			created_at: string;
		}>
	).map((row) => ({
		revision: Number(row.revision_number),
		status: row.status,
		blockingCount: Number(row.blocking_count),
		createdAt: row.created_at,
	}));
}

export interface ContinuityInspectorContext {
	episode: {
		id: string;
		number: number;
		title: string;
		status: string;
		seriesId: string;
		seriesTitle: string;
	};
	scenes: Array<{
		id: string;
		sceneIndex: number;
		characterNotes: string;
		location: string;
		transition: string;
		startFrameAssetId: string | null;
		endFrameAssetId: string | null;
	}>;
	latest: StoredContinuityReport | null;
	history: Array<{ revision: number; status: string; blockingCount: number; createdAt: string }>;
}

export async function loadContinuityInspectorContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<ContinuityInspectorContext | null> {
	const { data: episode, error } = await db
		.from('episodes')
		.select('id,episode_number,title,status,seasons(series_id,series(title))')
		.eq('owner_id', owner.id)
		.eq('id', episodeId)
		.maybeSingle();
	if (error)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar o episódio.',
		);
	if (!episode) return null;
	const season = firstRelation(episode.seasons);
	const series = season ? firstRelation((season as { series?: unknown }).series) : null;
	const seriesId = (season as { series_id?: string } | null)?.series_id;
	if (!seriesId)
		throw new VisualContinuityError(503, 'CONTINUITY_LOAD_FAILED', 'O episódio não tem série.');
	const [{ data: scenes, error: scenesError }, latest, history] = await Promise.all([
		db
			.from('scenes')
			.select(
				'id,scene_index,character_notes,location,transition,start_frame_asset_id,end_frame_asset_id',
			)
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('scene_index'),
		loadLatestVisualContinuityReport(db, owner, episodeId),
		loadContinuityReportHistory(db, owner, episodeId),
	]);
	if (scenesError)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar as cenas.',
		);
	return {
		episode: {
			id: episode.id,
			number: Number(episode.episode_number),
			title: episode.title,
			status: episode.status,
			seriesId,
			seriesTitle: (series as { title?: string } | null)?.title ?? 'Série',
		},
		scenes: (
			(scenes ?? []) as Array<{
				id: string;
				scene_index: number;
				character_notes: string;
				location: string;
				transition: string;
				start_frame_asset_id: string | null;
				end_frame_asset_id: string | null;
			}>
		).map((scene) => ({
			id: scene.id,
			sceneIndex: Number(scene.scene_index),
			characterNotes: scene.character_notes,
			location: scene.location,
			transition: scene.transition,
			startFrameAssetId: scene.start_frame_asset_id,
			endFrameAssetId: scene.end_frame_asset_id,
		})),
		latest,
		history,
	};
}

async function loadCharactersWithProfiles(
	db: SupabaseClient,
	owner: User,
	seriesId: string,
): Promise<VisualContinuityInput['characters']> {
	const [{ data: characters, error: characterError }, { data: profiles, error: profileError }] =
		await Promise.all([
			db.from('characters').select('id,name').eq('owner_id', owner.id).eq('series_id', seriesId),
			db
				.from('character_identity_profiles')
				.select('character_id,current_version,profile,profile_hash')
				.eq('owner_id', owner.id)
				.eq('series_id', seriesId),
		]);
	if (characterError || profileError)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar personagens e perfis.',
		);
	const profileByCharacter = new Map<
		string,
		{ version: number; profile: CharacterIdentityProfile }
	>();
	for (const row of (profiles ?? []) as Array<{
		character_id: string;
		current_version: number;
		profile: unknown;
		profile_hash: string;
	}>) {
		const parsed = characterIdentityProfileSchema.safeParse(row.profile);
		if (!parsed.success || identityProfileHash(parsed.data) !== row.profile_hash)
			throw new VisualContinuityError(
				500,
				'CONTINUITY_PROFILE_INVALID',
				'Um perfil de identidade armazenado é inválido.',
			);
		profileByCharacter.set(row.character_id, {
			version: Number(row.current_version),
			profile: parsed.data,
		});
	}
	return ((characters ?? []) as Array<{ id: string; name: string }>).map((character) => {
		const current = profileByCharacter.get(character.id);
		return {
			id: character.id,
			name: character.name,
			version: current?.version ?? 0,
			profile: current?.profile ?? null,
		};
	});
}

export async function generateVisualContinuityReport(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
}): Promise<{ report: VisualContinuityReport; revision: number; reportHash: string }> {
	const context = await loadContinuityInspectorContext(input.db, input.owner, input.episodeId);
	if (!context)
		throw new VisualContinuityError(
			404,
			'CONTINUITY_EPISODE_NOT_FOUND',
			'Episódio não encontrado.',
		);
	const [{ data: revisionRow, error: revisionError }, characters, latest] = await Promise.all([
		input.db
			.from('episode_revisions')
			.select('revision_number')
			.eq('owner_id', input.owner.id)
			.eq('episode_id', input.episodeId)
			.order('revision_number', { ascending: false })
			.limit(1)
			.maybeSingle(),
		loadCharactersWithProfiles(input.db, input.owner, context.episode.seriesId),
		loadLatestVisualContinuityReport(input.db, input.owner, input.episodeId),
	]);
	if (revisionError)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar a revisão do episódio.',
		);
	const { data: sceneRows, error: scenesError } = await input.db
		.from('scenes')
		.select(
			'id,scene_index,character_notes,visual_description,location,lighting_notes,transition,start_frame_asset_id,end_frame_asset_id',
		)
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.order('scene_index');
	if (scenesError)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_LOAD_FAILED',
			'Não foi possível carregar as cenas.',
		);
	const scenes: VisualSceneInput[] = (
		(sceneRows ?? []) as Array<{
			id: string;
			scene_index: number;
			character_notes: string;
			visual_description: string;
			location: string;
			lighting_notes: string;
			transition: string;
			start_frame_asset_id: string | null;
			end_frame_asset_id: string | null;
		}>
	).map((scene) => ({
		id: scene.id,
		sceneIndex: Number(scene.scene_index),
		characterNotes: scene.character_notes,
		visualDescription: scene.visual_description,
		location: scene.location,
		lightingNotes: scene.lighting_notes,
		transition: scene.transition,
		startFrameAssetId: scene.start_frame_asset_id,
		endFrameAssetId: scene.end_frame_asset_id,
	}));
	const assetIds = [
		...new Set(
			scenes.flatMap((scene) =>
				[scene.startFrameAssetId, scene.endFrameAssetId].filter((value): value is string =>
					Boolean(value),
				),
			),
		),
	];
	let assets: PrivateImageAsset[] = [];
	if (assetIds.length) {
		const { data: assetRows, error: assetsError } = await input.db
			.from('media_assets')
			.select('id,public_id,format,delivery_type')
			.eq('owner_id', input.owner.id)
			.eq('upload_status', 'READY')
			.eq('resource_type', 'image')
			.in('id', assetIds);
		if (assetsError)
			throw new VisualContinuityError(
				503,
				'CONTINUITY_LOAD_FAILED',
				'Não foi possível carregar os frames privados.',
			);
		assets = ((assetRows ?? []) as PrivateImageAsset[]).filter((asset) =>
			['authenticated', 'private'].includes(asset.delivery_type),
		);
	}
	const budget = Number(process.env.CONTINUITY_SAMPLING_BUDGET_MS);
	const measured = await measurePrivateImageAssets(
		assets,
		4,
		Number.isFinite(budget) && budget > 0 ? budget : 60_000,
	);
	const frameStats: VisualContinuityInput['frameStats'] = {};
	for (const assetId of assetIds) frameStats[assetId] = measured.get(assetId) ?? null;
	const report = buildVisualContinuityReport({
		episodeId: input.episodeId,
		seriesId: context.episode.seriesId,
		episodeNumber: context.episode.number,
		episodeRevisionNumber: revisionRow ? Number(revisionRow.revision_number) : null,
		generatedAt: new Date().toISOString(),
		scenes,
		characters,
		frameStats,
		previous: latest?.report ?? null,
	});
	if (!input.adminDb)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_WRITE_UNAVAILABLE',
			'O writer de continuidade não está configurado.',
		);
	const parsedReport = visualContinuityReportSchema.safeParse(report);
	if (!parsedReport.success)
		throw new VisualContinuityError(
			400,
			'CONTINUITY_REPORT_INVALID',
			'O relatório excede os limites de observações ou limitações. Reduza o escopo e gere novamente.',
		);
	const reportHash = visualContinuityReportHash(parsedReport.data);
	const { data, error } = await input.adminDb.rpc('save_visual_continuity_report', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_expected_revision: latest?.revision ?? 0,
		p_report: parsedReport.data,
		p_report_hash: reportHash,
		p_supersedes_report_id: latest?.id ?? null,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new VisualContinuityError(
			503,
			'CONTINUITY_SAVE_FAILED',
			'O servidor não retornou a revisão.',
		);
	return { report: parsedReport.data, revision: data, reportHash };
}

export async function decideVisualContinuity(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	decision: VisualContinuityDecision;
}): Promise<number> {
	const parsed = visualContinuityDecisionSchema.safeParse(input.decision);
	if (!parsed.success)
		throw new VisualContinuityError(400, 'CONTINUITY_DECISION_INVALID', 'Decisão inválida.');
	const latest = await loadLatestVisualContinuityReport(input.db, input.owner, input.episodeId);
	if (!latest)
		throw new VisualContinuityError(
			404,
			'CONTINUITY_REPORT_MISSING',
			'Gere o relatório antes de decidir.',
		);
	let report: VisualContinuityReport;
	try {
		report = applyContinuityDecision(latest.report, parsed.data);
	} catch {
		throw new VisualContinuityError(
			404,
			'CONTINUITY_OBSERVATION_NOT_FOUND',
			'Observação não encontrada no relatório atual.',
		);
	}
	if (!input.adminDb)
		throw new VisualContinuityError(
			503,
			'CONTINUITY_WRITE_UNAVAILABLE',
			'O writer de continuidade não está configurado.',
		);
	const parsedReport = visualContinuityReportSchema.safeParse(report);
	if (!parsedReport.success)
		throw new VisualContinuityError(
			400,
			'CONTINUITY_REPORT_INVALID',
			'O relatório excede os limites do schema.',
		);
	const reportHash = visualContinuityReportHash(parsedReport.data);
	const { data, error } = await input.adminDb.rpc('save_visual_continuity_report', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_expected_revision: latest.revision,
		p_report: parsedReport.data,
		p_report_hash: reportHash,
		p_supersedes_report_id: latest.id,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new VisualContinuityError(
			503,
			'CONTINUITY_SAVE_FAILED',
			'O servidor não retornou a revisão.',
		);
	return data;
}

export async function continuityExportGate(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<{
	hasReport: boolean;
	status: string | null;
	blockingCount: number;
	revision: number | null;
}> {
	const latest = await loadLatestVisualContinuityReport(db, owner, episodeId);
	return latest
		? {
				hasReport: true,
				status: latest.status,
				blockingCount: latest.blockingCount,
				revision: latest.revision,
			}
		: { hasReport: false, status: null, blockingCount: 0, revision: null };
}
