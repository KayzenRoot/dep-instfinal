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
const CAPTION_FONT_SIZE = 58;
const CAPTION_SAFE_WIDTH = 880;

function isEmoji(code: number): boolean {
	return (
		(code >= 0x1f300 && code <= 0x1faff) ||
		(code >= 0x2600 && code <= 0x27bf) ||
		(code >= 0x1f000 && code <= 0x1f2ff)
	);
}

function isWide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x20000 && code <= 0x3fffd)
	);
}

function characterWidth(character: string): number {
	const code = character.codePointAt(0) ?? 0;
	if (code === 0xfe0f || code === 0x200d) return 0;
	if (isEmoji(code)) return 1.1;
	if (isWide(code)) return 1;
	if (/\s/u.test(character)) return 0.32;
	if (/[ilI.,'!|:;]/u.test(character)) return 0.28;
	if (/[fjrt()\-[\]]/u.test(character)) return 0.36;
	if (/[MW@%&ÆŒ]/u.test(character)) return 0.92;
	if (/[A-ZÀ-Ý]/u.test(character)) return 0.68;
	if (/\d/u.test(character)) return 0.6;
	return 0.55;
}

export function estimateCaptionWidth(text: string, fontSize = CAPTION_FONT_SIZE): number {
	let width = 0;
	for (const character of text) width += characterWidth(character);
	return width * fontSize;
}

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
	const lastMatchedEnd = matches.length
		? Math.round(asr[matches[matches.length - 1]!.asrIndex]!.endMs)
		: 0;
	let cursor = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		const match = byKnown.get(index);
		if (match) {
			const source = asr[match.asrIndex]!;
			const startMs = Math.max(cursor, Math.round(source.startMs));
			const endMs = Math.min(durationMs, Math.max(startMs, Math.round(source.endMs)));
			if (endMs > startMs) {
				result.push({
					token,
					word: { ...source, text: token.raw, startMs, endMs },
				});
				cursor = endMs;
			}
			continue;
		}
		let nextMatch: Match | undefined;
		for (let lookahead = index + 1; lookahead < tokens.length; lookahead += 1) {
			nextMatch = byKnown.get(lookahead);
			if (nextMatch) break;
		}
		const nextStart = nextMatch
			? Math.max(cursor, Math.round(asr[nextMatch.asrIndex]!.startMs))
			: Math.min(durationMs, Math.max(cursor, lastMatchedEnd + 1_500));
		const available = Math.max(0, nextStart - cursor);
		const run = [];
		for (
			let lookahead = index;
			lookahead < tokens.length && !byKnown.has(lookahead);
			lookahead += 1
		)
			run.push(tokens[lookahead]!);
		const slot = Math.max(1, Math.floor(available / run.length));
		for (const candidate of run) {
			const startMs = cursor;
			const endMs = Math.min(nextStart, startMs + slot);
			if (endMs <= startMs) break;
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

function splitWordToWidth(word: string, maxWidth: number, maxChars = MAX_LINE_CHARS): string[] {
	const pieces: string[] = [];
	let current = '';
	for (const character of word) {
		const next = `${current}${character}`;
		if (current && (estimateCaptionWidth(next) > maxWidth || current.length >= maxChars)) {
			pieces.push(current);
			current = character;
		} else {
			current = next;
		}
	}
	if (current) pieces.push(current);
	return pieces.length ? pieces : [word];
}

function wrapLines(words: CaptionWord[]): string[][] {
	const lines: string[][] = [];
	let current: string[] = [];
	let length = 0;
	let width = 0;
	for (const word of words) {
		const pieces = splitWordToWidth(word.text, CAPTION_SAFE_WIDTH);
		for (const piece of pieces) {
			const pieceWidth = estimateCaptionWidth(piece);
			const addition = current.length ? 1 + piece.length : piece.length;
			const widthAddition = current.length
				? width + estimateCaptionWidth(' ') + pieceWidth
				: pieceWidth;
			if (
				current.length &&
				(length + addition > MAX_LINE_CHARS || widthAddition > CAPTION_SAFE_WIDTH)
			) {
				lines.push(current);
				current = [piece];
				length = piece.length;
				width = pieceWidth;
			} else {
				current.push(piece);
				length += addition;
				width = widthAddition;
			}
		}
	}
	if (current.length) lines.push(current);
	return lines;
}

function clampCueWords(cue: CaptionCue): CaptionCue {
	const words: CaptionWord[] = [];
	let previousEnd = cue.startMs;
	for (const word of cue.words) {
		const startMs = Math.max(previousEnd, cue.startMs, Math.min(word.startMs, cue.endMs - 1));
		if (startMs >= cue.endMs) break;
		const endMs = Math.min(cue.endMs, Math.max(startMs + 1, word.endMs));
		if (endMs <= startMs) break;
		words.push({ ...word, text: word.text.slice(0, 80), startMs, endMs });
		previousEnd = endMs;
	}
	cue.words = words;
	return cue;
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
			clampCueWords({
				id: crypto.randomUUID(),
				startMs,
				endMs,
				text: chunks[0]?.map((line) => line.join(' ')).join('\n') ?? '',
				words,
			}),
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
		result.push(
			clampCueWords({
				id: crypto.randomUUID(),
				startMs,
				endMs,
				text: chunks[index]!.map((line) => line.join(' ')).join('\n'),
				words: chunkWords,
			}),
		);
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
	const coverage = matches.length / tokens.length;
	const lastMatchedEnd = matches.length
		? Math.round(asr[matches[matches.length - 1]!.asrIndex]!.endMs)
		: 0;
	const forced =
		coverage >= 0.8 && (lastMatchedEnd === 0 || lastMatchedEnd >= input.durationMs * 0.4);
	const lastMatchedKnown = matches.reduce(
		(maximum, match) => Math.max(maximum, match.knownIndex),
		-1,
	);
	const hasUnmatchedTail = lastMatchedKnown < tokens.length - 1;
	const words = interpolatedWords(tokens, asr, matches, input.durationMs);
	const bySegment = new Map<number, CaptionWord[]>();
	for (const entry of words) {
		const list = bySegment.get(entry.token.segmentIndex) ?? [];
		list.push(entry.word);
		bySegment.set(entry.token.segmentIndex, list);
	}
	const cues: CaptionCue[] = [];
	let incomplete = false;
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
			if (cue.endMs - cue.startMs < 300) {
				const desiredStart = Math.max(0, cue.endMs - 300);
				if (!previous) {
					cue.startMs = desiredStart;
				} else if (desiredStart >= previous.endMs) {
					cue.startMs = desiredStart;
				} else if (desiredStart - previous.startMs >= 300) {
					previous.endMs = desiredStart;
					clampCueWords(previous);
					cue.startMs = desiredStart;
				} else {
					const mergedLines = wrapCueLine(`${previous.text} ${cue.text}`);
					if (mergedLines.length <= MAX_LINES && cue.endMs - previous.startMs <= MAX_CUE_MS) {
						previous.text = mergedLines.join('\n');
						previous.endMs = cue.endMs;
						previous.words = [...previous.words, ...cue.words];
						clampCueWords(previous);
					} else {
						incomplete = true;
					}
					continue;
				}
			}
			if (cue.endMs - cue.startMs >= 300 && cue.text.trim()) {
				clampCueWords(cue);
				cues.push(cue);
			}
		}
	}
	if ((!forced || incomplete || hasUnmatchedTail) && cues.length) {
		const beforeCount = cues.length;
		const beforeEnd = cues.at(-1)?.endMs ?? 0;
		const cap = Math.min(input.durationMs, lastMatchedEnd + 1_500);
		const kept = cues.filter((cue) => cue.startMs < cap);
		const last = kept.at(-1);
		if (last) {
			last.endMs = Math.min(last.endMs, cap);
			if (last.endMs - last.startMs < 300) {
				kept.pop();
				incomplete = true;
			} else clampCueWords(last);
		}
		if (kept.length !== beforeCount || (last && last.endMs < beforeEnd)) incomplete = true;
		cues.splice(0, cues.length, ...kept);
	}
	if (!cues.length)
		throw new CaptionError('CAPTION_ALIGNMENT_EMPTY', 'Nenhuma legenda alinhada foi gerada.');
	const scriptText = input.segments.map((segment) => segment.text).join(' ');
	const scriptSha256 = createHash('sha256').update(scriptText).digest('hex');
	return {
		cues,
		alignmentScore: Number.isFinite(alignmentScore) ? alignmentScore : 0,
		source: forced && !incomplete ? 'FORCED_ALIGNMENT' : 'ASR_FALLBACK',
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
				const text = cue.text.replace(/\p{Cc}/gu, '').trim();
				return `${index}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${text}`;
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
	return line
		.replace(/\p{Cc}/gu, '')
		.replace(/\\/gu, '\uFF3C')
		.replace(/\{/gu, '\uFF5B')
		.replace(/\}/gu, '\uFF5D');
}

function assStyle(style: CaptionStyle, safeZone: CaptionTrack['safeZone']): string {
	const marginV = safeZone === 'stories' ? 280 : safeZone === 'feed' ? 140 : 220;
	if (style === 'vhs')
		return `Style: Default,Courier New,54,&H00E8F0FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,${marginV},1`;
	if (style === 'highlight')
		return `Style: Default,DejaVu Sans,58,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,90,90,${marginV},1`;
	return `Style: Default,DejaVu Sans,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,90,90,${marginV},1`;
}

function wrapCueLine(line: string): string[] {
	const words = line
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((text) => ({ text, startMs: 0, endMs: 0, confidence: null }));
	return wrapLines(words).map((parts) => parts.join(' '));
}

export function wrapCtaText(text: string): string[] {
	const words = text
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((value) => ({ text: value, startMs: 0, endMs: 0, confidence: null }));
	const lines = wrapLines(words).map((parts) => parts.join(' '));
	const chunks: string[] = [];
	for (let index = 0; index < lines.length; index += MAX_LINES)
		chunks.push(lines.slice(index, index + MAX_LINES).join('\n'));
	return chunks;
}

export function appendCtaCues(input: {
	cues: CaptionCue[];
	text: string;
	startMs: number;
	endMs: number;
	durationMs: number;
}): CaptionCue[] {
	const previous = input.cues.at(-1);
	const startMs = Math.max(previous?.endMs ?? input.startMs, input.startMs);
	const endMs = Math.min(input.durationMs, input.endMs);
	if (startMs >= endMs || endMs - startMs < 300) return input.cues;
	const chunks = wrapCtaText(input.text);
	if (!chunks.length) return input.cues;
	if (endMs - startMs < chunks.length * 300)
		throw new CaptionError(
			'CAPTION_CTA_WINDOW_TOO_SHORT',
			'A janela da CTA não comporta todos os cues de 300 ms.',
		);
	const cues = [...input.cues];
	const slot = Math.max(300, Math.min(MAX_CUE_MS, Math.floor((endMs - startMs) / chunks.length)));
	let cursor = startMs;
	for (const [index, text] of chunks.entries()) {
		const cueStart = Math.max(cursor, startMs + index * slot);
		const cueEnd = Math.min(endMs, cueStart + slot);
		if (cueEnd - cueStart < 300) break;
		cues.push({ id: crypto.randomUUID(), startMs: cueStart, endMs: cueEnd, text, words: [] });
		cursor = cueEnd;
	}
	return cues;
}

export function buildCaptionAss(track: CaptionTrack): string {
	const lines = [
		'[Script Info]',
		'ScriptType: v4.00+',
		'PlayResX: 1080',
		'PlayResY: 1920',
		'WrapStyle: 0',
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
		const cueLines = cue.text.split('\n').flatMap(wrapCueLine);
		let text = cueLines.map(escapeAssLine).join('\\N');
		if (track.style === 'highlight') {
			const [first, ...rest] = text.split('\\N');
			text = `{\\c&H0000FFFF&\\b1}${first}{\\r}${rest.length ? `\\N${rest.join('\\N')}` : ''}`;
		}
		lines.push(`Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Default,,0,0,0,,${text}`);
	}
	return `${lines.join('\n')}\n`;
}
