import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadRetentionContext } from '#lib/server/retention.js';
import { RETENTION_METRIC_DEFINITIONS, retentionCsv } from '#lib/domain/retention.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodeId = event.url.searchParams.get('episodeId') ?? '';
	if (!/^[0-9a-f-]{36}$/i.test(episodeId)) error(400, 'Episódio inválido.');
	const format = event.url.searchParams.get('format') === 'json' ? 'json' : 'csv';
	const context = await loadRetentionContext(db, owner, episodeId);
	if (!context) error(404, 'Episódio não encontrado.');
	const rows = context.posts.flatMap((post) => {
		const variantLabels = post.variants
			.map((variant) => `${variant.kind}:${variant.label}`)
			.join('|');
		if (!post.latestSnapshot)
			return [
				{
					episode: context.episode.title,
					platform: post.platform,
					url: post.url,
					label: post.label,
					published_at: post.publishedAt,
					variants: variantLabels,
					period_start: '',
					period_end: '',
					captured_at: '',
					source: '',
					views: null,
					likes: null,
					comments: null,
					shares: null,
					saves: null,
					followers_gained: null,
					avg_watch_ms: null,
					completion_pct: null,
					engagement_rate: null,
					watch_time_relative: null,
					interactions_per_1000: null,
					missing: 'snapshot',
					warnings: 'NO_SNAPSHOT',
					note: post.notes,
				},
			];
		const snapshot = post.latestSnapshot;
		return [
			{
				episode: context.episode.title,
				platform: post.platform,
				url: post.url,
				label: post.label,
				published_at: post.publishedAt,
				variants: variantLabels,
				period_start: snapshot.periodStart,
				period_end: snapshot.periodEnd,
				captured_at: snapshot.capturedAt,
				source: snapshot.source,
				views: snapshot.metrics.views,
				likes: snapshot.metrics.likes,
				comments: snapshot.metrics.comments,
				shares: snapshot.metrics.shares,
				saves: snapshot.metrics.saves,
				followers_gained: snapshot.metrics.followersGained,
				avg_watch_ms: snapshot.metrics.avgWatchMs,
				completion_pct: snapshot.metrics.completionPct,
				engagement_rate: snapshot.computed.engagementRate,
				watch_time_relative: snapshot.computed.watchTimeRelative,
				interactions_per_1000: snapshot.computed.interactionsPer1000,
				missing: snapshot.computed.missing.join('|'),
				warnings: snapshot.computed.warnings.join('|'),
				note: snapshot.note,
			},
		];
	});
	const filename = `retention-${context.episode.number}-${episodeId.slice(0, 8)}.${format}`;
	if (format === 'json')
		return new Response(
			JSON.stringify(
				{
					format: 'dif-studio-retention/v1',
					episode: context.episode,
					metricVersion: 1,
					definitions: RETENTION_METRIC_DEFINITIONS,
					caveat:
						'Métricas agregadas fornecidas manualmente; associações descritivas, não causalidade.',
					posts: context.posts,
					experiments: context.experiments,
					imports: context.imports,
				},
				null,
				2,
			),
			{
				headers: {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'private, no-store',
					'content-disposition': `attachment; filename="${filename}"`,
					'x-content-type-options': 'nosniff',
				},
			},
		);
	return new Response(retentionCsv(rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'cache-control': 'private, no-store',
			'content-disposition': `attachment; filename="${filename}"`,
			'x-content-type-options': 'nosniff',
		},
	});
};
