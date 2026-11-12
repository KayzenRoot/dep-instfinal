import { describe, expect, it } from 'vitest';
import { MAX_EMBEDDED_ZIP_MEDIA_BYTES, exceedsZipMediaBudget } from './export-size.js';

describe('ZIP media payload safeguards', () => {
	it('accepts small private image attachments', () => {
		expect(exceedsZipMediaBudget([235, 235, 144])).toBe(false);
	});
	it('counts duplicate images attached to multiple scene positions', () => {
		expect(exceedsZipMediaBudget([1_800_000, 1_800_000])).toBe(true);
	});
	it('rejects packages exceeding conservative function response budget', () => {
		expect(exceedsZipMediaBudget([MAX_EMBEDDED_ZIP_MEDIA_BYTES, 1])).toBe(true);
	});
	it('rejects unverified frame byte sizes rather than silently producing a broken ZIP', () => {
		expect(exceedsZipMediaBudget([0])).toBe(true);
		expect(exceedsZipMediaBudget([Number.NaN])).toBe(true);
	});
	it('works for a lightweight package with no embedded media', () => {
		expect(exceedsZipMediaBudget([])).toBe(false);
	});
});
