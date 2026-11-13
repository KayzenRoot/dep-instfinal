import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { enqueueRenderJob, listRenderJobs, RenderJobError } from '#lib/server/render-jobs.js';
import { renderJobEnqueueSchema } from '#lib/schemas/render-jobs.js';

function errorResponse(cause: unknown) {
	if (cause instanceof RenderJobError)
		return json({ error: cause.code, message: cause.message }, { status: cause.status });
	return json(
		{ error: 'RENDER_JOB_FAILED', message: 'Não foi possível processar o render.' },
		{ status: 503 },
	);
}

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodeId = event.url.searchParams.get('episodeId');
	if (!episodeId || !/^[0-9a-f-]{36}$/i.test(episodeId))
		return json({ error: 'INVALID_EPISODE', message: 'Episódio inválido.' }, { status: 400 });
	try {
		return json({ jobs: await listRenderJobs({ db, owner, episodeId }) });
	} catch (cause) {
		return errorResponse(cause);
	}
};

export const POST: RequestHandler = async (event) => {
	const { owner } = ownerDatabase(event);
	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'INVALID_JSON', message: 'Corpo JSON inválido.' }, { status: 400 });
	}
	const parsed = renderJobEnqueueSchema.safeParse(body);
	if (!parsed.success)
		return json(
			{
				error: 'INVALID_INPUT',
				message: 'Dados do render inválidos.',
				issues: parsed.error.issues,
			},
			{ status: 400 },
		);
	try {
		const result = await enqueueRenderJob({
			adminDb: createSupabaseAdminClient(),
			owner,
			episodeId: parsed.data.episodeId,
			idempotencyKey: parsed.data.idempotencyKey,
			priority: parsed.data.priority,
		});
		return json(result, { status: 202 });
	} catch (cause) {
		return errorResponse(cause);
	}
};
