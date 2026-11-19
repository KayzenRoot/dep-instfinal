import { z } from 'zod';

export const COVER_TEMPLATE_IDS = ['noir', 'vhs_polaroid', 'archive', 'cctv'] as const;
export const COVER_FORMAT_IDS = ['9:16', '3:4', '4:5'] as const;

export const COVER_FORMATS = {
	'9:16': { width: 1080, height: 1920, label: '9:16 · TikTok/Reels' },
	'3:4': { width: 1080, height: 1440, label: '3:4 · feed' },
	'4:5': { width: 1080, height: 1350, label: '4:5 · feed' },
} as const;

export const coverTemplateIdSchema = z.enum(COVER_TEMPLATE_IDS);
export const coverFormatIdSchema = z.enum(COVER_FORMAT_IDS);

export const coverConfigSchema = z.object({
	schemaVersion: z.literal(1),
	templateId: coverTemplateIdSchema,
	templateVersion: z.literal(1),
	format: coverFormatIdSchema,
	frameAssetId: z.string().uuid().nullable().default(null),
	title: z.string().trim().min(1).max(120),
	subtitle: z.string().trim().max(200).default(''),
	badge: z.string().trim().max(40).default(''),
	seriesTitle: z.string().trim().max(120).default(''),
	focusX: z.number().min(0).max(1).default(0.5),
	focusY: z.number().min(0).max(1).default(0.5),
	watermark: z.boolean().default(true),
});

export type CoverConfig = z.infer<typeof coverConfigSchema>;
export type CoverTemplateId = z.infer<typeof coverTemplateIdSchema>;
export type CoverFormatId = z.infer<typeof coverFormatIdSchema>;

export const coverRevisionStatusSchema = z.enum(['DRAFT', 'APPROVED']);
export type CoverRevisionStatus = z.infer<typeof coverRevisionStatusSchema>;
