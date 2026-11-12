import { createHmac, randomBytes } from 'node:crypto';

interface Entry {
	count: number;
	resetAt: number;
}

const keyMaterial = randomBytes(32);
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 10_000;

function hashedKey(key: string): string {
	return createHmac('sha256', keyMaterial).update(key).digest('hex');
}

function pruneExpired(now: number): void {
	for (const [key, entry] of entries) {
		if (entry.resetAt <= now) entries.delete(key);
	}
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfterSeconds: number;
}

/** Process-local throttle; production deployments with multiple instances also need edge limits. */
export function checkRateLimit(
	key: string,
	limit: number,
	windowMs: number,
	now = Date.now(),
): RateLimitResult {
	if (entries.size >= MAX_ENTRIES) pruneExpired(now);
	const bucket = hashedKey(key);
	const entry = entries.get(bucket);

	if (!entry || entry.resetAt <= now) {
		if (entries.size >= MAX_ENTRIES) {
			return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
		}
		entries.set(bucket, { count: 1, resetAt: now + windowMs });
		return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
	}

	if (entry.count >= limit) {
		return {
			allowed: false,
			remaining: 0,
			retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
		};
	}

	entry.count += 1;
	return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string): void {
	entries.delete(hashedKey(key));
}

export function clearRateLimitsForTests(): void {
	entries.clear();
}
