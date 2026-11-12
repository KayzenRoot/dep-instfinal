import { describe, expect, it } from 'vitest';
import { buildSceneTimeline, buildSrt, csvCell, formatSrtTime } from '#lib/domain/timeline.js';

describe('episode timeline', () => {
	it('splits 120 seconds into 15 contiguous eight-second scenes', () => {
		const scenes = buildSceneTimeline(120_000);
		expect(scenes).toHaveLength(15);
		expect(scenes[0]).toEqual({ index: 1, startMs: 0, endMs: 8_000 });
		expect(scenes[14]).toEqual({ index: 15, startMs: 112_000, endMs: 120_000 });
		scenes.forEach((scene, index) => {
			expect(scene.index).toBe(index + 1);
			if (index) expect(scene.startMs).toBe(scenes[index - 1].endMs);
		});
	});

	it('keeps a short final scene while covering the whole 90–150 second range', () => {
		expect(buildSceneTimeline(90_000)).toHaveLength(12);
		expect(buildSceneTimeline(90_000).at(-1)?.endMs).toBe(90_000);
		expect(buildSceneTimeline(150_000).at(-1)?.endMs).toBe(150_000);
		expect(() => buildSceneTimeline(89_999)).toThrow(RangeError);
		expect(() => buildSceneTimeline(150_001)).toThrow(RangeError);
	});
});

describe('subtitle and CSV formatting', () => {
	it('formats hours and emits only non-empty narration cues in order', () => {
		expect(formatSrtTime(3_661_007)).toBe('01:01:01,007');
		expect(
			buildSrt([
				{ index: 1, startMs: 0, endMs: 8_000, narrationPtBr: ' A fita chegou. ' },
				{ index: 2, startMs: 8_000, endMs: 16_000, narrationPtBr: ' ' },
				{ index: 3, startMs: 16_000, endMs: 24_000, narrationPtBr: 'A voz responde.' },
			]),
		).toBe(
			'1\n00:00:00,000 --> 00:00:08,000\nA fita chegou.\n\n2\n00:00:16,000 --> 00:00:24,000\nA voz responde.\n',
		);
	});

	it('escapes commas, quotes, and line breaks as UTF-8 CSV fields', () => {
		expect(csvCell('A "fita", chegou\nontem')).toBe('"A ""fita"", chegou\nontem"');
		expect(csvCell(12)).toBe('12');
	});
});
