import { describe, expect, it } from 'vitest';
import { HELP_CATALOG, HELP_KEYS, getHelpEntry } from './help-catalog';

describe('help catalog', () => {
	it('covers the integrated dashboard and shell concepts', () => {
		expect(HELP_KEYS).toEqual([
			'privateStudio',
			'dashboardSeries',
			'dashboardEpisodes',
			'openPolls',
			'mediaAssets',
			'seriesTitle',
			'seriesPremise',
			'seriesSubgenre',
			'seriesTone',
			'seriesAudience',
		]);
	});

	it('has unique, non-empty pt-BR entries with real constraints', () => {
		const titles = new Set<string>();
		for (const key of HELP_KEYS) {
			const entry = getHelpEntry(key);
			expect(entry.title.trim().length).toBeGreaterThan(2);
			expect(entry.description.trim().length).toBeGreaterThan(20);
			expect(titles.has(entry.title)).toBe(false);
			titles.add(entry.title);
			if (entry.steps) {
				expect(entry.steps.length).toBeGreaterThan(0);
				for (const step of entry.steps) expect(step.trim().length).toBeGreaterThan(4);
			}
		}
	});

	it('does not promise providers, social posting or fabricated metrics', () => {
		const serialized = JSON.stringify(HELP_CATALOG).toLowerCase();
		for (const forbidden of [
			'google',
			'slack',
			'google drive',
			'oauth',
			'2fa',
			'viraliz',
			'postagem automática',
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it('keeps canon and poll decisions explicitly manual', () => {
		expect(getHelpEntry('openPolls').constraint).toContain(
			'nunca é aplicado ao cânone automaticamente',
		);
		expect(getHelpEntry('seriesPremise').constraint).toContain('decisão explícita');
	});
});
