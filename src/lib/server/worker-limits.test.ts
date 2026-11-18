import { describe, expect, it } from 'vitest';
import { assertDiskReserve, clampThreads, freeDiskMb } from '../../../scripts/worker-limits.mjs';

describe('worker operational limits', () => {
	it('reports free disk and accepts a small reserve', async () => {
		const free = await freeDiskMb();
		expect(free).toBeGreaterThan(0);
		await expect(assertDiskReserve({ reserveMb: 1 })).resolves.toBeGreaterThan(0);
	});

	it('pauses before claiming when the reserve cannot be met', async () => {
		await expect(assertDiskReserve({ reserveMb: 10_000_000 })).rejects.toMatchObject({
			code: 'WORKER_DISK_RESERVED',
		});
	});

	it('clamps ffmpeg threads to the supported 1-8 range', () => {
		expect(clampThreads('1')).toBe(1);
		expect(clampThreads('12')).toBe(8);
		expect(clampThreads('not-a-number', 2)).toBe(2);
		expect(clampThreads(undefined, 3)).toBe(3);
	});
});
