import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getCaptionExports, CaptionServiceError } from '#lib/server/captions.js';

const episodePattern = /^[0-9a-f-]{36}$/i;

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	if (!episodePattern.test(event.params.episodeId))
		return new Response('Episódio inválido.', { status: 400 });
	const rawVersion = event.url.searchParams.get('planVersion');
	const planVersion = rawVersion ? Number.parseInt(rawVersion, 10) : null;
	if (rawVersion && (!Number.isInteger(planVersion) || planVersion! < 1))
		return new Response('Versão inválida.', { status: 400 });
	try {
		const exportData = await getCaptionExports({
			db,
			owner,
			episodeId: event.params.episodeId,
			planVersion,
		});
		if (!exportData) return new Response('Legendas não encontradas.', { status: 404 });
		return new Response(exportData.ass, {
			headers: {
				'content-type': 'text/x-ssa; charset=utf-8',
				'content-disposition': `attachment; filename="captions-${event.params.episodeId}.ass"`,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff',
			},
		});
	} catch (cause) {
		const error = cause instanceof CaptionServiceError ? cause : null;
		return new Response(error?.message ?? 'Não foi possível exportar as legendas.', {
			status: error?.status ?? 503,
			headers: { 'cache-control': 'private, no-store' },
		});
	}
};
