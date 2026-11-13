import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { InMemoryVideoStorage } from '#lib/server/video-storage.js';
import { getVideoStorage } from '#lib/server/video-storage.js';

export const PUT: RequestHandler = async (event) => {
	ownerDatabase(event);
	const config = getAppConfig();
	if (!import.meta.env.DEV || config.videoStorageDriver !== 'memory')
		return json({ error: 'DEV_UPLOAD_DISABLED' }, { status: 404 });
	const storage = getVideoStorage(config);
	if (!(storage instanceof InMemoryVideoStorage))
		return json({ error: 'DEV_UPLOAD_DISABLED' }, { status: 404 });
	const partNumber = Number.parseInt(event.params.partNumber, 10);
	if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000)
		return json({ error: 'INVALID_PART' }, { status: 400 });
	const bytes = Buffer.from(await event.request.arrayBuffer());
	if (bytes.length === 0 || bytes.length > config.videoPartBytes)
		return json({ error: 'INVALID_PART_SIZE' }, { status: 413 });
	try {
		const etag = storage.putPartForTest(event.params.uploadId, partNumber, bytes);
		return new Response(null, {
			status: 200,
			headers: {
				etag,
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff',
			},
		});
	} catch {
		return json({ error: 'UPLOAD_SESSION_NOT_FOUND' }, { status: 404 });
	}
};
