import { createHash } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { canonicalJson } from '#lib/domain/canonical-json.js';
import {
	compareVariantObservations,
	computeRetentionMetrics,
	parseRetentionCsv,
	RetentionError,
	type ComputedRetentionMetrics,
	type VariantObservation,
} from '#lib/domain/retention.js';
import {
	analyticsSnapshotInputSchema,
	creativeVariantInputSchema,
	experimentInputSchema,
	publishedPostInputSchema,
	type AnalyticsSnapshotInput,
	type CreativeVariantInput,
	type ExperimentInput,
	type PublishedPostInput,
	type RetentionPlatform,
	type RetentionVariantKind,
} from '#lib/schemas/retention.js';
import { firstRelation } from './relations.js';

export class RetentionServiceError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'RetentionServiceError';
	}
}

interface PostRow {
	id: string;
	episode_id: string;
	platform: string;
	url: string;
	published_at: string;
	label: string;
	notes: string;
	created_at: string;
	updated_at: string;
}

interface VariantRow {
	id: string;
	post_id: string;
	kind: string;
	label: string;
	hook_variant_id: string | null;
	cover_revision_id: string | null;
	end_card_id: string | null;
	created_at: string;
}

interface SnapshotRow {
	id: string;
	post_id: string;
	revision_number: number;
	supersedes_snapshot_id: string | null;
	captured_at: string;
	period_start: string;
	period_end: string;
	source: string;
	note: string;
	views: number | string | null;
	likes: number | string | null;
	comments: number | string | null;
	shares: number | string | null;
	saves: number | string | null;
	followers_gained: number | string | null;
	avg_watch_ms: number | null;
	completion_pct: number | string | null;
	snapshot_hash: string;
	created_at: string;
}

export interface RetentionSnapshot {
	id: string;
	postId: string;
	revision: number;
	supersedesSnapshotId: string | null;
	capturedAt: string;
	periodStart: string;
	periodEnd: string;
	source: string;
	note: string;
	metrics: {
		views: number | null;
		likes: number | null;
		comments: number | null;
		shares: number | null;
		saves: number | null;
		followersGained: number | null;
		avgWatchMs: number | null;
		completionPct: number | null;
	};
	computed: ComputedRetentionMetrics;
	snapshotHash: string;
	createdAt: string;
}

export interface RetentionPost {
	id: string;
	episodeId: string;
	platform: RetentionPlatform;
	url: string;
	publishedAt: string;
	label: string;
	notes: string;
	variants: Array<{
		id: string;
		kind: RetentionVariantKind;
		label: string;
		hookVariantId: string | null;
		coverRevisionId: string | null;
		endCardId: string | null;
	}>;
	latestSnapshot: RetentionSnapshot | null;
	snapshotCount: number;
}

export interface RetentionContext {
	episode: {
		id: string;
		title: string;
		number: number;
		durationMs: number;
		seriesTitle: string;
	};
	posts: RetentionPost[];
	experiments: Array<{
		id: string;
		name: string;
		hypothesis: string;
		status: string;
		variantAId: string;
		variantBId: string;
	}>;
	imports: Array<{
		id: string;
		filename: string;
		rowCount: number;
		importedCount: number;
		skippedCount: number;
		errorCount: number;
		createdAt: string;
	}>;
}

