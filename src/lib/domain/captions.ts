import { createHash } from 'node:crypto';
import { formatSrtTime } from './timeline.js';
import type { CaptionCue, CaptionStyle, CaptionTrack, CaptionWord } from '#lib/schemas/captions.js';

export class CaptionError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'CaptionError';
	}
}

export interface ScriptSegment {
	index: number;
	text: string;
	sceneId?: string | null;
}

export interface AsrWordInput {
	word: string;
	startMs: number;
	endMs: number;
	confidence?: number | null;
}

interface Token {
	raw: string;
	normalized: string;
	segmentIndex: number;
}

const MAX_LINE_CHARS = 42;
const MAX_LINES = 2;
const MAX_CUE_MS = 7_000;

export function normalizeCaptionToken(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}'-]/gu, '')
		.replace(/^[-']+|[-']+$/g, '');
}

function tokenize(segment: ScriptSegment): Token[] {
	return (segment.text.match(/\S+/gu) ?? [])
		.map((raw) => ({ raw, normalized: normalizeCaptionToken(raw), segmentIndex: segment.index }))
		.filter((token) => token.normalized.length > 0);
}

function similarity(left: string, right: string): number {
	if (left === right) return 1;
	const max = Math.max(left.length, right.length);
	if (!max) return 0;
	let distance = 0;
	for (let index = 0; index < max; index += 1) {
		if (left[index] !== right[index]) distance += 1;
	}
	return 1 - distance / max;
}

interface Match {
	knownIndex: number;
	asrIndex: number;
	score: number;
}

function alignTokens(tokens: Token[], asr: CaptionWord[]): Match[] {
	const n = tokens.length;
	const m = asr.length;
	const scores = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
	const directions = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
	for (let i = 1; i <= n; i += 1) {
		scores[i]![0] = scores[i - 1]![0]! - 2;
		directions[i]![0] = 1;
	}
	for (let j = 1; j <= m; j += 1) {
		scores[0]![j] = scores[0]![j - 1]! - 2;
		directions[0]![j] = 2;
	}
	for (let i = 1; i <= n; i += 1) {
		for (let j = 1; j <= m; j += 1) {
			const known = tokens[i - 1]!;
			const asrWord = asr[j - 1]!;
			const similarityScore = similarity(known.normalized, normalizeCaptionToken(asrWord.text));
			const matchScore = similarityScore === 1 ? 3 : similarityScore >= 0.72 ? 2 : -1;
			const diagonal = scores[i - 1]![j - 1]! + matchScore;
			const up = scores[i - 1]![j]! - 2;
			const left = scores[i]![j - 1]! - 2;
			if (diagonal >= up && diagonal >= left) {
				scores[i]![j] = diagonal;
				directions[i]![j] = 0;
			} else if (up >= left) {
				scores[i]![j] = up;
				directions[i]![j] = 1;
			} else {
				scores[i]![j] = left;
				directions[i]![j] = 2;
			}
		}
	}
	const matches: Match[] = [];
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		const direction = directions[i]![j];
		if (i > 0 && j > 0 && direction === 0) {
			const known = tokens[i - 1]!;
			const asrWord = asr[j - 1]!;
			const similarityScore = similarity(known.normalized, normalizeCaptionToken(asrWord.text));
			if (similarityScore >= 0.72)
				matches.push({
					knownIndex: i - 1,
					asrIndex: j - 1,
					score: similarityScore * (asrWord.confidence ?? 1),
				});
			i -= 1;
			j -= 1;
		} else if (i > 0 && (j === 0 || direction === 1)) {
			i -= 1;
		} else {
			j -= 1;
		}
	}
	return matches.reverse();
}

function interpolatedWords(
	tokens: Token[],
	asr: CaptionWord[],
	matches: Match[],
	durationMs: number,
): { token: Token; word: CaptionWord }[] {
	const byKnown = new Map(matches.map((match) => [match.knownIndex, match]));
	const result: { token: Token; word: CaptionWord }[] = [];
	let cursor = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		const match = byKnown.get(index);
		if (match) {
			const source = asr[match.asrIndex]!;
			const startMs = Math.max(cursor, source.startMs);
			const endMs = Math.max(startMs + 60, source.endMs);
			result.push({
				token,
				word: { ...source, text: token.raw, startMs, endMs },
			});
			cursor = endMs;
			continue;
		}
		let nextMatch: Match | undefined;
		for (let lookahead = index + 1; lookahead < tokens.length; lookahead += 1) {
			nextMatch = byKnown.get(lookahead);
			if (nextMatch) break;
		}
		const nextStart = nextMatch ? asr[nextMatch.asrIndex]!.startMs : durationMs;
		const available = Math.max(100, nextStart - cursor);
		const run = [];
		for (
			let lookahead = index;
			lookahead < tokens.length && !byKnown.has(lookahead);
			lookahead += 1
		)
			run.push(tokens[lookahead]!);
		const totalChars =
			run.reduce((total, candidate) => total + candidate.normalized.length, 0) || 1;
		const slot = available / run.length;
		for (const candidate of run) {
			const length = Math.max(0.4, candidate.normalized.length / totalChars);
			const wordMs = Math.max(120, Math.min(slot, available * length));
			const startMs = Math.min(cursor, durationMs - 120);
			const endMs = Math.min(durationMs, Math.max(startMs + 120, startMs + wordMs));
			result.push({
				token: candidate,
				word: {
					text: candidate.raw,
					startMs,
					endMs,
					confidence: null,
				},
			});
			cursor = endMs;
		}
		index += run.length - 1;
	}
	return result;
}

