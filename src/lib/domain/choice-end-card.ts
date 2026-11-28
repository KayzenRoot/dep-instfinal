import {
	CHOICE_END_CARD_TEMPLATE_IDS,
	END_CARD_MAX_MS,
	END_CARD_MIN_MS,
	type ChoiceEndCardChoice,
	type ChoiceEndCardLayout,
	type ChoiceEndCardSfx,
	type ChoiceEndCardTemplateId,
	type EditPlanEndCard,
} from '#lib/schemas/choice-end-card.js';

export class EndCardError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'EndCardError';
	}
}

export interface EndCardTemplate {
	id: ChoiceEndCardTemplateId;
	version: 1;
	label: string;
	description: string;
	background: string;
	panel: string;
	accent: string;
	text: string;
	font: string;
	splitPanelB?: { panel: string; text: string };
}

export const END_CARD_TEMPLATES: Record<ChoiceEndCardTemplateId, EndCardTemplate> = {
	doors: {
		id: 'doors',
		version: 1,
		label: 'Duas portas',
		description: 'Duas portas de madeira sob uma luz âmbar, com letras grandes.',
		background: '#140b06',
		panel: '#2a160b',
		accent: '#ffb347',
		text: '#fff2df',
		font: 'Georgia',
	},
	stamped: {
		id: 'stamped',
		version: 1,
		label: 'Arquivo carimbado',
		description: 'Papel de arquivo, carimbo vermelho e tipografia de máquina.',
		background: '#d8cdb5',
		panel: '#efe6d1',
		accent: '#a31616',
		text: '#1b1510',
		font: 'Courier New',
	},
	signal: {
		id: 'signal',
		version: 1,
		label: 'Sinal interrompido',
		description: 'Preto e ciano, borda de transmissão e ruído contido.',
		background: '#010607',
		panel: '#06191c',
		accent: '#46f3ff',
		text: '#d8feff',
		font: 'Consolas',
	},
	cctv: {
		id: 'cctv',
		version: 1,
		label: 'CCTV bip',
		description: 'Câmera de segurança verde, horário e bip determinístico.',
		background: '#010803',
		panel: '#06180c',
		accent: '#7dff9b',
		text: '#ddffe5',
		font: 'Consolas',
	},
	split: {
		id: 'split',
		version: 1,
		label: 'Tela dividida',
		description: 'Metade clara e metade escura, contraste máximo entre A e B.',
		background: '#000000',
		panel: '#f2f2f2',
		accent: '#ffffff',
		text: '#050505',
		font: 'Arial',
		splitPanelB: { panel: '#050505', text: '#f2f2f2' },
	},
	analog: {
		id: 'analog',
		version: 1,
		label: 'Tipografia analógica',
		description: 'Amarelo de fita e preto, com letras de bloco.',
		background: '#090800',
		panel: '#151300',
		accent: '#ffe600',
		text: '#fffbcc',
		font: 'Arial',
	},
};

export const END_CARD_TEMPLATE_LIST = CHOICE_END_CARD_TEMPLATE_IDS.map(
	(id) => END_CARD_TEMPLATES[id],
);

export interface EndCardBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface EndCardLayoutBoxes {
	header: EndCardBox;
	footer: EndCardBox;
	panels: EndCardBox[];
	panelsTop: number;
	panelsHeight: number;
}

function round(value: number): number {
	return Math.round(value);
}

