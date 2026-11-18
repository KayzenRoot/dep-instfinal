import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadRenderQueueHealth } from '#lib/server/render-health.js';

export const GET: RequestHandler = async (event) => {
	ownerDatabase(event);
	const health = await loadRenderQueueHealth(createSupabaseAdminClient());
	if (!health)
		return json(
			{ error: 'RENDER_HEALTH_UNAVAILABLE', message: 'Saúde da fila indisponível.' },
			{ status: 503, headers: { 'cache-control': 'private, no-store' } },
		);
	return json(
		{
			health,
			concurrency: 1,
			leaseModel: 'single-worker lease',
			diskReserveMb: Number(process.env.WORKER_DISK_RESERVE_MB ?? 2_048),
			ffmpegThreads: Number(process.env.WORKER_FFMPEG_THREADS ?? 2),
		},
		{ headers: { 'cache-control': 'private, no-store' } },
	);
};
