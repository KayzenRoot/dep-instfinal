import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestDirectorWithGemini, DirectorAiError } from './director-ai.js';
import type { DirectorInput } from '#lib/domain/edit-director.js';
import type { AudioAsset } from '#lib/schemas/audio-library.js';

const scene = {
	id: '22222222-2222-4222-8222-222222222222',
	sceneIndex: 1,
	startMs: 0,
	endMs: 60_000,
	narration: 'Alice abriu a porta e descobriu a verdade.',
	visualDescription: 'Corredor',
	audioNotes: '',
};
const asset: AudioAsset = {
	id: '33333333-3333-4333-8333-333333333333',
	kind: 'SFX',
	title: 'Porta',
	author: 'DIF',
	source: 'fixture',
	licenseName: 'CC0',
	licenseUrl: null,
	attribution: 'DIF CC0',
	commercialAllowed: true,
	socialAllowed: true,
	licenseStatus: 'VERIFIED',
	tags: ['porta'],
	intensity: 4,
	sha256: 'a'.repeat(64),
	byteSize: 1024,
	durationMs: 2_000,
	format: 'wav',
	sampleRate: 48_000,
	channels: 1,
	peakDb: -2,
	truePeakDb: -1,
	lufs: -18,
	createdAt: '2026-11-17T00:00:00.000Z',
};
const input: DirectorInput = {
	episodeId: '11111111-1111-4111-8111-111111111111',
	durationMs: 120_000,
	seed: 7,
	preset: 'reveal',
	suspense: true,
	scenes: [
		scene,
		{
			...scene,
			id: '22222222-2222-4222-8222-222222222223',
			sceneIndex: 2,
			startMs: 60_000,
			endMs: 120_000,
		},
	],
	characters: ['Alice'],
	location: 'Porão',
	audioAssets: [asset],
	choices: [
		{ optionKey: '1', label: 'Abrir' },
		{ optionKey: '2', label: 'Fechar' },
	],
};
const suggestion = {
	points: [
		{ timeMs: 0, tension: 10 },
		{ timeMs: 60_000, tension: 55 },
		{ timeMs: 120_000, tension: 90 },
	],
	markers: [
		{ timeMs: 0, phase: 'HOOK', label: 'Hook', rationale: 'Abre a pergunta.' },
		{ timeMs: 60_000, phase: 'REVEAL', label: 'Revelação', rationale: 'A porta abre.' },
	],
	events: [
		{
			id: '44444444-4444-4444-8444-444444444444',
			type: 'DOOR_CREAK',
			startMs: 58_000,
			durationMs: 900,
			intensity: 4,
			reason: 'Porta range antes da revelação.',
			assetId: asset.id,
			cueId: null,
			status: 'PROPOSED',
		},
	],
	cta: { text: 'Abrir ou fechar?', references: ['Abrir', 'Fechar'] },
};

function response(body: unknown): Response {
	return new Response(
		JSON.stringify({
			candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }],
			usageMetadata: { totalTokenCount: 123 },
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	);
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('optional Gemini director provider', () => {
	it('is offline unless explicitly configured and never calls fetch', async () => {
		vi.stubEnv('GEMINI_API_KEY', '');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(suggestDirectorWithGemini(input)).rejects.toMatchObject({
			code: 'DIRECTOR_AI_NOT_CONFIGURED',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('accepts a strict allowlisted suggestion and reports token use', async () => {
		vi.stubEnv('GEMINI_API_KEY', 'test-key');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(suggestion)));
		const result = await suggestDirectorWithGemini(input);
		expect(result.director.source).toBe('GEMINI');
		expect(result.director.reviewStatus).toBe('DRAFT');
		expect(result.director.acceptedEventIds).toEqual([]);
		expect(result.estimatedTokens).toBe(123);
		expect(result.director.events[0]?.assetId).toBe(asset.id);
	});

	it('rejects invalid JSON, foreign assets and out-of-range timecodes', async () => {
		vi.stubEnv('GEMINI_API_KEY', 'test-key');
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						candidates: [{ content: { parts: [{ text: 'not json' }] } }],
					}),
					{ status: 200 },
				),
			),
		);
		await expect(suggestDirectorWithGemini(input)).rejects.toBeInstanceOf(DirectorAiError);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				response({
					...suggestion,
					events: [
						{
							...suggestion.events[0],
							assetId: '99999999-9999-4999-8999-999999999999',
						},
					],
				}),
			),
		);
		await expect(suggestDirectorWithGemini(input)).rejects.toMatchObject({
			code: 'DIRECTOR_AI_ASSET_FOREIGN',
		});

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				response({
					...suggestion,
					events: [{ ...suggestion.events[0], startMs: 119_500, durationMs: 2_000 }],
				}),
			),
		);
		await expect(suggestDirectorWithGemini(input)).rejects.toBeInstanceOf(DirectorAiError);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				response({
					...suggestion,
					points: [
						{ timeMs: 0, tension: 10 },
						{ timeMs: 150_000, tension: 90 },
					],
				}),
			),
		);
		await expect(suggestDirectorWithGemini(input)).rejects.toMatchObject({
			code: 'DIRECTOR_AI_TIMECODE',
		});

		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					response({ ...suggestion, cta: { text: 'Escolha', references: ['Inventada'] } }),
				),
		);
		await expect(suggestDirectorWithGemini(input)).rejects.toMatchObject({
			code: 'DIRECTOR_AI_CTA_REFERENCE',
		});
	});
});
