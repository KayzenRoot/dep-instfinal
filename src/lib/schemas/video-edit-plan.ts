import { z } from 'zod';

const uuid = z.string().uuid();
const millisecond = z.number().int().min(0).max(150_000);

export const editPlanTrackSchema = z.object({
	id: z
		.string()
		.trim()
		.min(2)
		.max(32)
		.regex(/^[a-z][a-z0-9-]*$/, 'Identificador de track inválido.'),
	kind: z.enum(['video', 'overlay']),
	label: z.string().trim().min(1).max(60),
});

export const editPlanClipSchema = z.object({
	id: uuid,
	sceneId: uuid,
	assetId: uuid,
	trackId: z.string().trim().min(2).max(32),
	sourceInMs: millisecond,
	sourceOutMs: millisecond,
	timelineStartMs: millisecond,
	timelineEndMs: millisecond,
	transition: z.enum(['cut', 'crossfade']).default('cut'),
	transitionMs: z.number().int().min(0).max(1_000).default(0),
	gainDb: z.number().min(-60).max(12).default(0),
});

export const editPlanCtaSchema = z
	.object({
		enabled: z.boolean(),
		text: z.string().trim().max(200),
		startMs: millisecond,
		endMs: millisecond,
	})
	.superRefine((value, context) => {
		if (value.enabled && !value.text) {
			context.addIssue({ code: 'custom', path: ['text'], message: 'CTA habilitada exige texto.' });
		}
		if (value.enabled && value.endMs <= value.startMs) {
			context.addIssue({
				code: 'custom',
				path: ['endMs'],
				message: 'Fim da CTA deve ser depois do início.',
			});
		}
	});

export const videoEditPlanSchema = z.object({
	schemaVersion: z.literal(1),
	episodeId: uuid,
	episodeRevisionNumber: z.number().int().min(1).nullable().default(null),
	durationMs: z.number().int().min(90_000).max(150_000),
	sceneDurationMs: z.union([z.literal(4_000), z.literal(6_000), z.literal(8_000)]),
	fps: z.literal(30),
	tracks: z.array(editPlanTrackSchema).min(1).max(4),
	clips: z.array(editPlanClipSchema).min(1).max(60),
	captions: z
		.object({ template: z.enum(['none', 'clean', 'horror']) })
		.default({ template: 'clean' }),
	cta: editPlanCtaSchema.nullable().default(null),
});

export type VideoEditPlan = z.infer<typeof videoEditPlanSchema>;
export type EditPlanClip = z.infer<typeof editPlanClipSchema>;
export type EditPlanTrack = z.infer<typeof editPlanTrackSchema>;

export const editPlanSaveSchema = z.object({
	episodeId: uuid,
	expectedVersion: z.coerce.number().int().min(0).max(10_000),
	plan: videoEditPlanSchema,
	changeNote: z.string().trim().max(500).default(''),
});

export const editPlanRestoreSchema = z.object({
	episodeId: uuid,
	version: z.coerce.number().int().min(1).max(10_000),
	expectedVersion: z.coerce.number().int().min(1).max(10_000),
});

export const editPlanStatusSchema = z.object({
	episodeId: uuid,
	expectedVersion: z.coerce.number().int().min(1).max(10_000),
	status: z.enum(['DRAFT', 'APPROVED']),
});
