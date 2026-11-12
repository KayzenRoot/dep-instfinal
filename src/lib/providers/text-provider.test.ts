import { describe, expect, it } from 'vitest';
import { createTextProvider, episodeOutlineSchema } from '#lib/providers/text-provider.js';

describe('manual text provider fallback', () => {
	it('is honest when generation credentials are absent', async () => {
		const provider = createTextProvider();
		expect(provider.name).toBe('manual');
		expect(await provider.status()).toBe('NOT_CONFIGURED');
		await expect(
			provider.generateOutline({ premise: 'A fita fala.', episodeNumber: 1, tone: 'mistério' }),
		).rejects.toThrow(/not configured/i);
	});

	it('accepts only a structured two-choice outline', () => {
		const valid = {
			logline: 'Uma fita contém a voz de amanhã.',
			hook: 'A voz chama Lara pelo nome.',
			reveal: 'A fita foi gravada no arquivo.',
			cliffhanger: 'A porta tranca sozinha.',
			choices: [
				{ label: 'Abrir', consequence: 'Lara encontra o registro.' },
				{ label: 'Destruir', consequence: 'O arquivo perde a cópia.' },
			],
		};
		expect(episodeOutlineSchema.safeParse(valid).success).toBe(true);
		expect(
			episodeOutlineSchema.safeParse({ ...valid, choices: valid.choices.slice(0, 1) }).success,
		).toBe(false);
	});
});
