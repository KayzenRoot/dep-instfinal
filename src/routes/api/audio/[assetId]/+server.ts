import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { AudioLibraryError, getAudioAssetDownload } from '#lib/server/audio-library.js';
import { videoBackend } from '#lib/server/video-http.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const backend = videoBackend(getAppConfig());
	if ('response' in backend) return backend.response;
	try {
		const download = await getAudioAssetDownload({
			db,
			owner,
			storage: backend.storage,
			assetId: event.params.assetId,
		});
		return redirect(302, download.url);
	} catch (cause) {
		if (cause instanceof AudioLibraryError)
			return new Response(JSON.stringify({ error: cause.code, message: cause.message }), {
				status: cause.status,
				headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
			});
		throw cause;
	}
};
