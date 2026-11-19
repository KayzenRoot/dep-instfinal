import { describe, expect, it } from 'vitest';
import {
	assessColorRange,
	compareColorRange,
	summarizeRgbFrames,
	type ColorStats,
} from './color-quality.js';

function stats(overrides: Partial<ColorStats> = {}): ColorStats {
	return {
		frameCount: 1,
		meanLuma: 120,
		p05Luma: 12,
		p95Luma: 220,
		lowClipPct: 1,
		highClipPct: 1,
		meanSaturation: 30,
		...overrides,
	};
}

describe('color frame statistics', () => {
	it('computes luma percentiles, clipping and saturation from RGB24 frames', () => {
		const buffer = Buffer.from([0, 0, 0, 255, 255, 255, 100, 100, 100, 200, 50, 50]);
		const result = summarizeRgbFrames(buffer, 2, 2);
		expect(result.frameCount).toBe(1);
		expect(result.meanLuma).toBeCloseTo((0 + 255 + 100 + 81.89) / 4, 1);
		expect(result.p05Luma).toBe(0);
		expect(result.p95Luma).toBe(255);
		expect(result.lowClipPct).toBe(25);
		expect(result.highClipPct).toBe(25);
		expect(result.meanSaturation).toBeCloseTo(18.75, 2);
	});

	it('rejects empty or partial frame buffers', () => {
		expect(() => summarizeRgbFrames(Buffer.from([1, 2, 3]), 2, 2)).toThrow();
	});

	it('warns only when clipping is severe at either end', () => {
		expect(assessColorRange(stats()).status).toBe('PASS');
		expect(assessColorRange(stats({ lowClipPct: 22 }))).toMatchObject({
			status: 'WARN',
			severe: true,
		});
		expect(assessColorRange(stats({ highClipPct: 20 }))).toMatchObject({
			status: 'WARN',
			severe: true,
		});
		expect(assessColorRange(stats({ lowClipPct: 19, highClipPct: 19 }))).toMatchObject({
			status: 'WARN',
			severe: true,
		});
	});

	it('flags shadow crush and clipping growth against a before fixture', () => {
		expect(compareColorRange(stats(), stats())).toEqual({
			shadowCrush: false,
			highlightCrush: false,
			lowClipGrowth: 0,
			highClipGrowth: 0,
		});
		expect(compareColorRange(stats({ p05Luma: 20 }), stats({ p05Luma: 1 }))).toMatchObject({
			shadowCrush: true,
		});
		expect(compareColorRange(stats({ p05Luma: 20 }), stats({ p05Luma: 3 }))).toMatchObject({
			shadowCrush: true,
		});
		expect(compareColorRange(stats({ lowClipPct: 2 }), stats({ lowClipPct: 14 }))).toMatchObject({
			lowClipGrowth: 12,
			shadowCrush: false,
		});
		expect(compareColorRange(stats({ p95Luma: 240 }), stats({ p95Luma: 255 }))).toMatchObject({
			highlightCrush: true,
		});
	});
});
