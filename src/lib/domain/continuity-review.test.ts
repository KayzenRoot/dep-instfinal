import { describe, expect, it } from 'vitest';
import { findContinuityWarnings } from './continuity-review.js';

describe('continuity review hints', () => {
	it('flags a deceased character mentioned in the episode text', () => {
		const warnings = findContinuityWarnings({
			text: 'Lara volta ao corredor como se nada tivesse acontecido.',
			characters: [{ name: 'Lara', status: 'DECEASED' }],
			loreFacts: [],
		});
		expect(warnings).toHaveLength(1);
		expect(warnings[0].code).toBe('CHARACTER_DECEASED:lara');
	});

	it('does not flag active characters or unrelated text', () => {
		const warnings = findContinuityWarnings({
			text: 'O corredor permanece vazio.',
			characters: [{ name: 'Lara', status: 'ACTIVE' }],
			loreFacts: [{ title: 'A fita não mente', status: 'ACTIVE' }],
		});
		expect(warnings).toEqual([]);
	});

	it('flags superseded lore titles and deduplicates repeated names', () => {
		const warnings = findContinuityWarnings({
			text: 'A fita não mente. A fita não mente de novo. Lara escuta.',
			characters: [{ name: 'Lara', status: 'MISSING' }],
			loreFacts: [{ title: 'A fita não mente', status: 'SUPERSEDED' }],
		});
		expect(warnings).toHaveLength(2);
		expect(warnings.map((warning) => warning.code)).toEqual([
			'CHARACTER_MISSING:lara',
			'LORE_SUPERSEDED:a fita não mente',
		]);
	});
});
