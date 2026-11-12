import { describe, expect, it } from 'vitest';
import {
	choiceEditSchema,
	episodeCreateSchema,
	pollResultSchema,
	narrativeResponseSchema,
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

	it('validates complete manual narrative responses and speech duration estimates', () => {
		const response = {
			title: 'O aviso continua',
			logline: 'Lara encontra uma segunda faixa na fita.',
			hook: 'A gravação começa antes de ser ligada.',
			narrative: 'Lara segue o ruído até a sala de cópias.',
			narrationPtBr: 'palavra '.repeat(290),
			reveal: 'A segunda voz pertence à arquivista desaparecida.',
			cliffhanger: 'O telefone toca dentro da fita lacrada.',
			durationSeconds: 120,
			speechSpeedWpm: 145,
			screenSuggestion: 'Close no carretel parado.',
			soundSuggestion: 'Ruído de fita reverso.',
			coverText: 'A segunda voz',
			tiktok: {
				title: 'A segunda voz',
				cta: 'Escolha o próximo passo.',
				description: 'A fita respondeu.',
			},
			instagram: {
				title: 'O arquivo respondeu',
				cta: 'Vote no próximo passo.',
				description: 'A fita respondeu.',
			},
			choices: [
				{ label: 'Abrir a segunda faixa', consequence: 'Lara reconhece a voz da arquivista.' },
				{ label: 'Lacrar o gravador', consequence: 'A gravação muda de sala sem ser tocada.' },
			],
		};
		expect(narrativeResponseSchema.safeParse(response).success).toBe(true);
		expect(narrativeResponseSchema.safeParse({ ...response, choices: [] }).success).toBe(true);
		expect(
			narrativeResponseSchema.safeParse({
				...response,
				choices: [
					response.choices[0],
					{ ...response.choices[1], consequence: response.choices[0].consequence },
				],
			}).success,
		).toBe(false);
		expect(narrativeResponseSchema.safeParse({ ...response, durationSeconds: 150 }).success).toBe(
			false,
		);
		expect(
			narrativeResponseSchema.safeParse({ ...response, choices: [response.choices[0]] }).success,
		).toBe(false);
	});
});
