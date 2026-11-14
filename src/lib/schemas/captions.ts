import { z } from 'zod';

const uuid = z.string().uuid();
const millisecond = z.number().int().min(0).max(150_000);

export const captionWordSchema = z.object({
	text: z.string().trim().min(1).max(80),
	startMs: millisecond,
	endMs: millisecond,
	confidence: z.number().min(0).max(1).nullable().default(null),
});

export const captionCueSchema = z
	.object({
		id: uuid,
		startMs: millisecond,
		endMs: millisecond,
		text: z.string().trim().min(1).max(240),
		words: z.array(captionWordSchema).max(60).default([]),
	})
	.superRefine((cue, context) => {
		if (cue.endMs <= cue.startMs)
			context.addIssue({
				code: 'custom',
				path: ['endMs'],
				message: 'Cue termina antes de começar.',
			});
		if (cue.endMs - cue.startMs < 300)
			context.addIssue({ code: 'custom', path: ['endMs'], message: 'Cue curta demais.' });
		if (cue.endMs - cue.startMs > 8_000)
			context.addIssue({ code: 'custom', path: ['endMs'], message: 'Cue longa demais.' });
		let previousWordEnd = -1;
		for (const [index, word] of cue.words.entries()) {
			if (word.endMs <= word.startMs)
				context.addIssue({
					code: 'custom',
					path: ['words', index, 'endMs'],
					message: 'Palavra termina antes de começar.',
				});
			if (word.startMs < cue.startMs || word.endMs > cue.endMs)
				context.addIssue({
					code: 'custom',
					path: ['words', index],
					message: 'Palavra fora dos limites do cue.',
				});
			if (word.startMs < previousWordEnd)
				context.addIssue({
					code: 'custom',
					path: ['words', index, 'startMs'],
					message: 'Palavras fora de ordem.',
				});
			previousWordEnd = word.endMs;
		}
	});

export const captionStyleSchema = z.enum(['clean', 'vhs', 'highlight']);
export const captionSafeZoneSchema = z.enum(['tiktok', 'reels', 'stories', 'feed']);
export const captionSourceSchema = z.enum(['FORCED_ALIGNMENT', 'ASR_FALLBACK', 'MANUAL']);

export const captionTrackSchema = z
	.object({
		schemaVersion: z.literal(1),
		episodeId: uuid,
		planId: uuid,
		planVersion: z.number().int().min(1).max(10_000),
		narrationTakeId: uuid.nullable().default(null),
		style: captionStyleSchema.default('clean'),
		safeZone: captionSafeZoneSchema.default('tiktok'),
		source: captionSourceSchema.default('MANUAL'),
		scriptSha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.nullable()
			.default(null),
		audioSha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.nullable()
			.default(null),
		alignmentScore: z.number().min(0).max(1).nullable().default(null),
		cues: z.array(captionCueSchema).max(300),
	})
	.superRefine((track, context) => {
		let previousEnd = -1;
		for (const [index, cue] of track.cues.entries()) {
			if (cue.startMs < previousEnd)
				context.addIssue({
					code: 'custom',
					path: ['cues', index, 'startMs'],
					message: 'Cues sobrepostos.',
				});
			previousEnd = cue.endMs;
			if (cue.text.split('\n').length > 2)
				context.addIssue({
					code: 'custom',
					path: ['cues', index, 'text'],
					message: 'Máximo de duas linhas por cue.',
				});
			if (cue.text.split('\n').some((line) => line.length > 42))
				context.addIssue({
					code: 'custom',
					path: ['cues', index, 'text'],
					message: 'Linha de legenda excede 42 caracteres.',
				});
		}
	});

export const captionAsrImportSchema = z.object({
	words: z
		.array(
			z.object({
				word: z.string().trim().min(1).max(80),
				startMs: z.number().int().min(0).max(150_000),
				endMs: z.number().int().min(0).max(150_000),
				confidence: z.number().min(0).max(1).nullable().default(null),
			}),
		)
		.min(1)
		.max(2_000),
	style: captionStyleSchema.default('clean'),
	safeZone: captionSafeZoneSchema.default('tiktok'),
});

export const captionImportSchema = z.object({
	episodeId: uuid,
	expectedVersion: z.coerce.number().int().min(0).max(10_000),
	track: captionTrackSchema,
	changeNote: z.string().trim().max(500).default(''),
});

export type CaptionWord = z.infer<typeof captionWordSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export type CaptionSafeZone = z.infer<typeof captionSafeZoneSchema>;
