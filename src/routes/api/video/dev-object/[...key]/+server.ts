import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { InMemoryVideoStorage, getVideoStorage } from '#lib/server/video-storage.js';

export const GET: RequestHandler = async (event) => {
	const { owner } = ownerDatabase(event);
	const config = getAppConfig();
	if (!import.meta.env.DEV || config.videoStorageDriver !== 'memory')
		error(404, 'Objeto não encontrado.');
	const storage = getVideoStorage(config);
	if (!(storage instanceof InMemoryVideoStorage)) error(404, 'Objeto não encontrado.');
	const key = decodeURIComponent(event.params.key ?? '');
	if (!key.startsWith(`owners/${owner.id}/`) && !key.startsWith(`quarantine/${owner.id}/`))
		error(404, 'Objeto não encontrado.');
	const bytes = storage.getObjectForTest(key);
	if (!bytes) error(404, 'Objeto não encontrado.');
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': key.endsWith('.poster.jpg') ? 'image/jpeg' : 'video/mp4',
			'content-length': String(bytes.length),
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff',
		},
	});
};
