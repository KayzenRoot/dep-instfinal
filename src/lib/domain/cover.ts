import { trimEdgeCharacters } from './trim-edge.js';
import {
	COVER_FORMATS,
	type CoverConfig,
	type CoverFormatId,
	type CoverTemplateId,
} from '#lib/schemas/cover.js';

export interface CoverTemplate {
	id: CoverTemplateId;
	label: string;
	version: 1;
	description: string;
	treatment: { saturation: number; brightness: number; contrast: number };
	background: [string, string];
	overlayTop: number;
	overlayBottom: number;
	titleColor: string;
	subtitleColor: string;
	badgeBackground: string;
	badgeColor: string;
	accent: string;
}

export const COVER_TEMPLATES: Record<CoverTemplateId, CoverTemplate> = {
	noir: {
		id: 'noir',
		label: 'Noir',
		version: 1,
		description: 'Monocromático de alto contraste, tipografia branca e selo discreto.',
		treatment: { saturation: 0.12, brightness: 0.9, contrast: 1.12 },
		background: ['#151515', '#030303'],
		overlayTop: 0.32,
		overlayBottom: 0.94,
		titleColor: '#f4f1e8',
		subtitleColor: '#bfb9aa',
		badgeBackground: '#f4f1e8',
		badgeColor: '#111111',
		accent: '#d8cdb8',
	},
	vhs_polaroid: {
		id: 'vhs_polaroid',
		label: 'VHS polaroid',
		version: 1,
		description: 'Calor analógico, rosa queimado e selo de fita.',
		treatment: { saturation: 1.08, brightness: 1.04, contrast: 1.02 },
		background: ['#2b1022', '#09050b'],
		overlayTop: 0.22,
		overlayBottom: 0.9,
		titleColor: '#ffe9c9',
		subtitleColor: '#f3b7c5',
		badgeBackground: '#ff5f7e',
		badgeColor: '#240711',
		accent: '#f3b7c5',
	},
	archive: {
		id: 'archive',
		label: 'Arquivo classificado',
		version: 1,
		description: 'Sépia documental e selo de episódio.',
		treatment: { saturation: 0.46, brightness: 0.96, contrast: 1.08 },
		background: ['#241b12', '#080604'],
		overlayTop: 0.28,
		overlayBottom: 0.92,
		titleColor: '#f4e4c8',
		subtitleColor: '#c8ad82',
		badgeBackground: '#d8b779',
		badgeColor: '#201408',
		accent: '#d8b779',
	},
	cctv: {
		id: 'cctv',
		label: 'CCTV',
		version: 1,
		description: 'Verde de vigilância, contraste duro e leitura de monitor.',
		treatment: { saturation: 0.4, brightness: 0.92, contrast: 1.16 },
		background: ['#04140d', '#000403'],
		overlayTop: 0.3,
		overlayBottom: 0.95,
		titleColor: '#d8ffe8',
		subtitleColor: '#7fd9a2',
		badgeBackground: '#a6ffca',
		badgeColor: '#001a0c',
		accent: '#7fd9a2',
	},
};

export const COVER_TEMPLATE_LIST = Object.values(COVER_TEMPLATES);

export interface CoverLayout {
	width: number;
	height: number;
	titleBox: { x: number; y: number; width: number; height: number };
	subtitleBox: { x: number; y: number; width: number; height: number };
	badgeBox: { x: number; y: number; width: number; height: number };
	logoBox: { x: number; y: number; width: number; height: number };
	gridCrop: { x: number; y: number; width: number; height: number };
}

function round(value: number): number {
	return Math.round(value);
}

