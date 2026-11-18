import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getCaptionExports, CaptionServiceError } from './captions.js';

const episodePattern = /^[0-9a-f-]{36}$/i;

export async function captionExportResponse(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
	planVersion: number | null;
	narrationTakeId?: string | null;
	pinTake?: boolean;
	format: 'srt' | 'ass';
}): Promise<Response> {
	if (!episodePattern.test(input.episodeId))
		return new Response('Episódio inválido.', { status: 400 });
	const exportData = await getCaptionExports({
		db: input.db,
		owner: input.owner,
		episodeId: input.episodeId,
		planVersion: input.planVersion,
		narrationTakeId: input.narrationTakeId ?? null,
		pinTake: input.pinTake ?? false,
	});
	if (!exportData) return new Response('Legendas não encontradas.', { status: 404 });
	const isSrt = input.format === 'srt';
	return new Response(isSrt ? exportData.srt : exportData.ass, {
		headers: {
			'content-type': isSrt ? 'application/x-subrip; charset=utf-8' : 'text/x-ssa; charset=utf-8',
			'content-disposition': `attachment; filename="captions-${input.episodeId}.${input.format}"`,
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff',
		},
	});
}

export function captionExportError(cause: unknown): Response {
	const error = cause instanceof CaptionServiceError ? cause : null;
	return new Response(error?.message ?? 'Não foi possível exportar as legendas.', {
		status: error?.status ?? 503,
		headers: { 'cache-control': 'private, no-store' },
	});
}
