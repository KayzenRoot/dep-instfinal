import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, clearRateLimitsForTests, resetRateLimit } from '#lib/server/rate-limit.js';

describe('login request throttling', () => {
	beforeEach(() => clearRateLimitsForTests());

	it('blocks after the configured number of attempts and resets after success', () => {
		for (let attempt = 0; attempt < 3; attempt += 1)
			expect(checkRateLimit('login:test', 3, 60_000, 1_000).allowed).toBe(true);
		expect(checkRateLimit('login:test', 3, 60_000, 1_000)).toMatchObject({
			allowed: false,
			remaining: 0,
			retryAfterSeconds: 60,
		});
		resetRateLimit('login:test');
		expect(checkRateLimit('login:test', 3, 60_000, 1_000).allowed).toBe(true);
	});

	it('expires a bucket at its window boundary', () => {
		checkRateLimit('recover:test', 1, 10_000, 10_000);
		expect(checkRateLimit('recover:test', 1, 10_000, 19_999).allowed).toBe(false);
		expect(checkRateLimit('recover:test', 1, 10_000, 20_000).allowed).toBe(true);
	});
});
