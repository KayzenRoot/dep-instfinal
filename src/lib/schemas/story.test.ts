import { describe, expect, it } from 'vitest';
import {
	choiceEditSchema,
	episodeCreateSchema,
	pollResultSchema,
	seriesSchema,
} from '#lib/schemas/story.js';

describe('story input validation', () => {
	it('requires bounded series and episode fields', () => {
		expect(seriesSchema.safeParse({ title: 'O Arquivo 17' }).success).toBe(true);
		expect(seriesSchema.safeParse({ title: '  ' }).success).toBe(false);
		expect(
			episodeCreateSchema.safeParse({
				seasonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				episodeNumber: '1',
				title: 'Piloto',
				durationSeconds: '120',
				isSeasonFinale: false,
			}).success,
		).toBe(true);
		expect(
			episodeCreateSchema.safeParse({
				seasonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				episodeNumber: '1',
				title: 'Piloto',
				durationSeconds: '151',
				isSeasonFinale: false,
			}).success,
		).toBe(false);
	});

	it('rejects identical interactive choices and non-integer vote counts', () => {
		const choices = {
			episodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			option1Label: 'Abrir',
			option1Consequence: 'Vê a sala',
			option2Label: 'abrir',
			option2Consequence: 'Sai do arquivo',
		};
		expect(choiceEditSchema.safeParse(choices).success).toBe(false);
		expect(
			pollResultSchema.safeParse({
				pollId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				option1Count: '1.5',
				option2Count: '0',
				evidenceSource: 'Exportação da enquete',
				capturedAt: new Date().toISOString(),
				verificationNote: '',
			}).success,
		).toBe(false);
	});
});
