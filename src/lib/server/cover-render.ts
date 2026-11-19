import sharp, { type Sharp } from 'sharp';
import { COVER_FORMATS, type CoverConfig, type CoverFormatId } from '#lib/schemas/cover.js';
import {
	COVER_TEMPLATES,
	buildCoverSvg,
	coverLayout,
	type CoverLayout,
} from '#lib/domain/cover.js';

export interface RenderedCover {
	buffer: Buffer;
	width: number;
	height: number;
	mimeType: 'image/png' | 'image/jpeg';
	extension: 'png' | 'jpg';
}

async function coverBase(
	source: Buffer | null,
	config: CoverConfig,
	layout: CoverLayout,
): Promise<Sharp> {
	if (!source)
		return sharp(
			Buffer.from(
				buildCoverSvg(config, COVER_TEMPLATES[config.templateId], layout, {
					background: true,
				}),
			),
			{ density: 72 },
		);
	const metadata = await sharp(source, { failOn: 'error', animated: false }).metadata();
	const width = metadata.width ?? 1;
	const height = metadata.height ?? 1;
	const scale = Math.max(layout.width / width, layout.height / height);
	const resizedWidth = Math.max(layout.width, Math.ceil(width * scale));
	const resizedHeight = Math.max(layout.height, Math.ceil(height * scale));
	const left = Math.min(
		resizedWidth - layout.width,
		Math.max(0, Math.round((resizedWidth - layout.width) * config.focusX)),
	);
	const top = Math.min(
		resizedHeight - layout.height,
		Math.max(0, Math.round((resizedHeight - layout.height) * config.focusY)),
	);
	return sharp(source, { failOn: 'error', animated: false })
		.rotate()
		.resize(resizedWidth, resizedHeight, { fit: 'fill' })
		.extract({ left, top, width: layout.width, height: layout.height })
		.modulate({
			saturation: COVER_TEMPLATES[config.templateId].treatment.saturation,
			brightness: COVER_TEMPLATES[config.templateId].treatment.brightness,
		})
		.linear(COVER_TEMPLATES[config.templateId].treatment.contrast, 0)
		.recomb([
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		]);
}

export async function renderCover(
	config: CoverConfig,
	source: Buffer | null,
	format: CoverFormatId = config.format,
	output: 'png' | 'jpeg' = 'png',
): Promise<RenderedCover> {
	const effectiveConfig = { ...config, format };
	const layout = coverLayout(format);
	const template = COVER_TEMPLATES[config.templateId];
	const overlay = Buffer.from(buildCoverSvg(effectiveConfig, template, layout));
	const base = await coverBase(source, effectiveConfig, layout);
	let pipeline = base.composite([{ input: overlay, top: 0, left: 0 }]);
	if (output === 'jpeg') pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
	else pipeline = pipeline.png({ compressionLevel: 9 });
	const buffer = await pipeline.toBuffer();
	return {
		buffer,
		width: layout.width,
		height: layout.height,
		mimeType: output === 'jpeg' ? 'image/jpeg' : 'image/png',
		extension: output === 'jpeg' ? 'jpg' : 'png',
	};
}

export function coverOutputDimensions(format: CoverFormatId): { width: number; height: number } {
	return COVER_FORMATS[format];
}