export function endCardLayout(
	safeArea: EndCardBox,
	layout: ChoiceEndCardLayout,
): EndCardLayoutBoxes {
	const margin = 24;
	const gap = 20;
	const headerHeight = 96;
	const footerHeight = 64;
	const maxHeight = 820;
	const cardHeight = Math.min(maxHeight, round(safeArea.height * 0.56));
	const top = safeArea.y + Math.max(0, round((safeArea.height - cardHeight) / 2));
	const panelsTop = top + headerHeight;
	const panelsHeight = Math.max(120, cardHeight - headerHeight - footerHeight);
	const width = Math.max(120, safeArea.width - margin * 2);
	const panelWidth = layout === 'split' ? Math.max(80, round((width - gap) / 2)) : width;
	const panelHeight =
		layout === 'split' ? panelsHeight : Math.max(80, round((panelsHeight - gap) / 2));
	const panels: EndCardBox[] = [
		{ x: safeArea.x + margin, y: panelsTop, width: panelWidth, height: panelHeight },
	];
	if (layout === 'split') {
		panels.push({
			x: safeArea.x + margin + panelWidth + gap,
			y: panelsTop,
			width: panelWidth,
			height: panelHeight,
		});
	} else {
		panels.push({
			x: safeArea.x + margin,
			y: panelsTop + panelHeight + gap,
			width: panelWidth,
			height: panelHeight,
		});
	}
	return {
		header: {
			x: safeArea.x + margin,
			y: top,
			width,
			height: headerHeight,
		},
		footer: {
			x: safeArea.x + margin,
			y: top + cardHeight - footerHeight,
			width,
			height: footerHeight,
		},
		panels,
		panelsTop,
		panelsHeight,
	};
}

/** Word-wraps Unicode text; throws instead of silently truncating an approved label. */
export function wrapEndCardText(
	text: string,
	maxChars: number,
	maxLines: number,
	label = 'Texto',
): string[] {
	const limit = Math.max(4, Math.floor(maxChars));
	const words = text.replaceAll(/\s+/g, ' ').trim().split(' ').filter(Boolean);
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const characters = Array.from(word);
		const chunks =
			characters.length > limit
				? Array.from({ length: Math.ceil(characters.length / limit) }, (_, index) =>
						characters.slice(index * limit, (index + 1) * limit).join(''),
					)
				: [word];
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
	if (lines.length > maxLines)
		throw new EndCardError(
			'END_CARD_TEXT_OVERFLOW',
			`${label} não cabe no layout escolhido. Encurte o texto ou use o layout empilhado.`,
		);
	return lines.length ? lines : [''];
}

function escapeAssLine(line: string): string {
	return line
		.replace(/\p{Cc}/gu, '')
		.replaceAll('\\', '\uFF3C')
		.replaceAll('{', '\uFF5B')
		.replaceAll('}', '\uFF5D');
}

function assColor(hex: string): string {
	const value = hex.replace('#', '');
	return `&H${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}&`;
}

