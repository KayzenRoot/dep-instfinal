import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AiGenerationError,
	availableGenerationProvider,
	buildEpisodeGenerationPrompt,
	deploymentOidcToken,
	generateEpisodeJson,
	validateGeneratedEpisode,
} from './ai-episode.js';

const speech = Array.from({ length: 290 }, () => 'palavra').join(' ');
const narrative = {
	title: 'A Última Fita',
	logline: 'Uma câmera registra o amanhã.',
	hook: 'A fita chegou antes do desaparecimento.',
	narrative: speech,
	narrationPtBr: speech,
	reveal: 'A fita contém outra gravação.',
	cliffhanger: 'Quem aparece na porta?',
	durationSeconds: 120,
	speechSpeedWpm: 145,
	screenSuggestion: 'VHS',
	soundSuggestion: 'Estática',
	coverText: 'A Última Fita',
	tiktok: { title: 'Fita 17', cta: 'Escolha 1 ou 2', description: 'O que acontece?' },
	instagram: { title: 'Fita 17', cta: 'Escolha 1 ou 2', description: 'Qual sua escolha?' },
	choices: [
		{ label: 'Abrir a porta', consequence: 'A personagem fica presa do lado de fora.' },
		{ label: 'Descer ao porão', consequence: 'Ela encontra uma fita sobre si.' },
	],
};
const scenes = Array.from({ length: 15 }, (_, i) => ({
	sceneIndex: i + 1,
	narrationPtBr: 'Uma voz descreve o perigo.',
	visualDescription: 'Um corredor vazio e escuro.',
	startFramePromptEn: 'Vertical 9:16 CCTV footage, eerie corridor at night.',
	endFramePromptEn: 'Vertical 9:16 CCTV footage, shadow approaching.',
	motionPromptEn: 'Slow camera dolly forward, VHS static, cinematic suspense.',
}));

describe('pacote de IA do DIF Studio', () => {
	beforeEach(() => {
		vi.stubEnv('VERCEL', '');
		vi.stubEnv('GEMINI_API_KEY', '');
		vi.stubEnv('AI_GATEWAY_API_KEY', '');
		vi.stubEnv('VERCEL_OIDC_TOKEN', '');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});
	it('bloqueia geração sem provedor oficial', async () => {
		expect(availableGenerationProvider()).toBe('manual');
		await expect(generateEpisodeJson('teste')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
	});
	it('aceita OIDC somente dentro de Vercel e não expõe o token para o cliente', () => {
		const request = new Request('https://example.vercel.app/app', {
			headers: { 'x-vercel-oidc-token': 'synthetic-runtime-token' },
		});
		expect(deploymentOidcToken(request)).toBeUndefined();
		vi.stubEnv('VERCEL', '1');
		expect(deploymentOidcToken(request)).toBe('synthetic-runtime-token');
		expect(availableGenerationProvider(deploymentOidcToken(request))).toBe('vercel-gateway');
	});

	it('usa o OIDC da requisição para o AI Gateway sem chave armazenada', async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', mockFetch);
		expect(await generateEpisodeJson('fictional episode', 'synthetic-oidc')).toEqual({ ok: true });
		const args = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(args[0]).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
		expect((args[1].headers as Record<string, string>).authorization).toBe('Bearer synthetic-oidc');
	});

	it('usa um Gemini Flash-Lite disponível para chaves de projetos novos', async () => {
		vi.stubEnv('GEMINI_API_KEY', 'test-only-key');
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
				{ status: 200 },
			),
		);
		vi.stubGlobal('fetch', mockFetch);
		await expect(generateEpisodeJson('test')).resolves.toEqual({ ok: true });
		const args = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(args[0]).toContain('/models/gemini-3.5-flash-lite:generateContent');
	});

	it('valida 15 cenas e duas consequências para 120 segundos', () => {
		const result = validateGeneratedEpisode({ narrative, scenes }, 120000, 8000, false);
		expect(result.scenes).toHaveLength(15);
		expect(result.narrative.choices).toHaveLength(2);
	});
	it('rejeita quantidade incorreta de cenas antes de salvar no banco', () => {
		expect(() =>
			validateGeneratedEpisode({ narrative, scenes: scenes.slice(1) }, 120000, 8000, false),
		).toThrow(AiGenerationError);
	});
	it('aceita final de temporada sem votação própria', () => {
		const result = validateGeneratedEpisode(
			{ narrative: { ...narrative, choices: [] }, scenes },
			120000,
			8000,
			true,
		);
		expect(result.narrative.choices).toEqual([]);
	});
	it('cria prompt 9:16 sem tratar hipóteses como cânone', () => {
		const prompt = buildEpisodeGenerationPrompt(
			{ latestPreviousCanon: { status: 'APPROVED' } },
			120000,
			8000,
		);
		expect(prompt).toContain('15');
		expect(prompt).toContain('9:16');
		expect(prompt).toContain('HYPOTHETICAL_NOT_CANON');
	});
	it('trata limite gratuito 429 sem expor segredo', async () => {
		vi.stubEnv('GEMINI_API_KEY', 'test-only-secret');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
		await expect(generateEpisodeJson('story')).rejects.toMatchObject({ code: 'QUOTA' });
	});
	it('nunca retorna texto cru de erro do provedor', async () => {
		vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only-token');
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('secret-in-error', { status: 500 })),
		);
		await expect(generateEpisodeJson('story')).rejects.toThrow('temporariamente indisponível');
	});
});
