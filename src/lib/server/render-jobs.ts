import { randomUUID } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export class RenderJobError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'RenderJobError';
	}
}

export interface RenderJob {
	id: string;
	owner_id: string;
	episode_id: string;
	plan_id: string;
	plan_version: number;
	narration_take_id: string | null;
	status: 'QUEUED' | 'CLAIMED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELED';
	priority: number;
	attempts: number;
	max_attempts: number;
	error_code: string | null;
	output_manifest: Record<string, unknown> | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

function mapRpcError(error: { code?: string; message?: string }): RenderJobError {
	const message = error.message ?? '';
	if (message.includes('render_queue_full') || message.includes('render_episode_queue_full')) {
		return new RenderJobError(
			429,
			'RENDER_QUEUE_FULL',
			'A fila de renderização está cheia. Tente novamente mais tarde.',
		);
	}
	if (message.includes('edit_plan_not_approved')) {
		return new RenderJobError(
			409,
			'RENDER_PLAN_NOT_APPROVED',
			'Aprove o plano de edição antes de renderizar.',
		);
	}
	if (message.includes('edit_plan_not_found')) {
		return new RenderJobError(404, 'RENDER_PLAN_NOT_FOUND', 'Plano de edição não encontrado.');
	}
	if (
		message.includes('narration_take_not_ready') ||
		message.includes('narration_take_not_found') ||
		message.includes('narration_take_episode_mismatch')
	) {
		return new RenderJobError(
			409,
			'NARRATION_TAKE_NOT_READY',
			'A voz aprovada não está pronta para renderizar.',
		);
	}
	if (error.code === '23514') {
		return new RenderJobError(400, 'RENDER_JOB_INVALID', 'Job de renderização inválido.');
	}
	return new RenderJobError(503, 'RENDER_JOB_FAILED', 'Não foi possível processar o render.');
}

export async function enqueueRenderJob(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	episodeId: string;
	idempotencyKey?: string;
	priority?: number;
	narrationTakeId?: string;
}): Promise<{ jobId: string }> {
	if (!input.adminDb)
		throw new RenderJobError(
			503,
			'RENDER_WRITER_UNAVAILABLE',
			'O worker de render não está configurado.',
		);
	let narrationTakeId = input.narrationTakeId ?? null;
	if (!narrationTakeId) {
		const { data: voicePlan, error: voiceError } = await input.adminDb
			.from('voice_direction_plans')
			.select('plan,current_status')
			.eq('owner_id', input.owner.id)
			.eq('episode_id', input.episodeId)
			.maybeSingle();
		if (voiceError)
			throw new RenderJobError(503, 'RENDER_JOB_FAILED', 'Não foi possível ler a direção de voz.');
		if (voicePlan?.current_status === 'APPROVED') {
			const takeId = (voicePlan.plan as { takeId?: unknown } | null)?.takeId;
			if (typeof takeId === 'string') narrationTakeId = takeId;
		}
	}
	const idempotencyKey = input.idempotencyKey ?? `web:${randomUUID()}`;
	const { data, error } = await input.adminDb.rpc('enqueue_render_job', {
		p_owner_id: input.owner.id,
		p_episode_id: input.episodeId,
		p_idempotency_key: idempotencyKey,
		p_priority: input.priority ?? 50,
		p_narration_take_id: narrationTakeId,
	});
	if (error) throw mapRpcError(error);
	if (typeof data !== 'string')
		throw new RenderJobError(503, 'RENDER_JOB_FAILED', 'O servidor não retornou o job.');
	return { jobId: data };
}

export async function listRenderJobs(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
}): Promise<RenderJob[]> {
	const { data, error } = await input.db
		.from('render_jobs')
		.select(
			'id,owner_id,episode_id,plan_id,plan_version,narration_take_id,status,priority,attempts,max_attempts,error_code,output_manifest,created_at,started_at,finished_at',
		)
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.order('created_at', { ascending: false })
		.limit(20);
	if (error)
		throw new RenderJobError(503, 'RENDER_LIST_FAILED', 'Não foi possível listar os renders.');
	return (data ?? []) as RenderJob[];
}

export async function getRenderJob(input: {
	db: SupabaseClient;
	owner: User;
	jobId: string;
}): Promise<RenderJob> {
	const { data, error } = await input.db
		.from('render_jobs')
		.select(
			'id,owner_id,episode_id,plan_id,plan_version,narration_take_id,status,priority,attempts,max_attempts,error_code,output_manifest,created_at,started_at,finished_at',
		)
		.eq('owner_id', input.owner.id)
		.eq('id', input.jobId)
		.maybeSingle();
	if (error || !data)
		throw new RenderJobError(404, 'RENDER_JOB_NOT_FOUND', 'Job de renderização não encontrado.');
	return data as RenderJob;
}

export async function cancelRenderJob(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	jobId: string;
}): Promise<void> {
	if (!input.adminDb)
		throw new RenderJobError(
			503,
			'RENDER_WRITER_UNAVAILABLE',
			'O worker de render não está configurado.',
		);
	const { data, error } = await input.adminDb.rpc('cancel_render_job', {
		p_owner_id: input.owner.id,
		p_job_id: input.jobId,
	});
	if (error) throw mapRpcError(error);
	if (data !== true)
		throw new RenderJobError(
			409,
			'RENDER_JOB_NOT_CANCELABLE',
			'Este job não pode mais ser cancelado.',
		);
}
