import { z } from 'zod';

export const renderJobEnqueueSchema = z.object({
	episodeId: z.string().uuid(),
	idempotencyKey: z
		.string()
		.trim()
		.min(8)
		.max(128)
		.regex(/^[A-Za-z0-9._:-]+$/)
		.optional(),
	priority: z.coerce.number().int().min(0).max(100).default(50),
	outputProfile: z.enum(['1080p', '720p']).default('1080p'),
	quality: z.enum(['standard', 'high']).default('standard'),
});

export const renderJobIdSchema = z.string().uuid();
