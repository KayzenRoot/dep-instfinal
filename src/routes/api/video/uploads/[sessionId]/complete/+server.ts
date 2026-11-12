import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { completeUploadSession } from '#lib/server/video-assets.js';
import { getVideoProbe } from '#lib/server/video-probe.js';
import { videoBackend, videoErrorResponse } from '#lib/server/video-http.js';
import { videoUploadCompleteSchema } from '#lib/schemas/video.js';

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
	const parsed = videoUploadCompleteSchema.safeParse(body);
	if (!parsed.success)
		return json(
			{
				error: 'INVALID_INPUT',
				message: 'Partes do upload inválidas.',
				issues: parsed.error.issues,
			},
			{ status: 400 },
		);
	try {
		const result = await completeUploadSession({
			db,
			owner,
			config,
			storage: backend.storage,
			probe: getVideoProbe(config),
			sessionId: event.params.sessionId,
			parts: parsed.data.parts,
		});
		return json(result);
	} catch (cause) {
		return videoErrorResponse(cause);
	}
};
