import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { cancelRenderJob, RenderJobError, getRenderJob } from '#lib/server/render-jobs.js';

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
	try {
		const job = await getRenderJob({ db, owner, jobId: event.params.jobId });
		return json({ job });
	} catch (cause) {
		return errorResponse(cause);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { owner } = ownerDatabase(event);
	try {
		await cancelRenderJob({
			adminDb: createSupabaseAdminClient(),
			owner,
			jobId: event.params.jobId,
		});
		return json({ canceled: true });
	} catch (cause) {
		return errorResponse(cause);
	}
};
