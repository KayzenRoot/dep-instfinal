import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { getVideoAssetForDownload } from '#lib/server/video-assets.js';
import { videoBackend, videoErrorResponse } from '#lib/server/video-http.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const backend = videoBackend(config);
	if ('response' in backend) return backend.response;
	if (!/^[0-9a-f-]{36}$/i.test(event.params.assetId)) error(404, 'Clipe não encontrado.');
	const poster = event.url.searchParams.get('poster') === '1';
	try {
		const result = await getVideoAssetForDownload({
			db,
			owner,
			storage: backend.storage,
			assetId: event.params.assetId,
			poster,
		});
		return new Response(null, {
			status: 302,
			headers: {
				location: result.url,
				'cache-control': 'private, no-store',
				'referrer-policy': 'no-referrer',
				'x-content-type-options': 'nosniff',
				'content-type': result.contentType,
			},
		});
	} catch (cause) {
		const response = videoErrorResponse(cause);
		if (response.status === 404) error(404, 'Clipe não encontrado.');
		return response;
	}
};
