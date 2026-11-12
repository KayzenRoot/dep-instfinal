import { z } from 'zod';

const safeFileName = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.refine((value) => !/[\\/]/.test(value) && !value.includes('..') && !value.includes('\0'), {
		message: 'Nome de arquivo inválido.',
	});

export const videoUploadInitSchema = z.object({
	episodeId: z.string().uuid(),
	sceneId: z.string().uuid(),
	fileName: safeFileName,
	byteSize: z.coerce.number().int().min(1).max(209_715_200),
	contentType: z.string().trim().max(100).default('video/mp4'),
	fileSha256: z
		.string()
		.trim()
		.regex(/^[0-9a-f]{64}$/, 'Hash SHA-256 inválido.'),
	idempotencyKey: z
		.string()
		.trim()
		.min(8)
		.max(128)
		.regex(/^[A-Za-z0-9._:-]+$/, 'Chave de idempotência inválida.'),
});

export const videoUploadCompleteSchema = z.object({
	parts: z
		.array(
			z.object({
				partNumber: z.coerce.number().int().min(1).max(10_000),
				etag: z.string().trim().min(1).max(200),
			}),
		)
		.min(0)
		.max(100),
});

export const videoAssetIdSchema = z.string().uuid();
