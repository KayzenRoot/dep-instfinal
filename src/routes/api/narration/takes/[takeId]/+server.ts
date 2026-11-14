import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { getNarrationTakeDownload, NarrationError } from '#lib/server/narration.js';
import { videoBackend } from '#lib/server/video-http.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const backend = videoBackend(getAppConfig());
	if ('response' in backend) return backend.response;
	try {
		const download = await getNarrationTakeDownload({
			db,
			owner,
			storage: backend.storage,
			takeId: event.params.takeId,
		});
		return redirect(302, download.url);
	} catch (cause) {
		if (cause instanceof NarrationError)
			return new Response(JSON.stringify({ error: cause.code, message: cause.message }), {
				status: cause.status,
				headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
			});
		throw cause;
	}
};
