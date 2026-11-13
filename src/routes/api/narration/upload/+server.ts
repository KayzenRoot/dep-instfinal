import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { getAppConfig } from '#lib/server/config.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadVoicePlan, NarrationError, storeNarrationTake } from '#lib/server/narration.js';
import { videoBackend, videoErrorResponse } from '#lib/server/video-http.js';

export const POST: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const config = getAppConfig();
	const backend = videoBackend(config);
	if ('response' in backend) return backend.response;
	let form: FormData;
	try {
		form = await event.request.formData();
	} catch {
		return json({ error: 'INVALID_FORM', message: 'Formulário inválido.' }, { status: 400 });
	}
	const file = form.get('file');
	const episodeId = String(form.get('episodeId') ?? '');
	if (!(file instanceof File) || !episodeId)
		return json(
			{ error: 'INVALID_INPUT', message: 'Arquivo e episódio são obrigatórios.' },
			{ status: 400 },
		);
	const stored = await loadVoicePlan(db, owner, episodeId);
	try {
		const take = await storeNarrationTake({
			adminDb: createSupabaseAdminClient(),
			owner,
			storage: backend.storage,
			episodeId,
			planVersion: stored?.currentVersion ?? 0,
			bytes: Buffer.from(await file.arrayBuffer()),
			fileName: file.name,
			source: 'UPLOAD',
		});
		return json({ take }, { status: 201 });
	} catch (cause) {
		if (cause instanceof NarrationError)
			return json({ error: cause.code, message: cause.message }, { status: cause.status });
		return videoErrorResponse(cause);
	}
};
