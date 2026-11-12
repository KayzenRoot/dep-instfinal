import { describe, expect, it } from 'vitest';
import {
	buildEpisodeGenerationPrompt,
	generateEpisodeJson,
	validateGeneratedEpisode,
} from './ai-episode.js';

// This file is deliberately skipped in GitHub CI and local unit tests.
// A one-time, owner-authorized Vercel Production build enables it with
// RUN_LIVE_AI_TEST=1; the secret is supplied only by Vercel Environment Variables.
// No model responses, secrets, story content or request headers are logged.
describe.skipIf(process.env.RUN_LIVE_AI_TEST !== '1')('real Gemini episode acceptance', () => {
	it(
		'generates a validated 120-second episode with 15 Flow scenes and two branches',
		async () => {
			expect(process.env.GEMINI_API_KEY?.length).toBeGreaterThan(15);
			const context = {
				format: 'dif-studio-canonical-context/v1',
				series: {
					title: 'Fitas do Subsolo',
					premise: 'Um operador de câmeras recebe gravações do futuro numa estação subterrânea fictícia.',
					tone: 'terror analógico, mistério psicológico, mistério progressivo',
				},
				preparedFor: {
					episodeNumber: 1,
					seasonNumber: 1,
					title: 'A câmera zero',
					isSeasonFinale: false,
				},
				characters: [
					{
						name: 'Lia',
						description: 'Operadora de rádio, prudente e observadora, carrega uma lanterna.',
					},
				],
				priorEpisodes: [],
				latestPreviousCanon: null,
			};
			const prompt = buildEpisodeGenerationPrompt(context, 120000, 8000);
			const result = validateGeneratedEpisode(
				await generateEpisodeJson(prompt),
				120000,
				8000,
				false,
			);
			expect(result.scenes).toHaveLength(15);
			expect(result.narrative.choices).toHaveLength(2);
			expect(result.scenes.every((scene) => scene.startFramePromptEn && scene.endFramePromptEn && scene.motionPromptEn)).toBe(true);
			expect(result.narrative.tiktok.title.length).toBeGreaterThan(1);
			expect(result.narrative.instagram.title.length).toBeGreaterThan(1);
		},
		65000,
	);
});
