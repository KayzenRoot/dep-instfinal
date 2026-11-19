import { z } from 'zod';

const uuid = z.string().uuid();
const boundedText = (max: number) => z.string().trim().max(max).default('');

export const CONTINUITY_ENTITY_TYPES = [
	'CHARACTER',
	'OBJECT',
	'LOCATION',
	'LIGHTING',
	'TIME',
	'FRAME',
] as const;
export const CONTINUITY_METHODS = ['METADATA', 'PIXEL_STATS', 'MANUAL'] as const;
export const CONTINUITY_CONFIDENCES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'] as const;
export const CONTINUITY_OBSERVATION_STATUSES = [
	'NEEDS_REVIEW',
	'ACCEPTED',
	'EXCEPTION',
	'BLOCKING',
	'RESOLVED',
] as const;
export const CONTINUITY_REPORT_STATUSES = ['NEEDS_REVIEW', 'ACCEPTED', 'BLOCKING'] as const;

export const continuityEntityTypeSchema = z.enum(CONTINUITY_ENTITY_TYPES);
export const continuityMethodSchema = z.enum(CONTINUITY_METHODS);
export const continuityConfidenceSchema = z.enum(CONTINUITY_CONFIDENCES);
export const continuityObservationStatusSchema = z.enum(CONTINUITY_OBSERVATION_STATUSES);
export const continuityReportStatusSchema = z.enum(CONTINUITY_REPORT_STATUSES);

export const continuityFrameStatsSchema = z.object({
	frameCount: z.number().int().min(0),
	meanLuma: z.number().finite(),
	p05Luma: z.number().finite(),
	p95Luma: z.number().finite(),
	lowClipPct: z.number().finite(),
	highClipPct: z.number().finite(),
	meanSaturation: z.number().finite(),
});

export const continuityObservationSchema = z.object({
	id: z.string().regex(/^obs_[0-9a-f]{12}$/),
	sceneId: uuid,
	sceneIndex: z.number().int().min(1).max(60),
	characterId: uuid.nullable().default(null),
	characterName: boundedText(120),
	entityType: continuityEntityTypeSchema,
	attribute: z.string().trim().min(1).max(80),
	expected: z.string().trim().min(1).max(500),
	observed: z.string().trim().min(1).max(500),
	method: continuityMethodSchema,
	confidence: continuityConfidenceSchema,
	status: continuityObservationStatusSchema,
	frameAssetId: uuid.nullable().default(null),
	evidence: boundedText(500),
	decisionNote: boundedText(500),
	decidedAt: z.string().datetime().nullable().default(null),
});

export const continuityFrameSchema = z.object({
	sceneId: uuid,
	sceneIndex: z.number().int().min(1).max(60),
	role: z.enum(['START', 'END']),
	assetId: uuid,
	stats: continuityFrameStatsSchema.nullable(),
});

export const visualContinuityReportSchema = z.object({
	schemaVersion: z.literal(1),
	episodeId: uuid,
	seriesId: uuid,
	episodeNumber: z.number().int().min(1).max(99),
	episodeRevisionNumber: z.number().int().min(1).nullable(),
	generatedAt: z.string().datetime(),
	profilesUsed: z
		.array(
			z.object({
				characterId: uuid,
				name: z.string().trim().min(1).max(120),
				version: z.number().int().min(1),
			}),
		)
		.max(60),
	frames: z.array(continuityFrameSchema).max(120),
	observations: z.array(continuityObservationSchema).max(200),
	summary: z.object({
		total: z.number().int().min(0),
		needsReview: z.number().int().min(0),
		accepted: z.number().int().min(0),
		exceptions: z.number().int().min(0),
		blocking: z.number().int().min(0),
		resolved: z.number().int().min(0),
		unknown: z.number().int().min(0),
	}),
	status: continuityReportStatusSchema,
	limitations: z.array(z.string().trim().min(1).max(300)).max(10),
});

export const visualContinuityDecisionSchema = z
	.object({
		observationId: z.string().regex(/^obs_[0-9a-f]{12}$/),
		status: continuityObservationStatusSchema,
		rationale: boundedText(500),
		action: z.enum(['NONE', 'REGENERATE']).default('NONE'),
	})
	.superRefine((decision, context) => {
		if (
			['EXCEPTION', 'BLOCKING', 'RESOLVED'].includes(decision.status) &&
			decision.rationale.length < 3
		)
			context.addIssue({
				code: 'custom',
				message: 'Explique a decisão antes de salvar.',
				path: ['rationale'],
			});
	});

export type ContinuityEntityType = z.infer<typeof continuityEntityTypeSchema>;
export type ContinuityObservationStatus = z.infer<typeof continuityObservationStatusSchema>;
export type ContinuityObservation = z.infer<typeof continuityObservationSchema>;
export type ContinuityFrame = z.infer<typeof continuityFrameSchema>;
export type VisualContinuityReport = z.infer<typeof visualContinuityReportSchema>;
export type VisualContinuityDecision = z.infer<typeof visualContinuityDecisionSchema>;
