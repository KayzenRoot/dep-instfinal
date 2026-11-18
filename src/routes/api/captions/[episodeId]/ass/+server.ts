import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { captionExportError, captionExportResponse } from '#lib/server/caption-export.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const rawVersion = event.url.searchParams.get('planVersion');
	const planVersion = rawVersion ? Number.parseInt(rawVersion, 10) : null;
	if (rawVersion && (!Number.isInteger(planVersion) || planVersion! < 1))
		return new Response('Versão inválida.', { status: 400 });
	const rawTake = event.url.searchParams.get('takeId');
	if (rawTake && !/^[0-9a-f-]{36}$/i.test(rawTake))
		return new Response('Take inválido.', { status: 400 });
	try {
		return await captionExportResponse({
			db,
			owner,
			episodeId: event.params.episodeId,
			planVersion,
			narrationTakeId: rawTake,
			format: 'ass',
		});
	} catch (cause) {
		return captionExportError(cause);
	}
};