function assTime(milliseconds: number): string {
	const value = Math.max(0, Math.floor(milliseconds));
	const hours = Math.floor(value / 3_600_000);
	const minutes = Math.floor((value % 3_600_000) / 60_000);
	const seconds = Math.floor((value % 60_000) / 1_000);
	const centiseconds = Math.floor((value % 1_000) / 10);
	return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function rectangle(box: EndCardBox, color: string, borderColor?: string, fade = false): string {
	const border = borderColor ? `\\bord4\\3c${assColor(borderColor)}` : '\\bord0';
	const fadeTag = fade ? '\\fad(180,220)' : '';
	return `{\\an7\\p1\\pos(${box.x},${box.y})${fadeTag}\\c${assColor(color)}${border}}m 0 0 l ${box.width} 0 l ${box.width} ${box.height} l 0 ${box.height}{\\p0}`;
}

function textEvent(input: {
	startMs: number;
	endMs: number;
	x: number;
	y: number;
	text: string;
	font: string;
	size: number;
	color: string;
	fade: boolean;
	bold?: boolean;
}): string {
	const tags = [
		`\\an5\\pos(${input.x},${input.y})`,
		`\\fn${input.font}`,
		`\\fs${input.size}`,
		`\\c${assColor(input.color)}`,
		'\\bord3',
		`\\3c${assColor('#000000')}`,
		'\\shad0',
	];
	if (input.bold) tags.push('\\b1');
	if (input.fade) tags.push('\\fad(180,220)');
	return `Dialogue: 3,${assTime(input.startMs)},${assTime(input.endMs)},EndCard,,0,0,0,,{${tags.join('')}}${escapeAssLine(input.text)}`;
}

export function endCardChoiceText(choice: ChoiceEndCardChoice): string {
	return choice.label;
}

/** Builds a standalone ASS overlay for the two-choice end card. */
export function buildEndCardAss(endCard: EditPlanEndCard, safeArea: EndCardBox): string {
	if (
		endCard.durationMs < END_CARD_MIN_MS ||
		endCard.durationMs > END_CARD_MAX_MS ||
		endCard.endMs - endCard.startMs !== endCard.durationMs
	)
		throw new EndCardError('END_CARD_WINDOW_INVALID', 'A janela do final A/B é inválida.');
	if (endCard.endMs > 150_000)
		throw new EndCardError('END_CARD_WINDOW_INVALID', 'O final A/B excede o episódio.');
	const template = END_CARD_TEMPLATES[endCard.templateId];
	const boxes = endCardLayout(safeArea, endCard.layout);
	const splitPanelB = template.splitPanelB;
	const revealAt = (offsetMs: number) =>
		endCard.reducedMotion ? endCard.startMs : endCard.startMs + offsetMs;
	const firstReveal = revealAt(0);
	const secondReveal = revealAt(320);
	const chromeReveal = revealAt(620);
	const fade = !endCard.reducedMotion;
	const events: string[] = [];

	events.push(
		`Dialogue: 1,${assTime(endCard.startMs)},${assTime(endCard.endMs)},EndCard,,0,0,0,,${rectangle(
			{ x: 0, y: 0, width: 1080, height: 1920 },
			template.background,
		)}`,
	);
	events.push(
		`Dialogue: 2,${assTime(endCard.startMs)},${assTime(endCard.endMs)},EndCard,,0,0,0,,${rectangle(
			boxes.header,
			template.background,
			undefined,
			fade,
		)}`,
	);

	const promptLines = wrapEndCardText(
		endCard.prompt,
		Math.floor(boxes.header.width / (36 * 0.58)),
		2,
		'Prompt',
	);
	events.push(
		...promptLines.map((line, index) =>
			textEvent({
				startMs: chromeReveal,
				endMs: endCard.endMs,
				x: boxes.header.x + boxes.header.width / 2,
				y: boxes.header.y + 34 + index * 42,
				text: line,
				font: template.font,
				size: 36,
				color: template.text,
				fade,
				bold: true,
			}),
		),
	);

	for (const [index, choice] of endCard.choices.entries()) {
		const panel = boxes.panels[index]!;
		const light = index === 0;
		const panelColor =
			endCard.templateId === 'split' && !light
				? (splitPanelB?.panel ?? template.panel)
				: template.panel;
		const textColor =
			endCard.templateId === 'split' && !light
				? (splitPanelB?.text ?? template.text)
				: template.text;
		const reveal = index === 0 ? firstReveal : secondReveal;
		events.push(
			`Dialogue: 2,${assTime(reveal)},${assTime(endCard.endMs)},EndCard,,0,0,0,,${rectangle(
				panel,
				panelColor,
				template.accent,
				fade,
			)}`,
		);
		const accentHeight = Math.max(8, round(panel.height * 0.018));
		events.push(
			`Dialogue: 2,${assTime(reveal)},${assTime(endCard.endMs)},EndCard,,0,0,0,,${rectangle(
				{ x: panel.x, y: panel.y, width: panel.width, height: accentHeight },
				template.accent,
				undefined,
				fade,
			)}`,
		);
		const letterSize = endCard.layout === 'split' ? 110 : 92;
		events.push(
			textEvent({
				startMs: reveal,
				endMs: endCard.endMs,
				x: panel.x + panel.width / 2,
				y: panel.y + letterSize * 0.8,
				text: index === 0 ? 'A' : 'B',
				font: template.font,
				size: letterSize,
				color: endCard.templateId === 'split' && !light ? template.accent : textColor,
				fade,
				bold: true,
			}),
		);
		const labelSize = endCard.layout === 'split' ? 38 : 40;
		const labelLines = wrapEndCardText(
			endCardChoiceText(choice),
			Math.floor((panel.width - 36) / (labelSize * 0.58)),
			endCard.layout === 'split' ? 3 : 4,
			`Escolha ${index === 0 ? 'A' : 'B'}`,
		);
		const labelStart = panel.y + letterSize * 1.4;
		events.push(
			...labelLines.map((line, lineIndex) =>
				textEvent({
					startMs: reveal,
					endMs: endCard.endMs,
					x: panel.x + panel.width / 2,
					y: labelStart + lineIndex * (labelSize * 1.2),
					text: line,
					font: template.font,
					size: labelSize,
					color: textColor,
					fade,
				}),
			),
		);
	}

	const footerLines = wrapEndCardText(
		endCard.footer,
		Math.floor(boxes.footer.width / (30 * 0.58)),
		1,
		'Rodapé',
	);
	events.push(
		textEvent({
			startMs: chromeReveal,
			endMs: endCard.endMs,
			x: boxes.footer.x + boxes.footer.width / 2,
			y: boxes.footer.y + boxes.footer.height / 2,
			text: footerLines[0] ?? '',
			font: template.font,
			size: 30,
			color: template.accent,
			fade,
			bold: true,
		}),
	);

	return [
		'[Script Info]',
		'ScriptType: v4.00+',
		'PlayResX: 1080',
		'PlayResY: 1920',
		'WrapStyle: 0',
		'ScaledBorderAndShadow: yes',
		'',
		'[V4+ Styles]',
		'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
		'Style: EndCard,DejaVu Sans,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,5,10,10,10,1',
		'',
		'[Events]',
		'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
		...events,
		'',
	].join('\n');
}

function writeWavHeader(dataBytes: number, sampleRate: number, channels: number): Buffer {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + dataBytes, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * channels * 2, 28);
	header.writeUInt16LE(channels * 2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(dataBytes, 40);
	return header;
}

/**
 * Deterministic, locally synthesized SFX. No paid assets, no random seed.
 * The mix applies loudness normalization and limiting downstream.
 */
export function buildEndCardSfxWav(
	sfx: ChoiceEndCardSfx,
	durationMs: number,
	volumeDb: number,
): Buffer | null {
	if (sfx === 'none') return null;
	const duration = Math.max(1_000, Math.min(END_CARD_MAX_MS, Math.round(durationMs)));
	const sampleRate = 48_000;
	const channels = 2;
	const samples = Math.round((duration / 1000) * sampleRate);
	const data = Buffer.alloc(samples * channels * 2);
	const gain = Math.min(1, Math.max(0.001, 10 ** (volumeDb / 20)));
	for (let index = 0; index < samples; index += 1) {
		const time = index / sampleRate;
		const remaining = duration / 1000 - time;
		const edge = Math.min(1, time / 0.02, remaining / 0.1);
		let value: number;
		if (sfx === 'beep') {
			const phase = time % 0.8;
			const burst = phase < 0.14 ? Math.sin(2 * Math.PI * 880 * time) : 0;
			const burstEdge = Math.min(1, phase / 0.008, (0.14 - phase) / 0.008);
			value = burst * Math.max(0, burstEdge) * 0.22;
		} else if (sfx === 'rumble') {
			value =
				(Math.sin(2 * Math.PI * 46 * time) * 0.34 +
					Math.sin(2 * Math.PI * 73 * time + 0.7) * 0.18 +
					Math.sin(2 * Math.PI * 121 * time + 1.3) * 0.08) *
				0.55;
		} else {
			const envelope = 0.35 + 0.65 * Math.max(0, Math.sin(2 * Math.PI * 0.75 * time));
			value =
				Math.sin(2 * Math.PI * 150 * time + Math.sin(2 * Math.PI * 2 * time) * 0.4) *
				0.2 *
				envelope;
		}
		const sample = Math.max(-1, Math.min(1, value * gain * edge));
		const integer = Math.round(sample * 32767);
		const offset = index * channels * 2;
		data.writeInt16LE(integer, offset);
		data.writeInt16LE(integer, offset + 2);
	}
	return Buffer.concat([writeWavHeader(data.length, sampleRate, channels), data]);
}
