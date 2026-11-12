import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { getUploadSession } from '#lib/server/video-assets.js';
import { videoBackend, videoErrorResponse } from '#lib/server/video-http.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const backend = videoBackend(config);
	if ('response' in backend) return backend.response;
	try {
		const result = await getUploadSession({
			db,
			owner,
			storage: backend.storage,
			sessionId: event.params.sessionId,
		});
		return json(result);
	} catch (cause) {
		return videoErrorResponse(cause);
	}
};