function mapRpcError(error: { code?: string; message?: string }): RetentionServiceError {
	if (error.code === 'P0002')
		return new RetentionServiceError(404, 'RETENTION_NOT_FOUND', 'Registro não encontrado.');
	if (error.code === '42501')
		return new RetentionServiceError(403, 'RETENTION_FORBIDDEN', 'Acesso não autorizado.');
	if (error.code === '55000')
		return new RetentionServiceError(
			409,
			'RETENTION_IMMUTABLE',
			'O histórico de retenção é imutável; retifique criando um novo snapshot.',
		);
	if (error.code === '23505')
		return new RetentionServiceError(
			409,
			'RETENTION_DUPLICATE',
			'Já existe um registro com estes dados.',
		);
	if (error.code === '23514') {
		const message = error.message ?? '';
		if (message.includes('retention_hook_variant_invalid'))
			return new RetentionServiceError(
				409,
				'RETENTION_HOOK_INVALID',
				'A variação de hook não pertence a este episódio.',
			);
		if (message.includes('retention_cover_invalid'))
			return new RetentionServiceError(
				409,
				'RETENTION_COVER_INVALID',
				'A capa não pertence a este episódio.',
			);
		if (message.includes('retention_end_card_invalid'))
			return new RetentionServiceError(
				409,
				'RETENTION_END_CARD_INVALID',
				'O final A/B não pertence a este episódio.',
			);
		if (message.includes('retention_snapshot_quota'))
			return new RetentionServiceError(
				409,
				'RETENTION_QUOTA',
				'Limite de 5000 snapshots por publicação atingido.',
			);
		return new RetentionServiceError(400, 'RETENTION_INVALID', 'Dados de retenção inválidos.');
	}
	return new RetentionServiceError(
		503,
		'RETENTION_FAILED',
		'Não foi possível processar o laboratório de retenção.',
	);
}

function numberOrNull(value: number | string | null): number | null {
	if (value === null) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseSnapshot(row: SnapshotRow, durationMs: number): RetentionSnapshot {
	const metrics = {
		views: numberOrNull(row.views),
		likes: numberOrNull(row.likes),
		comments: numberOrNull(row.comments),
		shares: numberOrNull(row.shares),
		saves: numberOrNull(row.saves),
		followersGained: numberOrNull(row.followers_gained),
		avgWatchMs: row.avg_watch_ms,
		completionPct: numberOrNull(row.completion_pct),
	};
	return {
		id: row.id,
		postId: row.post_id,
		revision: Number(row.revision_number),
		supersedesSnapshotId: row.supersedes_snapshot_id,
		capturedAt: row.captured_at,
		periodStart: row.period_start,
		periodEnd: row.period_end,
		source: row.source,
		note: row.note,
		metrics,
		computed: computeRetentionMetrics(metrics, durationMs),
		snapshotHash: row.snapshot_hash,
		createdAt: row.created_at,
	};
}

export async function loadRetentionContext(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
): Promise<RetentionContext | null> {
	const [
		episodeResult,
		postsResult,
		variantsResult,
		snapshotsResult,
		experimentsResult,
		importsResult,
	] = await Promise.all([
		db
			.from('episodes')
			.select('id,title,episode_number,duration_ms,seasons(series(title))')
			.eq('owner_id', owner.id)
			.eq('id', episodeId)
			.maybeSingle(),
		db
			.from('published_posts')
			.select('*')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('published_at', { ascending: false })
			.limit(100),
		db
			.from('creative_variants')
			.select('*')
			.eq('owner_id', owner.id)
			.order('created_at')
			.limit(500),
		db
			.from('analytics_snapshots')
			.select('*')
			.eq('owner_id', owner.id)
			.order('period_end', { ascending: false })
			.limit(500),
		db
			.from('retention_experiments')
			.select('*')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('created_at', { ascending: false })
			.limit(50),
		db
			.from('retention_imports')
			.select('*')
			.eq('owner_id', owner.id)
			.order('created_at', { ascending: false })
			.limit(20),
	]);
	if (episodeResult.error)
		throw new RetentionServiceError(
			503,
			'RETENTION_LOAD_FAILED',
			'Não foi possível carregar o episódio.',
		);
	if (!episodeResult.data) return null;
	if (
		postsResult.error ||
		variantsResult.error ||
		snapshotsResult.error ||
		experimentsResult.error ||
		importsResult.error
	)
		throw new RetentionServiceError(
			503,
			'RETENTION_LOAD_FAILED',
			'Não foi possível carregar a retenção.',
		);
	const season = firstRelation(episodeResult.data.seasons);
	const durationMs = Number(episodeResult.data.duration_ms);
	const posts = (postsResult.data ?? []) as PostRow[];
	const postIds = new Set(posts.map((post) => post.id));
	const variants = ((variantsResult.data ?? []) as VariantRow[]).filter((variant) =>
		postIds.has(variant.post_id),
	);
	const snapshots = ((snapshotsResult.data ?? []) as SnapshotRow[]).filter((snapshot) =>
		postIds.has(snapshot.post_id),
	);
	const latestByPost = new Map<string, RetentionSnapshot>();
	const countByPost = new Map<string, number>();
	for (const row of snapshots) {
		countByPost.set(row.post_id, (countByPost.get(row.post_id) ?? 0) + 1);
		if (!latestByPost.has(row.post_id))
			latestByPost.set(row.post_id, parseSnapshot(row, durationMs));
	}
	return {
		episode: {
			id: episodeResult.data.id as string,
			title: episodeResult.data.title as string,
			number: Number(episodeResult.data.episode_number),
			durationMs,
			seriesTitle:
				((season as { series?: unknown } | null)?.series as { title?: string } | null)?.title ??
				'Série',
		},
		posts: posts.map((post) => ({
			id: post.id,
			episodeId: post.episode_id,
			platform: post.platform as RetentionPlatform,
			url: post.url,
			publishedAt: post.published_at,
			label: post.label,
			notes: post.notes,
			variants: variants
				.filter((variant) => variant.post_id === post.id)
				.map((variant) => ({
					id: variant.id,
					kind: variant.kind as RetentionVariantKind,
					label: variant.label,
					hookVariantId: variant.hook_variant_id,
					coverRevisionId: variant.cover_revision_id,
					endCardId: variant.end_card_id,
				})),
			latestSnapshot: latestByPost.get(post.id) ?? null,
			snapshotCount: countByPost.get(post.id) ?? 0,
		})),
		experiments: ((experimentsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
			id: row.id as string,
			name: row.name as string,
			hypothesis: row.hypothesis as string,
			status: row.status as string,
			variantAId: row.variant_a_id as string,
			variantBId: row.variant_b_id as string,
		})),
		imports: ((importsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
			id: row.id as string,
			filename: row.filename as string,
			rowCount: Number(row.row_count),
			importedCount: Number(row.imported_count),
			skippedCount: Number(row.skipped_count),
			errorCount: Number(row.error_count),
			createdAt: row.created_at as string,
		})),
	};
}

