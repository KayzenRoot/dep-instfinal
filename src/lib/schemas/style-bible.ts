import { z } from 'zod';
import { COLOR_PRESET_IDS } from './color-grade.js';
import { COVER_TEMPLATE_IDS } from './cover.js';
import { CHOICE_END_CARD_TEMPLATE_IDS } from './choice-end-card.js';

const uuid = z.string().uuid();
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Cor deve ser hexadecimal #rrggbb.');

export const STYLE_SCOPE_TYPES = ['SERIES', 'SEASON'] as const;
export const STYLE_FONT_FAMILIES = ['serif', 'sans', 'mono', 'display'] as const;
export const STYLE_CAPTION_TEMPLATES = ['none', 'clean', 'horror'] as const;
export const STYLE_CAPTION_SAFE_ZONES = ['tiktok', 'stories', 'feed'] as const;
export const STYLE_MOTION = ['restrained', 'standard', 'kinetic'] as const;
export const STYLE_SFX_CATEGORIES = ['none', 'archive', 'signal', 'pulse', 'ambience'] as const;
export const STYLE_VOICE_STYLES = ['neutral', 'documentary', 'whisper', 'urgent', 'none'] as const;
export const STYLE_OPENING_HOOKS = ['none', 'cold_open', 'intriguing_line', 'sound_entry'] as const;

export type StyleScopeType = (typeof STYLE_SCOPE_TYPES)[number];
export type StyleFontFamily = (typeof STYLE_FONT_FAMILIES)[number];
export type StyleCaptionTemplate = (typeof STYLE_CAPTION_TEMPLATES)[number];
export type StyleCaptionSafeZone = (typeof STYLE_CAPTION_SAFE_ZONES)[number];
export type StyleMotion = (typeof STYLE_MOTION)[number];
export type StyleSfxCategory = (typeof STYLE_SFX_CATEGORIES)[number];
export type StyleVoiceStyle = (typeof STYLE_VOICE_STYLES)[number];
export type StyleOpeningHook = (typeof STYLE_OPENING_HOOKS)[number];

export const STYLE_BIBLE_VERSION = 1;

const styleFields = {
	paletteBackground: hex,
	paletteForeground: hex,
	paletteAccent: hex,
	paletteMuted: hex,
	colorPresetId: z.enum(COLOR_PRESET_IDS),
	colorStrength: z.number().min(0).max(1),
	fontFamily: z.enum(STYLE_FONT_FAMILIES),
	captionTemplate: z.enum(STYLE_CAPTION_TEMPLATES),
	captionSafeZone: z.enum(STYLE_CAPTION_SAFE_ZONES),
	motion: z.enum(STYLE_MOTION),
	reducedMotion: z.boolean(),
	vhsIntensity: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
	sfxCategory: z.enum(STYLE_SFX_CATEGORIES),
	sfxAssetIds: z
		.array(uuid)
		.max(8)
		.refine((ids) => new Set(ids).size === ids.length, 'SFX duplicado.'),
	voiceStyle: z.enum(STYLE_VOICE_STYLES),
	openingHookKind: z.enum(STYLE_OPENING_HOOKS),
	coverTemplateId: z.enum(COVER_TEMPLATE_IDS),
	endCardTemplateId: z.enum(CHOICE_END_CARD_TEMPLATE_IDS),
	ctaPrompt: z.string().trim().min(1).max(80),
};

