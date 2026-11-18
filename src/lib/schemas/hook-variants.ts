import { z } from 'zod';

export const HOOK_VARIANT_KEYS = ['cold_open', 'intriguing_line', 'sound_entry'] as const;
export const hookVariantKeySchema = z.enum(HOOK_VARIANT_KEYS);
export const hookObjectiveSchema = z.enum(['MYSTERY', 'REVEAL', 'SOUND']);

export const hookVariantDraftSchema = z.object({
	variantKey: hookVariantKeySchema,
	label: z.string().min(3).max(80),
	objective: hookObjectiveSchema,
	openingClipId: z.string().uuid(),
	openingAssetId: z.string().uuid(),
	openingSceneIndex: z.number().int().min(0),
	openingStartMs: z.number().int().min(0),
	openingEndMs: z.number().int().min(1),
	premise: z.string().min(8).max(300),
	score: z.number().int().min(0).max(100),
	reasons: z.array(z.string().min(3).max(300)).min(1).max(8),
});

export const hookVariantRowSchema = hookVariantDraftSchema.extend({
	id: z.string().uuid(),
	ownerId: z.string().uuid(),
	episodeId: z.string().uuid(),
	planId: z.string().uuid(),
	planVersion: z.number().int().min(1),
	sourcePlanHash: z.string().regex(/^[0-9a-f]{64}$/),
	status: z.enum(['DRAFT', 'APPLIED']),
	appliedVersion: z.number().int().min(1).nullable(),
	appliedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});

export type HookVariantKey = z.infer<typeof hookVariantKeySchema>;
export type HookVariantDraft = z.infer<typeof hookVariantDraftSchema>;
export type HookVariantRow = z.infer<typeof hookVariantRowSchema>;
