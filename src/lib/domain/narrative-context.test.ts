import { describe, expect, it } from 'vitest';
import {
	buildNarrativeContext,
	estimateNarrationDurationSeconds,
	getCanonStatus,
	type NarrativeEpisodeInput,
} from './narrative-context.js';

const priorEpisode: NarrativeEpisodeInput = {
	id: 'episode-one',
	seasonNumber: 1,
	seasonTitle: 'Temporada um',
	episodeNumber: 1,
	title: 'A fita de amanhã',
	status: 'PUBLISHED',
	durationMs: 120_000,
	logline: 'Lara encontra uma fita.',
	hook: 'A fita sabe o nome dela.',
	narrative: 'Lara encontra o sinal no arquivo.',
	reveal: 'A voz é dela.',
	cliffhanger: 'A câmera mostra outra pessoa.',
	narrationPtBr: 'A fita começa a tocar.',
	scenes: [{ scene_index: 1, visual_description: 'Arquivo escuro.' }],
	choices: [
		{ optionKey: '1', label: 'Ouvir a fita', consequence: 'Lara descobre quem enviou o sinal.' },
		{ optionKey: '2', label: 'Destruir a fita', consequence: 'Lara perde a única cópia.' },
	],
	poll: {
		status: 'VERIFIED',
		latestResult: {
			id: 'result-one',
			option1Count: 14,
			option2Count: 9,
			winnerOption: '1',
			verificationStatus: 'VERIFIED',
			evidenceSource: 'Contagem manual conferida.',
		},
		latestDecision: {
			id: 'decision-one',
			pollResultId: 'result-one',
			canonSnapshot: { events: ['Lara ouviu o aviso.'], clue: 'a fita tem uma segunda faixa' },
			rationale: 'A autora aprovou o ramo um.',
		},
	},
};

const input = {
	series: { title: 'O Arquivo', premise: 'Uma fita muda o passado.' },
	seasons: [
		{ season_number: 1, title: 'Temporada um', bible: { rule: 'Fitas não gravam o futuro.' } },
	],
	currentEpisode: {
		id: 'episode-two',
		episodeNumber: 2,
		seasonNumber: 1,
		seasonTitle: 'Temporada um',
		title: 'O aviso continua',
		durationSeconds: 120,
	},
	characters: [{ name: 'Lara', status: 'ACTIVE' }],
	loreFacts: [
		{
			category: 'RULE',
			title: 'Regra da fita',
			fact: 'A fita não pode gravar o futuro.',
			status: 'ACTIVE',
		},
	],
	priorEpisodes: [priorEpisode],
};

describe('narrative continuity context', () => {
	it('keeps a verified latest result and owner-approved snapshot in canon', () => {
		const context = buildNarrativeContext(input);
		expect(context.latestPreviousCanon?.status).toBe('APPROVED');
		expect(context.latestPreviousCanon?.approvedCanon).toMatchObject({
			selectedOption: '1',
			selectedChoice: {
				label: 'Ouvir a fita',
				consequence: 'Lara descobre quem enviou o sinal.',
			},
		});
		expect(context.characters).toContainEqual({ name: 'Lara', status: 'ACTIVE' });
		expect(context.loreFacts).toContainEqual({
			category: 'RULE',
			title: 'Regra da fita',
			fact: 'A fita não pode gravar o futuro.',
			status: 'ACTIVE',
		});
		expect(context.priorEpisodes[0].narrative).toContain('Lara encontra o sinal');
	});

	it('keeps branch previews distinct and marks them as non-canonical', () => {
		const branchOne = buildNarrativeContext(input, '1');
		const branchTwo = buildNarrativeContext(input, '2');
		expect(branchOne.hypotheticalBranch).toMatchObject({
			status: 'HYPOTHETICAL_NOT_CANON',
			isCanon: false,
			selectedOption: '1',
			consequence: 'Lara descobre quem enviou o sinal.',
		});
		expect(branchTwo.hypotheticalBranch).toMatchObject({
			status: 'HYPOTHETICAL_NOT_CANON',
			isCanon: false,
			selectedOption: '2',
			consequence: 'Lara perde a única cópia.',
		});
		expect(JSON.stringify(branchOne)).not.toBe(JSON.stringify(branchTwo));
		expect(branchOne.latestPreviousCanon).toEqual(branchTwo.latestPreviousCanon);
	});

	it('does not reuse a decision tied to an older result when the latest result is pending', () => {
		const pendingEpisode: NarrativeEpisodeInput = {
			...priorEpisode,
			poll: {
				status: 'CLOSED',
				latestResult: {
					id: 'result-two',
					option1Count: 14,
					option2Count: 9,
					winnerOption: null,
					verificationStatus: 'PENDING',
					evidenceSource: 'Aguardando conferência.',
				},
				latestDecision: priorEpisode.poll?.latestDecision ?? null,
			},
		};
		expect(getCanonStatus(pendingEpisode.poll)).toEqual({
			status: 'RESULT_UNVERIFIED',
			approvedCanon: null,
		});
		const context = buildNarrativeContext({ ...input, priorEpisodes: [pendingEpisode] });
		expect(context.latestPreviousCanon?.status).toBe('RESULT_UNVERIFIED');
		expect(context.latestPreviousCanon?.approvedCanon).toBeNull();
	});

	it('estimates the narration from word count and configured speaking speed', () => {
		expect(estimateNarrationDurationSeconds('palavra '.repeat(290), 145)).toBe(120);
	});
});
