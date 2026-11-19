import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { coverConfigSchema, type CoverFormatId } from '#lib/schemas/cover.js';
import {
	MAX_COVER_RESPONSE_BYTES,
	coverResponseExceedsLimit,
	renderCover,
} from './cover-render.js';

const formats: CoverFormatId[] = ['9:16', '3:4', '4:5'];

function config(format: CoverFormatId, templateId: 'noir' | 'vhs_polaroid' | 'archive' | 'cctv') {
	return coverConfigSchema.parse({
		schemaVersion: 1,
		templateId,
		templateVersion: 1,
		format,
		frameAssetId: null,
		title: 'A fita amaldiçoada de volta ao arquivo',
		subtitle: 'Uma gravação encontrada três dias depois',
		badge: 'E01',
		seriesTitle: 'Arquivo 17',
		focusX: 0.5,
		focusY: 0.5,
		watermark: true,
	});
}

describe('cover rendering with Sharp', () => {
	it('renders all formats and templates at the expected dimensions', async () => {
		for (const format of formats) {
			for (const templateId of ['noir', 'vhs_polaroid', 'archive', 'cctv'] as const) {
				const rendered = await renderCover(config(format, templateId), null, format);
				const metadata = await sharp(rendered.buffer).metadata();
				expect(metadata.width).toBe(rendered.width);
				expect(metadata.height).toBe(rendered.height);
				expect(metadata.format).toBe('png');
				expect(rendered.buffer.length).toBeGreaterThan(5_000);
			}
		}
	}, 120_000);

	it('composites over a private source frame with focus and JPEG output', async () => {
		const source = await sharp({
			create: { width: 900, height: 1600, channels: 3, background: '#334455' },
		})
			.composite([
				{
					input: Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect x="0" y="0" width="450" height="1600" fill="#8899aa"/></svg>',
					),
					left: 0,
					top: 0,
				},
			])
			.png()
			.toBuffer();
		const rendered = await renderCover(config('9:16', 'archive'), source, '9:16', 'jpeg');
		const metadata = await sharp(rendered.buffer).metadata();
		expect(metadata.width).toBe(1080);
		expect(metadata.height).toBe(1920);
		expect(metadata.format).toBe('jpeg');
		expect(rendered.mimeType).toBe('image/jpeg');
	}, 60_000);

	it('renders a smaller preview variant for the grid', async () => {
		const rendered = await renderCover(config('9:16', 'noir'), null, '9:16', 'png', 0.35);
		const metadata = await sharp(rendered.buffer).metadata();
		expect(metadata.width).toBe(378);
		expect(metadata.height).toBe(672);
		expect(rendered.buffer.length).toBeLessThan(MAX_COVER_RESPONSE_BYTES);
	});

	it('detects responses above the Vercel body budget', () => {
		expect(coverResponseExceedsLimit([Buffer.alloc(1_000)])).toBe(false);
		expect(coverResponseExceedsLimit([Buffer.alloc(MAX_COVER_RESPONSE_BYTES + 1)])).toBe(true);
	});

	it('auto-orients an EXIF-rotated source before cropping', async () => {
		const source = await sharp({
			create: { width: 400, height: 200, channels: 3, background: '#884422' },
		})
			.withMetadata({ orientation: 6 })
			.png()
			.toBuffer();
		const rendered = await renderCover(config('9:16', 'noir'), source, '9:16');
		const metadata = await sharp(rendered.buffer).metadata();
		expect(metadata.width).toBe(1080);
		expect(metadata.height).toBe(1920);
	}, 60_000);

	it('renders long titles and accents without throwing', async () => {
		const long = coverConfigSchema.parse({
			...config('4:5', 'vhs_polaroid'),
			title: 'Uma gravação feita três dias depois daquele instante — 🎥 — e ninguém sabia de nada',
			subtitle: 'A fita continua rodando. A fita continua rodando. A fita continua rodando.',
		});
		const rendered = await renderCover(long, null, '4:5');
		expect(rendered.width).toBe(1080);
		expect(rendered.height).toBe(1350);
	}, 60_000);
});