export async function savePublishedPost(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	postId?: string | null;
	values: PublishedPostInput;
}): Promise<string> {
	const parsed = publishedPostInputSchema.safeParse(input.values);
	if (!parsed.success)
		throw new RetentionServiceError(400, 'RETENTION_POST_INVALID', 'Publicação inválida.');
	if (!input.adminDb)
		throw new RetentionServiceError(
			503,
			'RETENTION_WRITE_UNAVAILABLE',
			'O writer de retenção não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('save_published_post', {
		p_owner_id: input.owner.id,
		p_post_id: input.postId ?? null,
		p_episode_id: parsed.data.episodeId,
		p_platform: parsed.data.platform,
		p_url: parsed.data.url,
		p_published_at: parsed.data.publishedAt,
		p_label: parsed.data.label,
		p_notes: parsed.data.notes,
		p_change_note: parsed.data.changeNote,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'string')
		throw new RetentionServiceError(
			503,
			'RETENTION_SAVE_FAILED',
			'O servidor não retornou a publicação.',
		);
	return data;
}

export async function saveCreativeVariant(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	values: CreativeVariantInput;
}): Promise<string> {
	const parsed = creativeVariantInputSchema.safeParse(input.values);
	if (!parsed.success)
		throw new RetentionServiceError(400, 'RETENTION_VARIANT_INVALID', 'Variante inválida.');
	if (!input.adminDb)
		throw new RetentionServiceError(
			503,
			'RETENTION_WRITE_UNAVAILABLE',
			'O writer de retenção não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('save_creative_variant', {
		p_owner_id: input.owner.id,
		p_post_id: parsed.data.postId,
		p_kind: parsed.data.kind,
		p_label: parsed.data.label,
		p_hook_variant_id: parsed.data.hookVariantId,
		p_cover_revision_id: parsed.data.coverRevisionId,
		p_end_card_id: parsed.data.endCardId,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'string')
		throw new RetentionServiceError(
			503,
			'RETENTION_SAVE_FAILED',
			'O servidor não retornou a variante.',
		);
	return data;
}

