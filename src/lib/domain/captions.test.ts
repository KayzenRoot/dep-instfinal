import { describe, expect, it } from 'vitest';
import {
	alignScriptToAsr,
	assTime,
	buildCaptionAss,
	buildCaptionSrt,
	buildCaptionTrack,
	CaptionError,
	normalizeCaptionToken,
} from './captions.js';
import { captionTrackSchema } from '#lib/schemas/captions.js';

const words = [
	'A fita chegou às três da manhã.',
	'Alice ouviu a própria voz.',
	'Então a porta abriu.',
];

function asr(text: string, startMs: number, step = 320) {
	return text.split(/\s+/).map((word, index) => ({
		word,
		startMs: startMs + index * step,
		endMs: startMs + index * step + step - 40,
		confidence: 0.95,
	}));
}

function trackInput() {
	return {
		episodeId: '11111111-1111-4111-8111-111111111111',
		planId: '22222222-2222-4222-8222-222222222222',
		planVersion: 1,
		narrationTakeId: '33333333-3333-4333-8333-333333333333',
		durationMs: 12_000,
		segments: words.map((text, index) => ({ index, text })),
		asrWords: [
			...asr('a fita chegou as tres da manha', 500),
			...asr('alice ouviu a propria voz', 3_000),
			...asr('entao a porta abriu', 6_000),
		],
	};
}

describe('caption normalization and alignment', () => {
	it('normalizes accents and punctuation without changing the source tokens', () => {
		expect(normalizeCaptionToken('Às')).toBe('as');
		expect(normalizeCaptionToken('coração,')).toBe('coracao');
		expect(normalizeCaptionToken('—')).toBe('');
		const track = buildCaptionTrack(trackInput());
		expect(track.cues).toHaveLength(3);
		expect(track.cues[0]?.text).toBe('A fita chegou às três da manhã.');
		expect(track.cues[1]?.text).toBe('Alice ouviu a própria voz.');
		expect(track.cues[2]?.text).toBe('Então a porta abriu.');
		expect(track.source).toBe('FORCED_ALIGNMENT');
		expect(track.alignmentScore).toBeGreaterThan(0.8);
	});

	it('drops hallucinated ASR words and keeps timing monotonic', () => {
		const input = trackInput();
		input.asrWords = [
			{ word: 'ruido', startMs: 100, endMs: 400, confidence: 0.1 },
			...input.asrWords,
			{ word: 'inventado', startMs: 8_000, endMs: 8_300, confidence: 0.1 },
		];
		const track = buildCaptionTrack(input);
		expect(track.cues.map((cue) => cue.text).join(' ')).not.toContain('inventado');
		let previousEnd = 0;
		for (const cue of track.cues) {
			expect(cue.startMs).toBeGreaterThanOrEqual(previousEnd);
			expect(cue.endMs).toBeGreaterThan(cue.startMs);
			previousEnd = cue.endMs;
		}
	});

	it('fails closed when ASR is empty or unrelated', () => {
		expect(() => alignScriptToAsr({ ...trackInput(), asrWords: [] })).toThrow(CaptionError);
		expect(() =>
			alignScriptToAsr({
				...trackInput(),
				asrWords: asr('texto completamente diferente sem relacao', 0),
			}),
		).toThrow('O alinhamento não encontrou texto suficiente');
	});

	it('splits long narration into readable two-line cues', () => {
		const longText = Array.from({ length: 40 }, (_, index) => `palavra${index}`).join(' ');
		const input = {
			...trackInput(),
			segments: [{ index: 0, text: longText }],
			asrWords: asr(longText, 0, 200),
			durationMs: 12_000,
		};
		const track = buildCaptionTrack(input);
		expect(track.cues.length).toBeGreaterThan(1);
		for (const cue of track.cues) {
			const lines = cue.text.split('\n');
			expect(lines.length).toBeLessThanOrEqual(2);
			for (const line of lines) expect(line.length).toBeLessThanOrEqual(42);
		}
	});
});

describe('caption exporters', () => {
	const track = buildCaptionTrack({ ...trackInput(), style: 'clean' });

	it('builds parseable SRT with monotonic timestamps', () => {
		const srt = buildCaptionSrt(track.cues);
		expect(srt).toContain('00:00:00,500 --> ');
		expect(srt).toContain('Alice ouviu a própria voz.');
		expect(srt.trim().split('\n\n')).toHaveLength(3);
	});

	it('builds valid ASS with safe margins and style-specific text', () => {
		const clean = buildCaptionAss(track);
		expect(clean).toContain('PlayResX: 1080');
		expect(clean).toContain('PlayResY: 1920');
		expect(clean).toContain(',2,90,90,220,1');
		expect(clean).toContain('Dialogue: 0,0:00:00.50,');
		const vhs = buildCaptionAss({ ...track, style: 'vhs', safeZone: 'stories' });
		expect(vhs).toContain('Courier New');
		expect(vhs).toContain(',2,90,90,280,1');
		const highlight = buildCaptionAss({ ...track, style: 'highlight' });
		expect(highlight).toContain('{\\c&H0000FFFF&\\b1}');
		expect(assTime(3_661_230)).toBe('1:01:01.23');
	});

	it('rejects overlapping cues and overlong lines in the schema', () => {
		const cue = track.cues[0]!;
		expect(
			captionTrackSchema.safeParse({
				...track,
				cues: [cue, { ...track.cues[1]!, startMs: cue.startMs }],
			}).success,
		).toBe(false);
	});
});
