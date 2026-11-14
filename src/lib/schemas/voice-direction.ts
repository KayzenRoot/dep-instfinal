import { z } from 'zod';

export const emotionSchema = z.enum([
	'neutral',
	'tension',
	'whisper',
	'urgency',
	'fear',
	'revelation',
]);

export const voiceSegmentSchema = z.object({
	id: z.string().uuid(),
	sceneId: z.string().uuid().nullable(),
	text: z.string().trim().min(1).max(1000),
	emotion: emotionSchema.default('neutral'),
	speed: z.number().min(0.75).max(1.25).default(1),
	pauseBeforeMs: z.number().int().min(0).max(5000).default(0),
	pauseAfterMs: z.number().int().min(0).max(5000).default(250),
	volumeDb: z.number().min(-12).max(6).default(0),
	intendedWpm: z.number().int().min(80).max(220).default(145),
	pronunciation: z.string().trim().max(200).default(''),
	variant: z.string().trim().max(60).default('default'),
});

export const voiceDirectionPlanSchema = z.object({
	schemaVersion: z.literal(1),
	episodeId: z.string().uuid(),
	episodeRevisionNumber: z.number().int().min(1).nullable().default(null),
	takeId: z.string().uuid().nullable().default(null),
	generatedBy: z.enum(['heuristic', 'manual', 'tts']).default('heuristic'),
	modelId: z.string().trim().max(120).nullable().default(null),
	seriesPreset: z
		.enum(['none', 'sussurro', 'documento_policial', 'narrador_tenso', 'alarme'])
		.default('none'),
	narrationTextSha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.nullable()
		.default(null),
	segments: z.array(voiceSegmentSchema).min(1).max(60),
});

export type VoiceDirectionPlan = z.infer<typeof voiceDirectionPlanSchema>;
export type VoiceSegment = z.infer<typeof voiceSegmentSchema>;

export const voicePlanSaveSchema = z.object({
	episodeId: z.string().uuid(),
	expectedVersion: z.coerce.number().int().min(0).max(10000),
	plan: voiceDirectionPlanSchema,
	changeNote: z.string().trim().max(500).default(''),
});
