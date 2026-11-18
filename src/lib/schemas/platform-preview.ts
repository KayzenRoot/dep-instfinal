import { z } from 'zod';

const coordinate = z.number().int().min(0).max(1_920);

export const platformProfileIdSchema = z.enum(['tiktok', 'reels', 'clean']);

export const previewBoxSchema = z
	.object({
		x: z.number().int().min(0).max(1_080),
		y: coordinate,
		width: z.number().int().min(320).max(1_080),
		height: z.number().int().min(80).max(1_920),
	})
	.superRefine((box, context) => {
		if (box.x + box.width > 1_080)
			context.addIssue({
				code: 'custom',
				path: ['width'],
				message: 'Caixa excede a largura de 1080 px.',
			});
		if (box.y + box.height > 1_920)
			context.addIssue({
				code: 'custom',
				path: ['height'],
				message: 'Caixa excede a altura de 1920 px.',
			});
	});

export const editPlanPreviewSchema = z.object({
	profileId: platformProfileIdSchema,
	profileVersion: z.literal(1).default(1),
	captionBox: previewBoxSchema.optional(),
	ctaBox: previewBoxSchema.optional(),
});

export type PlatformProfileId = z.infer<typeof platformProfileIdSchema>;
export type PreviewBox = z.infer<typeof previewBoxSchema>;
export type EditPlanPreview = z.infer<typeof editPlanPreviewSchema>;
