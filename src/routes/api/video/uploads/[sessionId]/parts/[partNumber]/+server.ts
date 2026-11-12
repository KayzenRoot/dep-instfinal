import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { recordUploadPart } from '#lib/server/video-assets.js';
import { videoErrorResponse } from '#lib/server/video-http.js';

export const PUT: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const partNumber = Number.parseInt(event.params.partNumber, 10);
	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'INVALID_JSON', message: 'Corpo JSON inválido.' }, { status: 400 });
	}
	const etag =
		typeof body === 'object' && body !== null && 'etag' in body
			? String((body as { etag?: unknown }).etag ?? '')
			: '';
	if (!etag)
		return json(
			{ error: 'INVALID_PART', message: 'ETag da parte é obrigatório.' },
			{ status: 400 },
		);
	try {
		const uploadedParts = await recordUploadPart({
			db,
			owner,
			sessionId: event.params.sessionId,
			partNumber,
			etag,
		});
		return json({ uploadedParts });
	} catch (cause) {
		return videoErrorResponse(cause);
	}
};