function wrapLines(words: CaptionWord[]): string[][] {
	const lines: string[][] = [];
	let current: string[] = [];
	let length = 0;
	for (const word of words) {
		const pieces = word.text.match(new RegExp(`.{1,${MAX_LINE_CHARS}}`, 'gu')) ?? [word.text];
		for (const piece of pieces) {
			const addition = current.length ? 1 + piece.length : piece.length;
			if (current.length && length + addition > MAX_LINE_CHARS) {
				lines.push(current);
				current = [piece];
				length = piece.length;
			} else {
				current.push(piece);
				length += addition;
			}
		}
	}
	if (current.length) lines.push(current);
	return lines;
}

function splitIntoCaptionCues(words: CaptionWord[], nextStartMs: number): CaptionCue[] {
	const lines = wrapLines(words);
	const chunks: string[][][] = [];
	let chunk: string[][] = [];
	for (const line of lines) {
		if (chunk.length >= MAX_LINES) {
			chunks.push(chunk);
			chunk = [];
		}
		chunk.push(line);
	}
	if (chunk.length) chunks.push(chunk);
	if (chunks.length <= 1) {
		const startMs = words[0]!.startMs;
		const endMs = Math.min(nextStartMs, Math.max(words.at(-1)!.endMs, startMs + 300));
		return [
			{
				id: crypto.randomUUID(),
				startMs,
				endMs,
				text: chunks[0]?.map((line) => line.join(' ')).join('\n') ?? '',
				words,
			},
		];
	}
	const perChunk = Math.ceil(words.length / chunks.length);
	const result: CaptionCue[] = [];
	for (let index = 0; index < chunks.length; index += 1) {
		const chunkWords = words.slice(index * perChunk, (index + 1) * perChunk);
		if (!chunkWords.length) continue;
		const previous = result.at(-1);
		const startMs = Math.max(previous?.endMs ?? 0, chunkWords[0]!.startMs);
		const endMs = Math.max(startMs + 300, chunkWords.at(-1)!.endMs);
		result.push({
			id: crypto.randomUUID(),
			startMs,
			endMs,
			text: chunks[index]!.map((line) => line.join(' ')).join('\n'),
			words: chunkWords,
		});
	}
	return result;
}

export function alignScriptToAsr(input: {
	segments: ScriptSegment[];
	asrWords: AsrWordInput[];
	durationMs: number;
}): {
	cues: CaptionCue[];
	alignmentScore: number;
	source: 'FORCED_ALIGNMENT' | 'ASR_FALLBACK';
	scriptSha256: string;
} {
	if (!Number.isInteger(input.durationMs) || input.durationMs <= 0)
		throw new CaptionError('CAPTION_DURATION_INVALID', 'Duração do episódio inválida.');
	if (!input.segments.length)
		throw new CaptionError('CAPTION_SCRIPT_EMPTY', 'O roteiro não tem texto para legendar.');
	const asr: CaptionWord[] = input.asrWords
		.map((word) => ({
			text: word.word.trim(),
			startMs: Math.max(0, Math.min(input.durationMs, Math.round(word.startMs))),
			endMs: Math.max(0, Math.min(input.durationMs, Math.round(word.endMs))),
			confidence: word.confidence ?? null,
		}))
		.filter((word) => word.text && word.endMs > word.startMs);
	if (!asr.length)
		throw new CaptionError('CAPTION_ASR_EMPTY', 'A transcrição não tem palavras utilizáveis.');
	const tokens = input.segments.flatMap(tokenize);
	if (!tokens.length)
		throw new CaptionError('CAPTION_SCRIPT_EMPTY', 'O roteiro não tem texto para legendar.');
	const matches = alignTokens(tokens, asr);
	if (matches.length / tokens.length < 0.2)
		throw new CaptionError(
			'CAPTION_ALIGNMENT_FAILED',
			'O alinhamento não encontrou texto suficiente; revise manualmente.',
		);
	const matchedScore = matches.reduce((total, match) => total + match.score, 0);
	const alignmentScore =
		Math.min(1, matches.length / tokens.length) * (matchedScore / (matches.length || 1));
	const words = interpolatedWords(tokens, asr, matches, input.durationMs);
	const bySegment = new Map<number, CaptionWord[]>();
	for (const entry of words) {
		const list = bySegment.get(entry.token.segmentIndex) ?? [];
		list.push(entry.word);
		bySegment.set(entry.token.segmentIndex, list);
	}
	const cues: CaptionCue[] = [];
	for (const segment of [...input.segments].sort((left, right) => left.index - right.index)) {
		const segmentWords = bySegment.get(segment.index) ?? [];
		if (!segmentWords.length) continue;
		const nextStart =
			[...bySegment.entries()]
				.filter(([index]) => index > segment.index)
				.map(([, list]) => list[0]!.startMs)
				.sort((left, right) => left - right)[0] ?? input.durationMs;
		for (const cue of splitIntoCaptionCues(segmentWords, nextStart)) {
			const previous = cues.at(-1);
			if (previous && cue.startMs < previous.endMs) cue.startMs = previous.endMs;
			if (cue.endMs - cue.startMs > MAX_CUE_MS) cue.endMs = cue.startMs + MAX_CUE_MS;
			if (cue.endMs > input.durationMs) cue.endMs = input.durationMs;
			if (cue.endMs - cue.startMs >= 300 && cue.text.trim()) cues.push(cue);
		}
	}
	if (!cues.length)
		throw new CaptionError('CAPTION_ALIGNMENT_EMPTY', 'Nenhuma legenda alinhada foi gerada.');
	const scriptText = input.segments.map((segment) => segment.text).join(' ');
	const scriptSha256 = createHash('sha256').update(scriptText).digest('hex');
	return {
		cues,
		alignmentScore: Number.isFinite(alignmentScore) ? alignmentScore : 0,
		source: matches.length / tokens.length >= 0.5 ? 'FORCED_ALIGNMENT' : 'ASR_FALLBACK',
		scriptSha256,
	};
}

