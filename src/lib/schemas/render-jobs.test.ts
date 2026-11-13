import { describe, expect, it } from 'vitest';
import { renderJobEnqueueSchema } from './render-jobs.js';

describe('render job schemas', () => {
	it('accepts a valid enqueue payload with defaults', () => {
		expect(
			renderJobEnqueueSchema.parse({
				episodeId: '11111111-1111-4111-8111-111111111111',
				idempotencyKey: 'ui:render-001',
			}),
		).toEqual({
			episodeId: '11111111-1111-4111-8111-111111111111',
			idempotencyKey: 'ui:render-001',
			priority: 50,
		});
	});

	it('rejects invalid identifiers, keys and priority', () => {
		expect(() =>
			renderJobEnqueueSchema.parse({ episodeId: 'episode', idempotencyKey: 'bad key' }),
		).toThrow();
		expect(() =>
			renderJobEnqueueSchema.parse({
				episodeId: '11111111-1111-4111-8111-111111111111',
				priority: 101,
			}),
		).toThrow();
	});
});
