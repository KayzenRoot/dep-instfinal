import { z } from 'zod';

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default('');

export const seriesSchema = z.object({
	title: requiredText(120),
	premise: optionalText(8_000),
	subgenre: optionalText(120),
	tone: optionalText(120),
	audience: optionalText(500),
});

export const seasonSchema = z.object({
	seriesId: z.string().uuid(),
	seasonNumber: z.coerce.number().int().min(1).max(99),
	title: requiredText(120),
	plannedEpisodeCount: z.coerce.number().int().min(10).max(15),
	summary: optionalText(8_000),
});

export const characterSchema = z.object({
	seriesId: z.string().uuid(),
	seasonId: z.string().uuid().optional().or(z.literal('')),
	name: requiredText(120),
	role: optionalText(120),
	description: optionalText(4_000),
	visualDescription: optionalText(4_000),
	voiceNotes: optionalText(2_000),
	arcNotes: optionalText(4_000),
});

export const loreSchema = z.object({
	seriesId: z.string().uuid(),
	seasonId: z.string().uuid().optional().or(z.literal('')),
	category: z.enum(['RULE', 'CLUE', 'TIMELINE', 'OBJECT', 'PLACE', 'RELATIONSHIP', 'OTHER']),
	title: requiredText(160),
	fact: requiredText(8_000),
	importance: z.coerce.number().int().min(1).max(5),
	status: z.enum(['ACTIVE', 'SUPERSEDED', 'ARCHIVED']).default('ACTIVE'),
});

export const episodeCreateSchema = z.object({
	seasonId: z.string().uuid(),
	episodeNumber: z.coerce.number().int().min(1).max(99),
	title: requiredText(180),
	durationSeconds: z.coerce.number().int().min(90).max(150),
	isSeasonFinale: z.boolean().default(false),
});

export const episodeEditSchema = z.object({
	episodeId: z.string().uuid(),
	title: requiredText(180),
	logline: optionalText(1_000),
	hook: optionalText(2_000),
	narrative: optionalText(30_000),
	reveal: optionalText(2_000),
	cliffhanger: optionalText(2_000),
	narrationPtBr: optionalText(30_000),
	tiktokCaption: optionalText(2_200),
	instagramCaption: optionalText(2_200),
	coverText: optionalText(300),
	durationSeconds: z.coerce.number().int().min(90).max(150),
	isSeasonFinale: z.boolean().default(false),
});

export const sceneEditSchema = z.object({
	sceneId: z.string().uuid(),
	narrationPtBr: optionalText(2_000),
	visualDescription: optionalText(2_000),
	cameraNotes: optionalText(1_000),
	lightingNotes: optionalText(1_000),
	startFramePromptEn: optionalText(2_000),
	endFramePromptEn: optionalText(2_000),
	motionPromptEn: optionalText(2_000),
	audioNotes: optionalText(1_000),
});

export const choiceEditSchema = z
	.object({
		episodeId: z.string().uuid(),
		option1Label: requiredText(180),
		option1Consequence: requiredText(4_000),
		option2Label: requiredText(180),
		option2Consequence: requiredText(4_000),
	})
	.refine(
		(value) => value.option1Label.toLocaleLowerCase() !== value.option2Label.toLocaleLowerCase(),
		{
			path: ['option2Label'],
			message: 'As duas opções precisam ser diferentes.',
		},
	);

export const pollCreateSchema = z
	.object({
		episodeId: z.string().uuid(),
		externalPostId: optionalText(200),
		openedAt: z.string().datetime({ offset: true }),
		closesAt: z.string().datetime({ offset: true }),
		tieBreakRule: requiredText(500),
		tieBreakOption: z.enum(['1', '2']),
	})
	.refine((value) => new Date(value.closesAt) > new Date(value.openedAt), {
		path: ['closesAt'],
		message: 'O encerramento precisa ocorrer depois da abertura.',
	});

export const pollResultSchema = z.object({
	pollId: z.string().uuid(),
	option1Count: z.coerce.number().int().min(0).max(2_147_483_647),
	option2Count: z.coerce.number().int().min(0).max(2_147_483_647),
	evidenceSource: requiredText(1_000),
	capturedAt: z.string().datetime({ offset: true }),
	verificationNote: optionalText(2_000),
});

export const canonicalDecisionSchema = z.object({
	pollId: z.string().uuid(),
	pollResultId: z.string().uuid(),
	canonSnapshot: z.string().trim().min(2).max(20_000),
	rationale: requiredText(4_000),
	acceptedBy: z.literal('owner'),
});

export type SeriesInput = z.infer<typeof seriesSchema>;