export function coverLayout(format: CoverFormatId): CoverLayout {
	const { width, height } = COVER_FORMATS[format];
	const left = round(width * 0.074);
	const vertical = format === '9:16';
	const top = vertical ? round(height * 0.099) : round(height * 0.076);
	const right = vertical ? round(width * 0.167) : round(width * 0.074);
	const titleTop = round(height * 0.56);
	const titleHeight = round(height * 0.24);
	const gridHeight = Math.min(height, round(width * 1.25));
	const gridTop = round((height - gridHeight) / 2);
	const badgeTop = Math.max(top, gridTop + round(height * 0.02));
	return {
		width,
		height,
		titleBox: {
			x: left,
			y: titleTop,
			width: width - left - right,
			height: titleHeight,
		},
		subtitleBox: {
			x: left,
			y: titleTop + titleHeight,
			width: width - left - right,
			height: round(height * 0.06),
		},
		badgeBox: {
			x: left,
			y: badgeTop,
			width: round(width * 0.31),
			height: round(height * 0.038),
		},
		logoBox: {
			x: width - right - round(width * 0.28),
			y: badgeTop,
			width: round(width * 0.28),
			height: round(height * 0.038),
		},
		gridCrop: {
			x: 0,
			y: gridTop,
			width,
			height: gridHeight,
		},
	};
}

export function scaleCoverLayout(layout: CoverLayout, scale: number): CoverLayout {
	const factor = Math.min(1, Math.max(0.2, scale));
	const scaleBox = (box: { x: number; y: number; width: number; height: number }) => ({
		x: round(box.x * factor),
		y: round(box.y * factor),
		width: round(box.width * factor),
		height: round(box.height * factor),
	});
	return {
		width: round(layout.width * factor),
		height: round(layout.height * factor),
		titleBox: scaleBox(layout.titleBox),
		subtitleBox: scaleBox(layout.subtitleBox),
		badgeBox: scaleBox(layout.badgeBox),
		logoBox: scaleBox(layout.logoBox),
		gridCrop: scaleBox(layout.gridCrop),
	};
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function hardWrap(word: string, maxChars: number): string[] {
	const characters = Array.from(word);
	const chunks: string[] = [];
	for (let index = 0; index < characters.length; index += maxChars)
		chunks.push(characters.slice(index, index + maxChars).join(''));
	return chunks;
}

/** Word-wraps Unicode text and truncates to a bounded number of lines. */
export function wrapCoverText(text: string, maxChars: number, maxLines: number): string[] {
	const limit = Math.max(4, Math.floor(maxChars));
	const words = text.replaceAll(/\s+/g, ' ').trim().split(' ').filter(Boolean);
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const chunks = Array.from(word).length > limit ? hardWrap(word, limit) : [word];
		for (const chunk of chunks) {
			const next = current ? `${current} ${chunk}` : chunk;
			if (Array.from(next).length <= limit) {
				current = next;
			} else {
				if (current) lines.push(current);
				current = chunk;
			}
		}
	}
	if (current) lines.push(current);
	if (lines.length <= maxLines) return lines;
	const truncated = lines.slice(0, maxLines);
	const last = truncated[maxLines - 1] ?? '';
	truncated[maxLines - 1] = `${Array.from(last)
		.slice(0, Math.max(2, limit - 1))
		.join('')}…`;
	return truncated;
}

export interface CoverSvgOptions {
	background: boolean;
}

const DEFAULT_COVER_SVG_OPTIONS: CoverSvgOptions = Object.freeze({ background: false });

