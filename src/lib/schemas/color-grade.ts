import { z } from 'zod';

export const COLOR_PRESET_IDS = [
	'neutral',
	'vhs_1987',
	'police_archive',
	'cctv',
	'cursed_tape',
] as const;
export const colorPresetIdSchema = z.enum(COLOR_PRESET_IDS);

export const colorOverrideSchema = z.object({
	clipId: z.string().uuid(),
	strength: z.number().int().min(0).max(100),
	exclude: z.boolean(),
});

export const colorGradeSchema = z.object({
	presetId: colorPresetIdSchema,
	presetVersion: z.literal(1),
	strength: z.number().int().min(0).max(100),
	referenceClipId: z.string().uuid().nullable(),
	overrides: z.array(colorOverrideSchema).max(60),
});

export type ColorPresetId = z.infer<typeof colorPresetIdSchema>;
export type ColorOverride = z.infer<typeof colorOverrideSchema>;
export type ColorGrade = z.infer<typeof colorGradeSchema>;
