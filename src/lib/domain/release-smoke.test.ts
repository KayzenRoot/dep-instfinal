import { describe, expect, it } from 'vitest';
import { classifyKeyPreflight, classifyTableProbe } from '../../../scripts/release-smoke-lib.mjs';

describe('release smoke schema probe', () => {
	it('rejects an invalid API key instead of treating 401 as a present table', () => {
		expect(classifyKeyPreflight(401, { message: 'Invalid API key' })).toBe('invalid');
		expect(classifyKeyPreflight(401, {})).toBe('invalid');
		expect(classifyTableProbe(401, { message: 'Invalid API key' })).toBe('unknown');
	});

	it('accepts a valid key with RLS denial but only a coded 401/403 as table-present', () => {
		expect(
			classifyKeyPreflight(401, { code: '42501', message: 'permission denied for table series' }),
		).toBe('valid');
		expect(classifyTableProbe(401, { code: '42501' })).toBe('present');
		expect(classifyTableProbe(403, { code: '42501' })).toBe('present');
		expect(classifyTableProbe(401, { message: 'Invalid API key' })).toBe('unknown');
	});

	it('treats only PGRST205/404 as a missing V2 table', () => {
		expect(classifyTableProbe(404, { code: 'PGRST205' })).toBe('missing');
		expect(classifyTableProbe(404, {})).toBe('unknown');
		expect(classifyTableProbe(500, {})).toBe('unknown');
		expect(classifyTableProbe(200, null)).toBe('present');
	});
});
