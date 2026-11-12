import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { createUploadSession, listUploadSessions } from '#lib/server/video-assets.js';
import { videoBackend, videoErrorResponse } from '#lib/server/video-http.js';
import { videoUploadInitSchema } from '#lib/schemas/video.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const backend = videoBackend(config);
	if ('response' in backend) return backend.response;
	const episodeId = event.url.searchParams.get('episodeId');
	if (!episodeId || !/^[0-9a-f-]{36}$/i.test(episodeId))
		return json({ error: 'INVALID_EPISODE', message: 'Episódio inválido.' }, { status: 400 });
	try {
		return json({ sessions: await listUploadSessions({ db, owner, episodeId }) });
	} catch (cause) {
		return videoErrorResponse(cause);
	}
};

export const POST: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const backend = videoBackend(config);
	if ('response' in backend) return backend.response;
	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'INVALID_JSON', message: 'Corpo JSON inválido.' }, { status: 400 });
	}
	const parsed = videoUploadInitSchema.safeParse(body);
	if (!parsed.success)
		return json(
			{
				error: 'INVALID_INPUT',
				message: 'Dados do upload inválidos.',
				issues: parsed.error.issues,
			},
			{ status: 400 },
		);
	try {
		const result = await createUploadSession({
			db,
			owner,
			config,
			storage: backend.storage,
			episodeId: parsed.data.episodeId,
			sceneId: parsed.data.sceneId,
			fileName: parsed.data.fileName,
			byteSize: parsed.data.byteSize,
			contentType: parsed.data.contentType,
			idempotencyKey: parsed.data.idempotencyKey,
		});
		return json(result, { status: result.resumed ? 200 : 201 });
	} catch (cause) {
		return videoErrorResponse(cause);
	}
};
