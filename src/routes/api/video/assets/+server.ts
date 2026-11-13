import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { listVideoAssets } from '#lib/server/video-assets.js';
import { videoErrorResponse } from '#lib/server/video-http.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodeId = event.url.searchParams.get('episodeId');
	if (!episodeId || !/^[0-9a-f-]{36}$/i.test(episodeId))
		return json({ error: 'INVALID_EPISODE', message: 'Episódio inválido.' }, { status: 400 });
	try {
		return json({ assets: await listVideoAssets({ db, owner, episodeId }) });
	} catch (cause) {
		return videoErrorResponse(cause);
	}
};
