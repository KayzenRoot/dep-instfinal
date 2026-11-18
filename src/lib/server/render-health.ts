import type { SupabaseClient } from '@supabase/supabase-js';

export interface RenderQueueHealth {
	queued: number;
	claimed: number;
	running: number;
	ready: number;
	failed: number;
	oldestQueuedSeconds: number;
	activeWorker: string | null;
	lastHeartbeatAt: string | null;
}

function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadRenderQueueHealth(
	adminDb: SupabaseClient | null,
): Promise<RenderQueueHealth | null> {
	if (!adminDb) return null;
	const { data, error } = await adminDb.rpc('render_queue_health');
	if (error || !data || typeof data !== 'object') return null;
	const value = data as Record<string, unknown>;
	return {
		queued: toNumber(value.queued),
		claimed: toNumber(value.claimed),
		running: toNumber(value.running),
		ready: toNumber(value.ready),
		failed: toNumber(value.failed),
		oldestQueuedSeconds: toNumber(value.oldestQueuedSeconds),
		activeWorker: typeof value.activeWorker === 'string' ? value.activeWorker : null,
		lastHeartbeatAt: typeof value.lastHeartbeatAt === 'string' ? value.lastHeartbeatAt : null,
	};
}
