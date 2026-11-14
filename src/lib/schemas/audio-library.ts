import { z } from 'zod';

const uuid = z.string().uuid();
const millisecond = z.number().int().min(0).max(150_000);

export const audioKindSchema = z.enum(['AMBIENCE', 'MUSIC', 'SFX']);
export const audioLicenseStatusSchema = z.enum(['VERIFIED', 'UNKNOWN', 'BLOCKED']);
export const audioSpatialPresetSchema = z.enum([
	'none',
	'corridor',
	'radio',
	'steps-behind',
	'whisper-side',
]);
export const audioSpatialModeSchema = z.enum(['stereo_pan', 'binaural_simulated']);

export const AUDIO_CATEGORY_PRESETS = [
	'porta',
	'passos',
	'impacto',
	'drone',
	'ambiente',
	'silencio',
	'radio',
	'sussurro',
] as const;

export const audioAssetMetadataSchema = z
	.object({
		kind: audioKindSchema,
		title: z.string().trim().min(1).max(120),
		author: z.string().trim().min(1).max(120),
		source: z.string().trim().min(1).max(200),
		licenseName: z.string().trim().min(1).max(120),
		licenseUrl: z
			.string()
			.trim()
			.url()
			.max(500)
			.refine((value) => /^https?:\/\//i.test(value), 'URL deve usar http(s).')
			.nullable()
			.default(null),
		attribution: z.string().trim().min(1).max(300),
		commercialAllowed: z.boolean(),
		socialAllowed: z.boolean(),
		licenseStatus: audioLicenseStatusSchema,
		tags: z.array(z.string().trim().min(1).max(32)).min(1).max(12),
		intensity: z.number().int().min(1).max(5),
	})
	.superRefine((metadata, context) => {
		if (
			metadata.licenseStatus === 'VERIFIED' &&
			(!metadata.commercialAllowed || !metadata.socialAllowed)
		)
			context.addIssue({
				code: 'custom',
				path: ['licenseStatus'],
				message: 'Licença verificada precisa permitir uso comercial e distribuição social.',
			});
	});

export const audioAssetSchema = audioAssetMetadataSchema.and(
	z.object({
		id: uuid,
		sha256: z.string().regex(/^[0-9a-f]{64}$/),
		byteSize: z.number().int().positive(),
		durationMs: z.number().int().min(100).max(600_000),
		sampleRate: z.number().int().min(8_000).max(192_000),
		channels: z.number().int().min(1).max(2),
		format: z.string().trim().min(1).max(32),
		peakDb: z.number().min(-120).max(0).nullable().default(null),
		truePeakDb: z.number().min(-120).max(0).nullable().default(null),
		lufs: z.number().min(-120).max(0).nullable().default(null),
		createdAt: z.string().datetime(),
	}),
);

export const editPlanAudioEventSchema = z
	.object({
		id: uuid,
		assetId: uuid,
		kind: audioKindSchema,
		startMs: millisecond,
		durationMs: z.number().int().min(100).max(600_000),
		sourceInMs: z.number().int().min(0).max(600_000).default(0),
		gainDb: z.number().min(-60).max(12).default(0),
		fadeInMs: z.number().int().min(0).max(10_000).default(0),
		fadeOutMs: z.number().int().min(0).max(10_000).default(0),
		pan: z.number().min(-1).max(1).default(0),
		loop: z.boolean().default(false),
		ducking: z.boolean().default(true),
		spatialPreset: audioSpatialPresetSchema.default('none'),
		spatialMode: audioSpatialModeSchema.default('stereo_pan'),
	})
	.superRefine((event, context) => {
		if (event.startMs + event.durationMs > 150_000)
			context.addIssue({
				code: 'custom',
				path: ['durationMs'],
				message: 'Evento de áudio excede a duração máxima do episódio.',
			});
		if (event.fadeInMs + event.fadeOutMs > event.durationMs)
			context.addIssue({
				code: 'custom',
				path: ['fadeOutMs'],
				message: 'Fades excedem a duração do evento.',
			});
		if (event.loop && event.sourceInMs > 0)
			context.addIssue({
				code: 'custom',
				path: ['sourceInMs'],
				message: 'Loop não aceita offset de origem.',
			});
	});

export const editPlanAudioSchema = z.object({
	masterGainDb: z.number().min(-12).max(6).default(0),
	events: z.array(editPlanAudioEventSchema).max(64).default([]),
});

export type AudioKind = z.infer<typeof audioKindSchema>;
export type AudioLicenseStatus = z.infer<typeof audioLicenseStatusSchema>;
export type AudioAssetMetadata = z.infer<typeof audioAssetMetadataSchema>;
export type AudioAsset = z.infer<typeof audioAssetSchema>;
export type EditPlanAudioEvent = z.infer<typeof editPlanAudioEventSchema>;
export type EditPlanAudio = z.infer<typeof editPlanAudioSchema>;
export type AudioSpatialPreset = z.infer<typeof audioSpatialPresetSchema>;
export type AudioSpatialMode = z.infer<typeof audioSpatialModeSchema>;
