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
});

export const renderJobIdSchema = z.string().uuid();