export function buildCaptionTrack(input: {
	episodeId: string;
	planId: string;
	planVersion: number;
	narrationTakeId: string | null;
	durationMs: number;
	segments: ScriptSegment[];
	asrWords: AsrWordInput[];
	style?: CaptionStyle;
	safeZone?: CaptionTrack['safeZone'];
	audioSha256?: string | null;
}): CaptionTrack {
	const aligned = alignScriptToAsr({
		segments: input.segments,
		asrWords: input.asrWords,
		durationMs: input.durationMs,
	});
	return {
		schemaVersion: 1,
		episodeId: input.episodeId,
		planId: input.planId,
		planVersion: input.planVersion,
		narrationTakeId: input.narrationTakeId,
		style: input.style ?? 'clean',
		safeZone: input.safeZone ?? 'tiktok',
		source: aligned.source,
		scriptSha256: aligned.scriptSha256,
		audioSha256: input.audioSha256 ?? null,
		alignmentScore: aligned.alignmentScore,
		cues: aligned.cues,
	};
}

export function buildCaptionSrt(cues: CaptionCue[]): string {
	let index = 0;
	return (
		cues
			.map((cue) => {
				index += 1;
				return `${index}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text.trim()}`;
			})
			.join('\n\n') + (index ? '\n' : '')
	);
}

export function assTime(milliseconds: number): string {
	const value = Math.max(0, Math.floor(milliseconds));
	const hours = Math.floor(value / 3_600_000);
	const minutes = Math.floor((value % 3_600_000) / 60_000);
	const seconds = Math.floor((value % 60_000) / 1_000);
	const centiseconds = Math.floor((value % 1_000) / 10);
	return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssLine(line: string): string {
	return line.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
}

function assStyle(style: CaptionStyle, safeZone: CaptionTrack['safeZone']): string {
	const marginV = safeZone === 'stories' ? 280 : safeZone === 'feed' ? 140 : 220;
	if (style === 'vhs')
		return `Style: Default,Courier New,54,&H00E8F0FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,${marginV},1`;
	if (style === 'highlight')
		return `Style: Default,DejaVu Sans,58,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,90,90,${marginV},1`;
	return `Style: Default,DejaVu Sans,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,90,90,${marginV},1`;
}

export function buildCaptionAss(track: CaptionTrack): string {
	const lines = [
		'[Script Info]',
		'ScriptType: v4.00+',
		'PlayResX: 1080',
		'PlayResY: 1920',
		'WrapStyle: 2',
		'ScaledBorderAndShadow: yes',
		'',
		'[V4+ Styles]',
		'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
		assStyle(track.style, track.safeZone),
		'',
		'[Events]',
		'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
	];
	for (const cue of track.cues) {
		const cueLines = cue.text.split('\n');
		let text = cueLines.map(escapeAssLine).join('\\N');
		if (track.style === 'highlight') {
			const [first, ...rest] = text.split('\\N');
			text = `{\\c&H0000FFFF&\\b1}${first}{\\r}${rest.length ? `\\N${rest.join('\\N')}` : ''}`;
		}
		lines.push(`Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Default,,0,0,0,,${text}`);
	}
	return `${lines.join('\n')}\n`;
}
