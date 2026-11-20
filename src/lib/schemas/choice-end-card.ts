import { z } from 'zod';

const uuid = z.string().uuid();
const millisecond = z.number().int().min(0).max(150_000);

export const CHOICE_END_CARD_TEMPLATE_IDS = [
	'doors',
	'stamped',
	'signal',
	'cctv',
	'split',
	'analog',
] as const;
export const CHOICE_END_CARD_LAYOUTS = ['split', 'stacked'] as const;
export const CHOICE_END_CARD_SFX = ['none', 'beep', 'rumble', 'pulse'] as const;
export const CHOICE_END_CARD_REVEALS = ['instant', 'progressive'] as const;

export type ChoiceEndCardTemplateId = (typeof CHOICE_END_CARD_TEMPLATE_IDS)[number];
export type ChoiceEndCardLayout = (typeof CHOICE_END_CARD_LAYOUTS)[number];
export type ChoiceEndCardSfx = (typeof CHOICE_END_CARD_SFX)[number];
export type ChoiceEndCardReveal = (typeof CHOICE_END_CARD_REVEALS)[number];

export const END_CARD_MIN_MS = 3_000;
export const END_CARD_MAX_MS = 12_000;

const printableText = (minimum: number, maximum: number) =>
	z
		.string()
		.trim()
		.min(minimum)
		.max(maximum)
		.refine((value) => !/\p{Cc}/u.test(value), 'Texto não pode conter caracteres de controle.');

export const choiceEndCardConfigSchema = z.object({
	schemaVersion: z.literal(1),
	templateId: z.enum(CHOICE_END_CARD_TEMPLATE_IDS),
	layout: z.enum(CHOICE_END_CARD_LAYOUTS),
	durationMs: z.number().int().min(END_CARD_MIN_MS).max(END_CARD_MAX_MS),
	prompt: printableText(1, 80),
	footer: printableText(1, 80).default('Comente A ou B'),
	reveal: z.enum(CHOICE_END_CARD_REVEALS).default('progressive'),
	reducedMotion: z.boolean().default(false),
	sfx: z.enum(CHOICE_END_CARD_SFX).default('beep'),
	sfxVolumeDb: z.number().min(-30).max(-3).default(-12),
	/** `mute` keeps the narration out of the card window; `keep` is an explicit override. */
	narration: z.enum(['mute', 'keep']).default('mute'),
});

export type ChoiceEndCardConfig = z.infer<typeof choiceEndCardConfigSchema>;

export const choiceEndCardChoiceSchema = z.object({
	id: uuid,
	optionKey: z.enum(['1', '2']),
	label: printableText(1, 180),
});

export type ChoiceEndCardChoice = z.infer<typeof choiceEndCardChoiceSchema>;

export const choiceEndCardChoicesSchema = z
	.array(choiceEndCardChoiceSchema)
	.length(2)
	.superRefine((choices, context) => {
		if (choices[0]?.optionKey === choices[1]?.optionKey)
			context.addIssue({
				code: 'custom',
				path: [1, 'optionKey'],
				message: 'As duas escolhas precisam de chaves distintas.',
			});
		if (choices[0]?.id === choices[1]?.id)
			context.addIssue({
				code: 'custom',
				path: [1, 'id'],
				message: 'As duas escolhas precisam de IDs distintos.',
			});
	});

export const editPlanEndCardSchema = choiceEndCardConfigSchema
	.extend({
		cardId: uuid,
		cardRevision: z.number().int().min(1).max(10_000),
		choiceRevisionNumber: z.number().int().min(1),
		startMs: millisecond,
		endMs: millisecond,
		choices: choiceEndCardChoicesSchema,
	})
	.superRefine((value, context) => {
		if (value.endMs <= value.startMs)
			context.addIssue({
				code: 'custom',
				path: ['endMs'],
				message: 'Fim do final A/B deve ser depois do início.',
			});
		if (value.endMs - value.startMs < END_CARD_MIN_MS)
			context.addIssue({
				code: 'custom',
				path: ['endMs'],
				message: 'O final A/B precisa de pelo menos 3 segundos.',
			});
	});

export type EditPlanEndCard = z.infer<typeof editPlanEndCardSchema>;

export const choiceEndCardSaveSchema = z.object({
	episodeId: uuid,
	expectedRevision: z.coerce.number().int().min(0).max(10_000),
	config: choiceEndCardConfigSchema,
	status: z.enum(['DRAFT', 'APPROVED']).default('DRAFT'),
});

export const choiceEndCardAttachSchema = z.object({
	episodeId: uuid,
	revisionId: uuid,
	expectedVersion: z.coerce.number().int().min(0).max(10_000),
});
