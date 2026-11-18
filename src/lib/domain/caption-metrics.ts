import type { CaptionWord } from '#lib/schemas/captions.js';
import type { PreviewBox } from '#lib/schemas/platform-preview.js';

export const MAX_LINE_CHARS = 42;
export const MAX_LINES = 2;
export const CAPTION_FONT_SIZE = 58;
export const CAPTION_SAFE_WIDTH = 880;
export const CAPTION_LINE_HEIGHT = 74;

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
	if (/[MW@%&ÆŒæœ]/u.test(character)) return 0.92;
	if (/[A-ZÀ-Ý]/u.test(character)) return 0.68;
	if (/\d/u.test(character)) return 0.6;
	return 0.55;
}

export function estimateCaptionWidth(text: string, fontSize = CAPTION_FONT_SIZE): number {
	let width = 0;
	for (const character of text) width += characterWidth(character);
	return width * fontSize;
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

export function wrapLines(words: CaptionWord[], maxWidth = CAPTION_SAFE_WIDTH): string[][] {
	const lines: string[][] = [];
	let current: string[] = [];
	let length = 0;
	let width = 0;
	for (const word of words) {
		const pieces = splitWordToWidth(word.text, maxWidth);
		for (const piece of pieces) {
			const pieceWidth = estimateCaptionWidth(piece);
			const addition = current.length ? 1 + piece.length : piece.length;
			const widthAddition = current.length
				? width + estimateCaptionWidth(' ') + pieceWidth
				: pieceWidth;
			if (current.length && (length + addition > MAX_LINE_CHARS || widthAddition > maxWidth)) {
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

export function wrapCueLine(line: string, maxWidth = CAPTION_SAFE_WIDTH): string[] {
	const words = line
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((text) => ({ text, startMs: 0, endMs: 0, confidence: null }));
	return wrapLines(words, maxWidth).map((parts) => parts.join(' '));
}

export function wrapCtaText(text: string, maxWidth = CAPTION_SAFE_WIDTH): string[] {
	const words = text
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((value) => ({ text: value, startMs: 0, endMs: 0, confidence: null }));
	const lines = wrapLines(words, maxWidth).map((parts) => parts.join(' '));
	const chunks: string[] = [];
	for (let index = 0; index < lines.length; index += MAX_LINES)
		chunks.push(lines.slice(index, index + MAX_LINES).join('\n'));
	return chunks;
}

/** True when wrapped text fits inside the canonical box without spilling into UI zones. */
export function captionTextFitsBox(text: string, box: PreviewBox, maxLines = MAX_LINES): boolean {
	const lines = text
		.split('\n')
		.flatMap((line) => wrapCueLine(line, Math.max(320, box.width - 20)));
	return (
		lines.length <= maxLines && lines.length * CAPTION_LINE_HEIGHT <= Math.max(0, box.height - 8)
	);
}
