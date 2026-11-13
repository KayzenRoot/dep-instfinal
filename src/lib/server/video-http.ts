import { json } from '@sveltejs/kit';
import type { AppConfig } from './config.js';
import type { VideoStorage } from './video-storage.js';
import { getVideoStorage } from './video-storage.js';
import { VideoAssetError } from './video-assets.js';

export function videoBackend(
	config: AppConfig,
): { storage: VideoStorage } | { response: Response } {
	const storage = getVideoStorage(config);
	if (!storage)
		return {
			response: json(
				{
					error: 'VIDEO_STORAGE_UNAVAILABLE',
					message: 'O storage privado de vídeo não está configurado.',
				},
				{ status: 503 },
			),
		};
	return { storage };
}

export function videoErrorResponse(cause: unknown): Response {
	if (cause instanceof VideoAssetError)
		return json({ error: cause.code, message: cause.message }, { status: cause.status });
	return json(
		{ error: 'VIDEO_INTERNAL_ERROR', message: 'Não foi possível processar o clipe.' },
		{ status: 500 },
	);
}