export function snapshotHash(input: AnalyticsSnapshotInput): string {
	return createHash('sha256')
		.update(
			canonicalJson({
				postId: input.postId,
				periodStart: input.periodStart,
				periodEnd: input.periodEnd,
				source: input.source,
				metrics: input.metrics,
			}),
		)
		.digest('hex');
}

export async function saveAnalyticsSnapshot(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	values: AnalyticsSnapshotInput;
	durationMs: number;
}): Promise<{ revision: number; duplicate: boolean }> {
	const parsed = analyticsSnapshotInputSchema.safeParse(input.values);
	if (!parsed.success)
		throw new RetentionServiceError(400, 'RETENTION_SNAPSHOT_INVALID', 'Snapshot inválido.');
	try {
		computeRetentionMetrics(parsed.data.metrics, input.durationMs);
	} catch (cause) {
		if (cause instanceof RetentionError)
			throw new RetentionServiceError(400, cause.code, cause.message);
		throw cause;
	}
	if (!input.adminDb)
		throw new RetentionServiceError(
			503,
			'RETENTION_WRITE_UNAVAILABLE',
			'O writer de retenção não está configurado.',
		);
	const hash = snapshotHash(parsed.data);
	const { data: existing } = await input.db
		.from('analytics_snapshots')
		.select('revision_number')
		.eq('owner_id', input.owner.id)
		.eq('post_id', parsed.data.postId)
		.eq('snapshot_hash', hash)
		.maybeSingle();
	if (existing) return { revision: Number(existing.revision_number), duplicate: true };
	const metrics = parsed.data.metrics;
	const { data, error } = await input.adminDb.rpc('save_analytics_snapshot', {
		p_owner_id: input.owner.id,
		p_post_id: parsed.data.postId,
		p_captured_at: parsed.data.capturedAt,
		p_period_start: parsed.data.periodStart,
		p_period_end: parsed.data.periodEnd,
		p_source: parsed.data.source,
		p_note: parsed.data.note,
		p_views: metrics.views,
		p_likes: metrics.likes,
		p_comments: metrics.comments,
		p_shares: metrics.shares,
		p_saves: metrics.saves,
		p_followers_gained: metrics.followersGained,
		p_avg_watch_ms: metrics.avgWatchMs,
		p_completion_pct: metrics.completionPct,
		p_snapshot_hash: hash,
		p_supersedes_snapshot_id: parsed.data.supersedesSnapshotId,
		p_import_id: null,
	});
	if (error?.code === '23505') return { revision: 0, duplicate: true };
	if (error) throw mapRpcError(error);
	if (typeof data !== 'number')
		throw new RetentionServiceError(
			503,
			'RETENTION_SAVE_FAILED',
			'O servidor não retornou a revisão.',
		);
	return { revision: data, duplicate: false };
}

export async function importRetentionCsv(input: {
	db: SupabaseClient;
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	filename: string;
	csv: string;
	durationMs: number;
}): Promise<{
	imported: number;
	skipped: number;
	errors: Array<{ line: number; message: string }>;
}> {
	const parsed = parseRetentionCsv(input.csv);
	let imported = 0;
	let skipped = 0;
	for (const row of parsed.rows) {
		try {
			const postId = await savePublishedPost({
				db: input.db,
				adminDb: input.adminDb,
				owner: input.owner,
				values: {
					episodeId: input.episodeId,
					platform: row.platform,
					url: row.url,
					publishedAt: row.published_at,
					label: row.label,
					notes: '',
					changeNote: `CSV ${input.filename}`,
				},
			});
			const result = await saveAnalyticsSnapshot({
				db: input.db,
				adminDb: input.adminDb,
				owner: input.owner,
				durationMs: input.durationMs,
				values: {
					postId,
					capturedAt: row.captured_at,
					periodStart: row.period_start,
					periodEnd: row.period_end,
					source: 'CSV',
					note: row.note,
					supersedesSnapshotId: null,
					metrics: {
						views: row.views,
						likes: row.likes,
						comments: row.comments,
						shares: row.shares,
						saves: row.saves,
						followersGained: row.followers_gained,
						avgWatchMs: row.avg_watch_ms,
						completionPct: row.completion_pct,
					},
				},
			});
			if (result.duplicate) skipped += 1;
			else imported += 1;
		} catch (cause) {
			parsed.errors.push({
				line: 0,
				message: cause instanceof Error ? cause.message : 'Falha ao importar linha.',
			});
		}
	}
	if (input.adminDb) {
		const sha256 = createHash('sha256').update(input.csv).digest('hex');
		await input.adminDb.rpc('save_retention_import', {
			p_owner_id: input.owner.id,
			p_filename: input.filename.slice(0, 120),
			p_sha256: sha256,
			p_row_count: parsed.rows.length + parsed.errors.length,
			p_imported_count: imported,
			p_skipped_count: skipped,
			p_error_count: parsed.errors.length,
		});
	}
	return { imported, skipped, errors: parsed.errors };
}