export const styleConfigSchema = z
	.object({
		schemaVersion: z.literal(STYLE_BIBLE_VERSION),
		paletteBackground: styleFields.paletteBackground.default('#08090b'),
		paletteForeground: styleFields.paletteForeground.default('#e8e2d6'),
		paletteAccent: styleFields.paletteAccent.default('#b6ff9a'),
		paletteMuted: styleFields.paletteMuted.default('#8a8a8a'),
		colorPresetId: styleFields.colorPresetId.default('neutral'),
		colorStrength: styleFields.colorStrength.default(1),
		fontFamily: styleFields.fontFamily.default('sans'),
		captionTemplate: styleFields.captionTemplate.default('clean'),
		captionSafeZone: styleFields.captionSafeZone.default('tiktok'),
		motion: styleFields.motion.default('restrained'),
		reducedMotion: styleFields.reducedMotion.default(false),
		vhsIntensity: styleFields.vhsIntensity.default(1),
		sfxCategory: styleFields.sfxCategory.default('none'),
		sfxAssetIds: styleFields.sfxAssetIds.default([]),
		voiceStyle: styleFields.voiceStyle.default('neutral'),
		openingHookKind: styleFields.openingHookKind.default('none'),
		coverTemplateId: styleFields.coverTemplateId.default('noir'),
		endCardTemplateId: styleFields.endCardTemplateId.default('doors'),
		ctaPrompt: styleFields.ctaPrompt.default('Comente A ou B'),
	})
	.strict();

export type StyleConfig = z.infer<typeof styleConfigSchema>;

export const styleOverrideSchema = z
	.object({
		schemaVersion: z.literal(STYLE_BIBLE_VERSION).optional(),
		paletteBackground: styleFields.paletteBackground.optional(),
		paletteForeground: styleFields.paletteForeground.optional(),
		paletteAccent: styleFields.paletteAccent.optional(),
		paletteMuted: styleFields.paletteMuted.optional(),
		colorPresetId: styleFields.colorPresetId.optional(),
		colorStrength: styleFields.colorStrength.optional(),
		fontFamily: styleFields.fontFamily.optional(),
		captionTemplate: styleFields.captionTemplate.optional(),
		captionSafeZone: styleFields.captionSafeZone.optional(),
		motion: styleFields.motion.optional(),
		reducedMotion: styleFields.reducedMotion.optional(),
		vhsIntensity: styleFields.vhsIntensity.optional(),
		sfxCategory: styleFields.sfxCategory.optional(),
		sfxAssetIds: styleFields.sfxAssetIds.optional(),
		voiceStyle: styleFields.voiceStyle.optional(),
		openingHookKind: styleFields.openingHookKind.optional(),
		coverTemplateId: styleFields.coverTemplateId.optional(),
		endCardTemplateId: styleFields.endCardTemplateId.optional(),
		ctaPrompt: styleFields.ctaPrompt.optional(),
	})
	.strict();

export type StyleOverride = z.infer<typeof styleOverrideSchema>;

export const styleSourcesSchema = z.record(
	z.string(),
	z.enum(['DEFAULT', 'SERIES', 'SEASON', 'EPISODE', 'SCENE']),
);

export const styleSceneSnapshotSchema = z.object({
	sceneId: uuid,
	sceneIndex: z.number().int().min(1).max(500),
	config: styleConfigSchema,
	sources: styleSourcesSchema,
});

export const styleSnapshotSchema = z.object({
	presetId: uuid.nullable(),
	presetRevision: z.number().int().min(1).nullable(),
	presetHash: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.nullable(),
	scopeType: z.enum(STYLE_SCOPE_TYPES).nullable(),
	scopeId: uuid.nullable(),
	config: styleConfigSchema,
	sources: styleSourcesSchema,
	scenes: z.array(styleSceneSnapshotSchema).max(60).optional(),
	warnings: z.array(z.string().max(200)).max(20).default([]),
	capturedAt: z.string().datetime({ offset: true }),
});

export type StyleSnapshot = z.infer<typeof styleSnapshotSchema>;

export const stylePresetSaveSchema = z.object({
	scopeType: z.enum(STYLE_SCOPE_TYPES),
	scopeId: uuid,
	name: z.string().trim().min(1).max(80),
	expectedRevision: z.number().int().min(0).max(10_000),
	config: styleConfigSchema,
	status: z.enum(['DRAFT', 'APPROVED']).default('DRAFT'),
});

export const styleImportSchema = z.object({
	format: z.literal('dif-studio-style-preset/v1'),
	name: z.string().trim().min(1).max(80),
	scopeType: z.enum(STYLE_SCOPE_TYPES),
	scopeId: uuid,
	config: styleConfigSchema,
});
