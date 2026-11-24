import { describe, expect, it } from 'vitest';
import { trimEdgeCharacters } from './trim-edge.js';

describe('trimEdgeCharacters', () => {
	it('removes only selected edge characters', () => {
		expect(trimEdgeCharacters("--'Olá-'--", "-'")).toBe('Olá');
		expect(trimEdgeCharacters('---título---', '-')).toBe('título');
		expect(trimEdgeCharacters('--', '-')).toBe('');
		expect(trimEdgeCharacters('', '-')).toBe('');
	});

	it('preserves interior punctuation and unrelated edge characters', () => {
		expect(trimEdgeCharacters('a--b', '-')).toBe('a--b');
		expect(trimEdgeCharacters('a--b!', '-')).toBe('a--b!');
	});

	it('does not backtrack on long trailing runs that cannot be stripped', () => {
		const text = `a${'-'.repeat(200_000)}!`;
		expect(trimEdgeCharacters(text, '-')).toBe(text);
	});
});
