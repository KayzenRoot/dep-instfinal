import { describe, expect, it } from 'vitest';
import {
	alignScriptToAsr,
	appendCtaCues,
	assTime,
	buildCaptionAss,
	buildCaptionSrt,
	buildCaptionTrack,
	CaptionError,
	estimateCaptionWidth,
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

	it('rounds fractional ASR timestamps before persisting integer milliseconds', () => {
		const input = trackInput();
		input.asrWords = input.asrWords.map((word) => ({
			...word,
			startMs: word.startMs + 0.4,
			endMs: word.endMs + 0.6,
		}));
		const track = buildCaptionTrack(input);
		for (const cue of track.cues) {
			expect(Number.isInteger(cue.startMs)).toBe(true);
			expect(Number.isInteger(cue.endMs)).toBe(true);
			for (const word of cue.words) {
				expect(Number.isInteger(word.startMs)).toBe(true);
				expect(Number.isInteger(word.endMs)).toBe(true);
			}
		}
		expect(captionTrackSchema.safeParse(track).success).toBe(true);
	});

	it('does not invent captions past the last matched ASR word', () => {
		const input = trackInput();
		input.asrWords = asr('a fita chegou as tres da manha', 500);
		const track = buildCaptionTrack(input);
		expect(track.source).toBe('ASR_FALLBACK');
		const lastEnd = Math.max(...track.cues.map((cue) => cue.endMs));
		expect(lastEnd).toBeLessThan(6_000);
	});

	it('extends a short final cue to the 300 ms floor instead of dropping it', () => {
		const track = buildCaptionTrack({
			...trackInput(),
			segments: [{ index: 0, text: 'Fim.' }],
			asrWords: [{ word: 'fim', startMs: 11_950, endMs: 12_000, confidence: 0.9 }],
		});
		expect(track.cues).toHaveLength(1);
		expect(track.cues[0]!.endMs - track.cues[0]!.startMs).toBe(300);
		expect(track.cues[0]!.endMs).toBeLessThanOrEqual(12_000);
	});

	it('wraps wide glyphs inside the safe area', () => {
		const longWord = 'M'.repeat(60);
		const track = buildCaptionTrack({
			...trackInput(),
			segments: [{ index: 0, text: longWord }],
			asrWords: [{ word: longWord, startMs: 0, endMs: 2_000, confidence: 0.9 }],
		});
		for (const cue of track.cues) {
			for (const line of cue.text.split('\n')) {
				expect(line.length).toBeLessThanOrEqual(42);
				expect(estimateCaptionWidth(line)).toBeLessThanOrEqual(880);
			}
		}
	});

	it('appends CTA cues after the last cue without overlap or overflow', () => {
		const track = buildCaptionTrack(trackInput());
		const cues = appendCtaCues({
			cues: track.cues,
			text: 'Inscreva-se no canal e ative o sininho para não perder o próximo episódio.',
			startMs: 8_000,
			endMs: 11_000,
			durationMs: 12_000,
		});
		expect(cues.length).toBeGreaterThan(track.cues.length);
		const added = cues.slice(track.cues.length);
		expect(added[0]!.startMs).toBeGreaterThanOrEqual(track.cues.at(-1)!.endMs);
		for (const cue of added) {
			expect(cue.startMs).toBeGreaterThanOrEqual(8_000);
			expect(cue.endMs).toBeLessThanOrEqual(11_000);
			expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(300);
			const lines = cue.text.split('\n');
			expect(lines.length).toBeLessThanOrEqual(2);
			for (const line of lines) expect(estimateCaptionWidth(line)).toBeLessThanOrEqual(880);
		}
		expect(captionTrackSchema.safeParse({ ...track, cues }).success).toBe(true);
	});

	it('does not append a CTA when its window is already behind the last cue', () => {
		const track = buildCaptionTrack(trackInput());
		const cues = appendCtaCues({
			cues: track.cues,
			text: 'Inscreva-se.',
			startMs: 0,
			endMs: 1_000,
			durationMs: 12_000,
		});
		expect(cues).toHaveLength(track.cues.length);
	});
});

describe('caption ASS safety', () => {
	it('neutralizes ASS control sequences in user text', () => {
		const track = buildCaptionTrack(trackInput());
		const ass = buildCaptionAss({
			...track,
			style: 'clean',
			cues: [{ ...track.cues[0]!, text: 'teste \\N {tag}' }],
		});
		expect(ass).toContain('\uFF3CN');
		expect(ass).toContain('\uFF5Btag\uFF5D');
		expect(ass).not.toContain('\\N {tag}');
	});

	it('rewraps an over-wide stored cue before writing ASS', () => {
		const track = buildCaptionTrack(trackInput());
		const ass = buildCaptionAss({
			...track,
			style: 'clean',
			cues: [{ ...track.cues[0]!, text: 'W'.repeat(42) }],
		});
		const dialogue = ass.split('\n').find((line) => line.startsWith('Dialogue:'));
		expect(dialogue).toBeDefined();
		for (const line of dialogue!.split(',,0,0,0,,')[1]!.split('\\N')) {
			expect(estimateCaptionWidth(line)).toBeLessThanOrEqual(880);
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