/** Deterministic overlay for a cover. User strings are XML-escaped. */
export function buildCoverSvg(
	config: CoverConfig,
	template: CoverTemplate,
	layout: CoverLayout,
	options: CoverSvgOptions = DEFAULT_COVER_SVG_OPTIONS,
): string {
	const fontSize = round(layout.width * 0.078);
	const lineHeight = round(fontSize * 1.08);
	const maxChars = Math.max(8, Math.floor(layout.titleBox.width / (fontSize * 0.58)));
	const lines = wrapCoverText(config.title, maxChars, 3);
	const subtitleSize = round(layout.width * 0.032);
	const badgeSize = round(layout.width * 0.03);
	const seriesSize = round(layout.width * 0.026);
	const titleStart = layout.titleBox.y + fontSize;
	const badgeText = wrapCoverText(config.badge || 'EPISÓDIO', 20, 1)[0] ?? 'EPISÓDIO';
	const title = lines
		.map((line, index) => {
			const estimated = Array.from(line).length * fontSize;
			const fit =
				estimated > layout.titleBox.width
					? ` textLength="${layout.titleBox.width}" lengthAdjust="spacingAndGlyphs"`
					: '';
			return `<text x="${layout.titleBox.x}" y="${titleStart + index * lineHeight}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${template.titleColor}" stroke="#000" stroke-opacity="0.55" stroke-width="2" paint-order="stroke"${fit}>${escapeXml(line)}</text>`;
		})
		.join('');
	const subtitle = config.subtitle
		? wrapCoverText(
				config.subtitle,
				Math.floor(layout.subtitleBox.width / (subtitleSize * 0.58)),
				2,
			)
				.map(
					(line, index) =>
						`<text x="${layout.subtitleBox.x}" y="${layout.subtitleBox.y + subtitleSize + index * round(subtitleSize * 1.18)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${subtitleSize}" fill="${template.subtitleColor}">${escapeXml(line)}</text>`,
				)
				.join('')
		: '';
	const background = options.background
		? `<rect width="${layout.width}" height="${layout.height}" fill="url(#coverBg)"/>`
		: '';
	const watermark = config.watermark
		? `<text x="${layout.logoBox.x + layout.logoBox.width}" y="${layout.logoBox.y + layout.logoBox.height * 0.7}" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="${seriesSize}" fill="${template.accent}" opacity="0.9">DIF STUDIO</text>`
		: '';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">
<defs>
<linearGradient id="coverBg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${template.background[0]}"/>
<stop offset="1" stop-color="${template.background[1]}"/>
</linearGradient>
<linearGradient id="coverShade" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="${template.overlayTop}"/>
<stop offset="0.48" stop-color="#000" stop-opacity="0.5"/>
<stop offset="0.62" stop-color="#000" stop-opacity="${Math.max(0.55, template.overlayBottom - 0.2)}"/>
<stop offset="1" stop-color="#000" stop-opacity="${template.overlayBottom}"/>
</linearGradient>
</defs>
${background}
<rect width="${layout.width}" height="${layout.height}" fill="url(#coverShade)"/>
<rect x="${layout.titleBox.x - 24}" y="${layout.titleBox.y - 28}" width="${layout.titleBox.width + 48}" height="${layout.titleBox.height + round(layout.titleBox.height * 0.35)}" rx="${round(layout.width * 0.02)}" fill="#000" opacity="0.32"/>
<rect x="${layout.badgeBox.x}" y="${layout.badgeBox.y}" width="${layout.badgeBox.width}" height="${layout.badgeBox.height}" rx="${round(layout.badgeBox.height / 2)}" fill="${template.badgeBackground}"/>
<text x="${layout.badgeBox.x + round(layout.badgeBox.width * 0.04)}" y="${layout.badgeBox.y + round(layout.badgeBox.height * 0.68)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${badgeSize}" font-weight="700" fill="${template.badgeColor}"${Array.from(badgeText).length * badgeSize > layout.badgeBox.width * 0.9 ? ` textLength="${round(layout.badgeBox.width * 0.9)}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXml(badgeText)}</text>
<text x="${layout.badgeBox.x}" y="${layout.badgeBox.y + layout.badgeBox.height + round(layout.height * 0.014)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${seriesSize}" letter-spacing="2" fill="${template.accent}" stroke="#000" stroke-opacity="0.4" stroke-width="1" paint-order="stroke"${Array.from(wrapCoverText(config.seriesTitle.toUpperCase(), 22, 1)[0] ?? '').length * seriesSize > layout.logoBox.width ? ` textLength="${layout.logoBox.width}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXml(
		wrapCoverText(config.seriesTitle.toUpperCase(), 22, 1)[0] ?? '',
	)}</text>
${title}
${subtitle}
${watermark}
</svg>`;
}

export function coverFileBase(config: CoverConfig): string {
	const normalized = config.title
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-');
	const slug = trimEdgeCharacters(normalized, '-').slice(0, 48);
	return `cover-${slug || 'episodio'}-${config.templateId}-${config.format.replace(':', 'x')}`;
}
