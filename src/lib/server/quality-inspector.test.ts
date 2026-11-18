import { describe, expect, it } from 'vitest';
import {
	overlapMs,
	parseBlackSegments,
	parseFreezeSegments,
	parsePeakDb,
	parseSilenceSegments,
	qualityThresholds,
} from './quality-inspector.js';

describe('quality inspector log parsing', () => {
	it('parses black segments including an unterminated tail', () => {
		const log = [
			'[Parsed_blackdetect_0 @ 000] black_start:1.5 black_end:3 black_duration:1.5',
			'[Parsed_blackdetect_0 @ 000] black_start:10.25 black_end:12.5 black_duration:2.25',
			'[Parsed_blackdetect_0 @ 000] black_start:118.5',
		].join('\n');
		expect(parseBlackSegments(log, 120_000)).toEqual([
			{ startMs: 1_500, endMs: 3_000 },
			{ startMs: 10_250, endMs: 12_500 },
			{ startMs: 118_500, endMs: 120_000 },
		]);
	});

	it('pairs freeze starts and ends', () => {
		const log = [
			'[Parsed_freezedetect_0 @ 000] freeze_start: 2.5',
			'[Parsed_freezedetect_0 @ 000] freeze_duration: 3.0',
			'[Parsed_freezedetect_0 @ 000] freeze_end: 5.5',
			'[Parsed_freezedetect_0 @ 000] freeze_start: 8',
		].join('\n');
		expect(parseFreezeSegments(log, 10_000)).toEqual([
			{ startMs: 2_500, endMs: 5_500 },
			{ startMs: 8_000, endMs: 10_000 },
		]);
	});

	it('pairs silence starts and ends', () => {
		const log = [
			'[silencedetect @ 000] silence_start: 0',
			'[silencedetect @ 000] silence_end: 4.2 | silence_duration: 4.2',
			'[silencedetect @ 000] silence_start: 90',
		].join('\n');
		expect(parseSilenceSegments(log, 100_000)).toEqual([
			{ startMs: 0, endMs: 4_200 },
			{ startMs: 90_000, endMs: 100_000 },
		]);
	});

	it('reads the final astats peak and ignores -inf', () => {
		expect(parsePeakDb('Peak level dB: -3.4\nPeak level dB: -1.25')).toBe(-1.25);
		expect(parsePeakDb('Peak level dB: -inf')).toBeNull();
		expect(parsePeakDb('no audio stats')).toBeNull();
	});

	it('measures range overlap', () => {
		expect(overlapMs({ startMs: 0, endMs: 1_000 }, { startMs: 500, endMs: 2_000 })).toBe(500);
		expect(overlapMs({ startMs: 0, endMs: 500 }, { startMs: 500, endMs: 1_000 })).toBe(0);
	});

	it('allows documented threshold overrides', () => {
		const thresholds = qualityThresholds({
			QA_BLACK_WARN_MS: '1500',
			QA_FREEZE_BLOCK_MS: '9000',
			QA_PEAK_WARN_DB: '-0.5',
		});
		expect(thresholds.blackWarnMs).toBe(1_500);
		expect(thresholds.freezeBlockMs).toBe(9_000);
		expect(thresholds.peakWarnDb).toBe(-0.5);
		expect(thresholds.blackBlockMs).toBe(5_000);
	});
});
