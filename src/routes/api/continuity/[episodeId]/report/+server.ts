import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadLatestVisualContinuityReport } from '#lib/server/visual-continuity.js';
import { buildContinuityReportMarkdown } from '#lib/domain/visual-continuity.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const format = event.url.searchParams.get('format') ?? 'json';
	if (format !== 'json' && format !== 'md') error(400, 'Formato inválido.');
	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select('id,episode_number,title')
		.eq('owner_id', owner.id)
		.eq('id', event.params.episodeId)
		.maybeSingle();
	if (episodeError || !episode) error(404, 'Episódio não encontrado.');
	const latest = await loadLatestVisualContinuityReport(db, owner, episode.id);
	if (!latest) error(404, 'Nenhum relatório de continuidade foi gerado.');
	const base = `continuity-ep${episode.episode_number}-r${latest.revision}`;
	if (format === 'md') {
		return new Response(buildContinuityReportMarkdown(latest.report, episode.title), {
			headers: {
				'content-type': 'text/markdown; charset=utf-8',
				'cache-control': 'private, no-store',
				'content-disposition': `attachment; filename="${base}.md"`,
				'x-content-type-options': 'nosniff',
			},
		});
	}
	return new Response(
		`${JSON.stringify(
			{
				format: 'dif-studio-visual-continuity/v1',
				episode: {
					id: episode.id,
					number: episode.episode_number,
					title: episode.title,
				},
				revision: latest.revision,
				status: latest.status,
				blockingCount: latest.blockingCount,
				reportHash: latest.reportHash,
				createdAt: latest.createdAt,
				report: latest.report,
			},
			null,
			2,
		)}\n`,
		{
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'private, no-store',
				'content-disposition': `attachment; filename="${base}.json"`,
				'x-content-type-options': 'nosniff',
			},
		},
	);
};
