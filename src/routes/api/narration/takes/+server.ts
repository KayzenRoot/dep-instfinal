import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { listNarrationTakes, NarrationError } from '#lib/server/narration.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodeId = event.url.searchParams.get('episodeId');
	if (!episodeId || !/^[0-9a-f-]{36}$/i.test(episodeId))
		return json({ error: 'INVALID_EPISODE', message: 'Episódio inválido.' }, { status: 400 });
	try {
		return json({ takes: await listNarrationTakes(db, owner, episodeId) });
	} catch (cause) {
		if (cause instanceof NarrationError)
			return json({ error: cause.code, message: cause.message }, { status: cause.status });
		return json(
			{ error: 'NARRATION_LIST_FAILED', message: 'Não foi possível listar.' },
			{ status: 503 },
		);
	}
};
