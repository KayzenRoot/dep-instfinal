import { z } from 'zod';

const uuid = z.string().uuid();
const count = z.number().int().min(0).max(1_000_000_000_000);
const nullableCount = count.nullable().default(null);

export const RETENTION_PLATFORMS = ['tiktok', 'reels', 'youtube_shorts', 'other'] as const;
export const RETENTION_VARIANT_KINDS = ['HOOK', 'COVER', 'CTA', 'BASELINE'] as const;
export const RETENTION_SOURCES = ['MANUAL', 'CSV'] as const;
export const RETENTION_EXPERIMENT_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;

export type RetentionPlatform = (typeof RETENTION_PLATFORMS)[number];
export type RetentionVariantKind = (typeof RETENTION_VARIANT_KINDS)[number];
export type RetentionSource = (typeof RETENTION_SOURCES)[number];
export type RetentionExperimentStatus = (typeof RETENTION_EXPERIMENT_STATUSES)[number];

const text = (minimum: number, maximum: number) =>
	z
		.string()
		.trim()
		.min(minimum)
		.max(maximum)
		.refine((value) => !/\p{Cc}/u.test(value.replaceAll(/[\n\r\t]/g, '')), 'Texto inválido.');

export const retentionUrlSchema = z
	.string()
	.trim()
	.min(8)
	.max(500)
	.refine((value) => {
		try {
			const url = new URL(value);
			return (
				['http:', 'https:'].includes(url.protocol) &&
				!url.username &&
				!url.password &&
				url.hostname.length > 3
			);
		} catch {
			return false;
		}
	}, 'Informe uma URL http(s) pública fornecida pela plataforma.');

export const publishedPostInputSchema = z.object({
	episodeId: uuid,
	platform: z.enum(RETENTION_PLATFORMS),
	url: retentionUrlSchema,
	publishedAt: z.string().datetime({ offset: true }),
	label: text(0, 120).default(''),
	notes: text(0, 1_000).default(''),
	changeNote: text(0, 300).default(''),
});

export const creativeVariantInputSchema = z.object({
	postId: uuid,
	kind: z.enum(RETENTION_VARIANT_KINDS),
	label: text(1, 80),
	hookVariantId: uuid.nullable().default(null),
	coverRevisionId: uuid.nullable().default(null),
	endCardId: uuid.nullable().default(null),
});

export const analyticsMetricsSchema = z
	.object({
		views: nullableCount,
		likes: nullableCount,
		comments: nullableCount,
		shares: nullableCount,
		saves: nullableCount,
		followersGained: count.nullable().default(null),
		avgWatchMs: z.number().int().min(0).max(600_000).nullable().default(null),
		completionPct: z.number().min(0).max(100).nullable().default(null),
	})
	.superRefine((metrics, context) => {
		if (metrics.completionPct !== null && Number.isNaN(metrics.completionPct))
			context.addIssue({
				code: 'custom',
				path: ['completionPct'],
				message: 'Percentual inválido.',
			});
	});

export const analyticsSnapshotInputSchema = z
	.object({
		postId: uuid,
		capturedAt: z.string().datetime({ offset: true }),
		periodStart: z.string().datetime({ offset: true }),
		periodEnd: z.string().datetime({ offset: true }),
		source: z.enum(RETENTION_SOURCES).default('MANUAL'),
		note: text(0, 1_000).default(''),
		supersedesSnapshotId: uuid.nullable().default(null),
		metrics: analyticsMetricsSchema,
	})
	.superRefine((snapshot, context) => {
		const start = Date.parse(snapshot.periodStart);
		const end = Date.parse(snapshot.periodEnd);
		const captured = Date.parse(snapshot.capturedAt);
		if (!(start < end))
			context.addIssue({
				code: 'custom',
				path: ['periodEnd'],
				message: 'O período precisa terminar depois do início.',
			});
		if (captured < end)
			context.addIssue({
				code: 'custom',
				path: ['capturedAt'],
				message: 'A coleta não pode ser anterior ao fim do período.',
			});
	});

export const experimentInputSchema = z.object({
	episodeId: uuid,
	name: text(1, 80),
	variantAId: uuid,
	variantBId: uuid,
	hypothesis: text(0, 500).default(''),
});

export const retentionImportRowSchema = z
	.object({
		platform: z.enum(RETENTION_PLATFORMS),
		url: retentionUrlSchema,
		published_at: z.string().datetime({ offset: true }),
		label: text(0, 120).default(''),
		period_start: z.string().datetime({ offset: true }),
		period_end: z.string().datetime({ offset: true }),
		captured_at: z.string().datetime({ offset: true }),
		views: nullableCount,
		likes: nullableCount,
		comments: nullableCount,
		shares: nullableCount,
		saves: nullableCount,
		followers_gained: count.nullable().default(null),
		avg_watch_ms: z.number().int().min(0).max(600_000).nullable().default(null),
		completion_pct: z.number().min(0).max(100).nullable().default(null),
		note: text(0, 1_000).default(''),
	})
	.superRefine((row, context) => {
		const start = Date.parse(row.period_start);
		const end = Date.parse(row.period_end);
		const captured = Date.parse(row.captured_at);
		if (!(start < end))
			context.addIssue({
				code: 'custom',
				path: ['period_end'],
				message: 'Período termina antes do início.',
			});
		if (!(captured >= end))
			context.addIssue({
				code: 'custom',
				path: ['captured_at'],
				message: 'Coleta anterior ao fim do período.',
			});
	});

export type PublishedPostInput = z.infer<typeof publishedPostInputSchema>;
export type CreativeVariantInput = z.infer<typeof creativeVariantInputSchema>;
export type AnalyticsSnapshotInput = z.infer<typeof analyticsSnapshotInputSchema>;
export type AnalyticsMetrics = z.infer<typeof analyticsMetricsSchema>;
export type RetentionImportRow = z.infer<typeof retentionImportRowSchema>;
export type ExperimentInput = z.infer<typeof experimentInputSchema>;
