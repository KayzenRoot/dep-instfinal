import { describe, expect, it } from 'vitest';
import { coverConfigSchema } from '#lib/schemas/cover.js';
import { coverConfigHash } from './cover-hash.js';
import {
	COVER_TEMPLATE_LIST,
	buildCoverSvg,
	coverFileBase,
	coverLayout,
	wrapCoverText,
} from './cover.js';

const base = coverConfigSchema.parse({
	schemaVersion: 1,
	templateId: 'noir',
	templateVersion: 1,
	format: '9:16',
	frameAssetId: null,
	title: 'A fita amaldiçoada',
	subtitle: 'Uma gravação encontrada três dias depois',
	badge: 'E01',
	seriesTitle: 'Arquivo 17',
	focusX: 0.5,
	focusY: 0.5,
	watermark: true,
});

describe('cover templates', () => {
	it('ships four distinct versioned presets and safe layouts for every format', () => {
		expect(COVER_TEMPLATE_LIST.map((template) => template.id)).toEqual([
			'noir',
			'vhs_polaroid',
			'archive',
			'cctv',
		]);
		expect(new Set(COVER_TEMPLATE_LIST.map((template) => template.description)).size).toBe(4);
		for (const format of ['9:16', '3:4', '4:5'] as const) {
			const layout = coverLayout(format);
			expect(layout.titleBox.x).toBeGreaterThan(0);
			expect(layout.titleBox.x + layout.titleBox.width).toBeLessThanOrEqual(layout.width);
			expect(layout.titleBox.y + layout.titleBox.height).toBeLessThanOrEqual(layout.height);
			expect(layout.gridCrop.width).toBe(layout.width);
			expect(layout.gridCrop.height).toBeLessThanOrEqual(layout.height);
		}
		const vertical = coverLayout('9:16');
		expect(vertical.titleBox.x + vertical.titleBox.width).toBeLessThanOrEqual(900);
		expect(vertical.titleBox.y + vertical.titleBox.height).toBeLessThanOrEqual(1620);
		expect(vertical.badgeBox.y).toBeGreaterThanOrEqual(vertical.gridCrop.y);
		expect(vertical.logoBox.x + vertical.logoBox.width).toBeLessThanOrEqual(900);
		expect(
			vertical.badgeBox.y - Math.round(vertical.badgeBox.height * 0.42),
		).toBeGreaterThanOrEqual(vertical.gridCrop.y);
	});

	it('wraps and truncates long Unicode titles within the line budget', () => {
		const lines = wrapCoverText(
			'Uma gravação feita três dias depois daquele instante — 🎥 — e ninguém sabia',
			24,
			3,
		);
		expect(lines).toHaveLength(3);
		expect(lines.join('')).toContain('…');
		expect(Math.max(...lines.map((line) => Array.from(line).length))).toBeLessThanOrEqual(24);
		expect(wrapCoverText('curto', 24, 3)).toEqual(['curto']);
	});

	it('escapes user text in the SVG and never injects markup', () => {
		const config = coverConfigSchema.parse({
			...base,
			title: '<script>alert(1)</script> & "fita"',
			subtitle: '<svg onload=alert(1)>',
			seriesTitle: '<Série>',
		});
		const svg = buildCoverSvg(config, COVER_TEMPLATE_LIST[0]!, coverLayout('9:16'), {
			background: true,
		});
		expect(svg).toContain('&lt;script&gt;');
		expect(svg).not.toContain('<script>');
		expect(svg).toContain('&amp;');
	});

	it('forces excessively wide title lines to fit and draws a contrast scrim', () => {
		const config = coverConfigSchema.parse({
			...base,
			title: 'WWWWWWWWWWWW',
			badge: 'WWWWWWWWWWWWWWWWWWWW',
		});
		const svg = buildCoverSvg(config, COVER_TEMPLATE_LIST[0]!, coverLayout('9:16'), {
			background: true,
		});
		expect(svg).toContain('textLength=');
		expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
		expect(svg).toContain('stroke="#000"');
		expect(svg).toContain('opacity="0.32"');
	});

	it('hashes deterministically and builds a safe file name', () => {
		expect(coverConfigHash(base)).toBe(coverConfigHash({ ...base }));
		expect(coverConfigHash({ ...base, title: 'Outra capa' })).not.toBe(coverConfigHash(base));
		expect(coverFileBase(base)).toBe('cover-a-fita-amaldicoada-noir-9x16');
		expect(coverFileBase({ ...base, title: '../../etc/passwd' })).not.toContain('..');
	});
});
