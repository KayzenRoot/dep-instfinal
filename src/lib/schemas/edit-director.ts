import { z } from 'zod';

const uuid = z.string().uuid();
const millisecond = z.number().int().min(0).max(150_000);

export const directorPresetSchema = z.enum(['slow-burn', 'reveal', 'found-footage', 'custom']);
export const directorPhaseSchema = z.enum(['HOOK', 'BUILDUP', 'RELIEF', 'REVEAL', 'CLIMAX', 'CTA']);
export const directorEventTypeSchema = z.enum([
	'SILENCE_BEFORE_REVEAL',
	'DOOR_CREAK',
	'VHS_STATIC',
	'PHRASE_HIGHLIGHT',
	'SFX_ACCENT',
	'CTA_CARD',
]);
export const directorEventStatusSchema = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED', 'ADJUSTED']);
export const directorSourceSchema = z.enum(['OFFLINE', 'GEMINI']);
export const directorReviewStatusSchema = z.enum(['DRAFT', 'REVIEWED', 'APPLIED']);

export const tensionPointSchema = z.object({
	timeMs: millisecond,
	tension: z.number().int().min(0).max(100),
});

export const tensionMarkerSchema = z.object({
	timeMs: millisecond,
	phase: directorPhaseSchema,
	label: z.string().trim().min(1).max(120),
	rationale: z.string().trim().min(1).max(300),
});

export const directorEventSchema = z
	.object({
		id: uuid,
		type: directorEventTypeSchema,
		startMs: millisecond,
		durationMs: z.number().int().min(100).max(8_000),
		intensity: z.number().int().min(1).max(5),
		reason: z.string().trim().min(1).max(300),
		assetId: uuid.nullable().default(null),
		cueId: uuid.nullable().default(null),
		status: directorEventStatusSchema.default('PROPOSED'),
	})
	.superRefine((event, context) => {
		if (event.startMs + event.durationMs > 150_000)
			context.addIssue({
				code: 'custom',
				path: ['durationMs'],
				message: 'Evento de direção excede a duração máxima.',
			});
		if (['DOOR_CREAK', 'SFX_ACCENT'].includes(event.type) && !event.assetId)
			context.addIssue({
				code: 'custom',
				path: ['assetId'],
				message: 'Efeito sonoro exige um asset licenciado.',
			});
		if (event.type === 'CTA_CARD' && event.assetId)
			context.addIssue({
				code: 'custom',
				path: ['assetId'],
				message: 'CTA não usa asset de áudio.',
			});
		if (event.type === 'VHS_STATIC' && event.durationMs > 700)
			context.addIssue({
				code: 'custom',
				path: ['durationMs'],
				message: 'Glitch VHS limitado a 700 ms por proteção fotossensível.',
			});
	});

export const directorCtaSchema = z.object({
	text: z.string().trim().min(1).max(200),
	references: z.array(z.string().trim().min(1).max(180)).max(2).default([]),
});

/** Snapshot of the timeline CTA so reverting the director can restore it exactly. */
export const directorPreviousCtaSchema = z
	.object({
		enabled: z.boolean(),
		text: z.string().trim().max(200),
		startMs: millisecond,
		endMs: millisecond,
	})
	.superRefine((value, context) => {
		if (value.enabled && !value.text)
			context.addIssue({ code: 'custom', path: ['text'], message: 'CTA habilitada exige texto.' });
		if (value.enabled && value.endMs <= value.startMs)
			context.addIssue({
				code: 'custom',
				path: ['endMs'],
				message: 'Fim da CTA deve ser depois do início.',
			});
	})
	.nullable()
	.default(null);

export const editDirectorPlanSchema = z
	.object({
		schemaVersion: z.literal(1),
		episodeId: uuid.optional(),
		source: directorSourceSchema,
		preset: directorPresetSchema,
		seed: z.number().int().min(0).max(2_147_483_647),
		reviewStatus: directorReviewStatusSchema.default('DRAFT'),
		generatedAt: z.string().datetime(),
		points: z.array(tensionPointSchema).min(2).max(40),
		markers: z.array(tensionMarkerSchema).min(1).max(12),
		events: z.array(directorEventSchema).max(24),
		cta: directorCtaSchema.nullable().default(null),
		previousCta: directorPreviousCtaSchema,
		acceptedEventIds: z.array(uuid).max(24).default([]),
		planHash: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.nullable()
			.default(null),
		note: z.string().trim().max(500).default(''),
	})
	.superRefine((director, context) => {
		let previous = -1;
		for (const [index, point] of director.points.entries()) {
			if (point.timeMs <= previous)
				context.addIssue({
					code: 'custom',
					path: ['points', index, 'timeMs'],
					message: 'Pontos de tensão precisam ser estritamente crescentes.',
				});
			previous = point.timeMs;
		}
		const markerKeys = new Set<string>();
		for (const [index, marker] of director.markers.entries()) {
			const key = `${marker.phase}:${marker.timeMs}`;
			if (markerKeys.has(key))
				context.addIssue({
					code: 'custom',
					path: ['markers', index],
					message: 'Marcador de direção duplicado.',
				});
			markerKeys.add(key);
		}
		const eventIds = new Set<string>();
		for (const [index, event] of director.events.entries()) {
			if (eventIds.has(event.id))
				context.addIssue({
					code: 'custom',
					path: ['events', index, 'id'],
					message: 'Evento de direção duplicado.',
				});
			eventIds.add(event.id);
		}
		for (const eventId of director.acceptedEventIds) {
			if (!eventIds.has(eventId))
				context.addIssue({
					code: 'custom',
					path: ['acceptedEventIds'],
					message: 'Aceite aponta para evento inexistente.',
				});
		}
		const glitches = director.events.filter((event) => event.type === 'VHS_STATIC');
		if (glitches.length > 3)
			context.addIssue({
				code: 'custom',
				path: ['events'],
				message: 'No máximo 3 glitches VHS por episódio.',
			});
		if (glitches.reduce((total, event) => total + event.durationMs, 0) > 2_100)
			context.addIssue({
				code: 'custom',
				path: ['events'],
				message: 'Glitches VHS somam mais de 2.100 ms; reduza por fotossensibilidade.',
			});
	});

export type DirectorPreset = z.infer<typeof directorPresetSchema>;
export type DirectorPhase = z.infer<typeof directorPhaseSchema>;
export type DirectorEventType = z.infer<typeof directorEventTypeSchema>;
export type DirectorEvent = z.infer<typeof directorEventSchema>;
export type EditDirectorPlan = z.infer<typeof editDirectorPlanSchema>;
export type TensionPoint = z.infer<typeof tensionPointSchema>;
export type TensionMarker = z.infer<typeof tensionMarkerSchema>;