export async function saveRetentionExperiment(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	values: ExperimentInput;
}): Promise<string> {
	const parsed = experimentInputSchema.safeParse(input.values);
	if (!parsed.success)
		throw new RetentionServiceError(400, 'RETENTION_EXPERIMENT_INVALID', 'Experimento inválido.');
	if (!input.adminDb)
		throw new RetentionServiceError(
			503,
			'RETENTION_WRITE_UNAVAILABLE',
			'O writer de retenção não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('save_retention_experiment', {
		p_owner_id: input.owner.id,
		p_episode_id: parsed.data.episodeId,
		p_name: parsed.data.name,
		p_variant_a_id: parsed.data.variantAId,
		p_variant_b_id: parsed.data.variantBId,
		p_hypothesis: parsed.data.hypothesis,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'string')
		throw new RetentionServiceError(
			503,
			'RETENTION_SAVE_FAILED',
			'O servidor não retornou o experimento.',
		);
	return data;
}

export async function deletePublishedPost(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	postId: string;
}): Promise<void> {
	if (!input.adminDb)
		throw new RetentionServiceError(
			503,
			'RETENTION_WRITE_UNAVAILABLE',
			'O writer de retenção não está configurado.',
		);
	const { error } = await input.adminDb.rpc('delete_published_post', {
		p_owner_id: input.owner.id,
		p_post_id: input.postId,
	});
	if (error) throw mapRpcError(error);
}

export function variantObservation(
	post: RetentionPost,
	variant: RetentionPost['variants'][number],
): VariantObservation | null {
	if (!post.latestSnapshot) return null;
	return {
		platform: post.platform,
		label: post.label || post.url,
		variantLabel: variant.label,
		periodStart: post.latestSnapshot.periodStart,
		periodEnd: post.latestSnapshot.periodEnd,
		views: post.latestSnapshot.metrics.views,
		metrics: post.latestSnapshot.computed,
	};
}

export function comparePostVariants(
	context: RetentionContext,
	experiment: RetentionContext['experiments'][number],
	metric: Parameters<typeof compareVariantObservations>[2],
) {
	const variants = new Map<
		string,
		{ post: RetentionPost; variant: RetentionPost['variants'][number] }
	>();
	for (const post of context.posts)
		for (const variant of post.variants) variants.set(variant.id, { post, variant });
	const left = variants.get(experiment.variantAId);
	const right = variants.get(experiment.variantBId);
	if (!left || !right)
		return {
			status: 'NOT_COMPARABLE' as const,
			metric,
			valueA: null,
			valueB: null,
			summary: 'Variantes do experimento não estão mais disponíveis.',
			warnings: ['VARIANT_MISSING'],
		};
	const leftObservation = variantObservation(left.post, left.variant);
	const rightObservation = variantObservation(right.post, right.variant);
	if (!leftObservation || !rightObservation)
		return {
			status: 'INSUFFICIENT' as const,
			metric,
			valueA: null,
			valueB: null,
			summary: 'Falta snapshot em uma das variantes.',
			warnings: ['SNAPSHOT_MISSING'],
		};
	return compareVariantObservations(leftObservation, rightObservation, metric);
}
