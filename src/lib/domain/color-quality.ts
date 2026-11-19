export interface ColorStats {
	frameCount: number;
	meanLuma: number;
	p05Luma: number;
	p95Luma: number;
	lowClipPct: number;
	highClipPct: number;
	meanSaturation: number;
}

export interface ColorRangeAssessment {
	status: 'PASS' | 'WARN';
	severe: boolean;
	message: string;
}

const LOW_CLIP_LUMA = 2;
const HIGH_CLIP_LUMA = 253;
const CLIP_WARN_PCT = 20;

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
	const target = Math.min(total - 1, Math.max(0, Math.floor(total * fraction)));
	let seen = 0;
	for (let value = 0; value < histogram.length; value += 1) {
		seen += histogram[value] ?? 0;
		if (seen > target) return value;
	}
	return histogram.length - 1;
}

/** Summarize decoded RGB24 frames sampled from a video. */
export function summarizeRgbFrames(buffer: Buffer, width: number, height: number): ColorStats {
	const frameBytes = width * height * 3;
	const frameCount = Math.floor(buffer.length / frameBytes);
	if (frameCount === 0) throw new Error('Nenhum frame RGB completo para analisar.');
	const histogram = new Uint32Array(256);
	let lumaSum = 0;
	let saturationSum = 0;
	let lowClip = 0;
	let highClip = 0;
	const pixels = frameCount * width * height;
	for (let frame = 0; frame < frameCount; frame += 1) {
		const offset = frame * frameBytes;
		for (let pixel = 0; pixel < width * height; pixel += 1) {
			const index = offset + pixel * 3;
			const red = buffer[index] ?? 0;
			const green = buffer[index + 1] ?? 0;
			const blue = buffer[index + 2] ?? 0;
			const luma = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
			histogram[luma] = (histogram[luma] ?? 0) + 1;
			lumaSum += luma;
			if (luma <= LOW_CLIP_LUMA) lowClip += 1;
			if (luma >= HIGH_CLIP_LUMA) highClip += 1;
			const maximum = Math.max(red, green, blue);
			const minimum = Math.min(red, green, blue);
			if (maximum > 0) saturationSum += (maximum - minimum) / maximum;
		}
	}
	return {
		frameCount,
		meanLuma: lumaSum / pixels,
		p05Luma: percentile(histogram, pixels, 0.05),
		p95Luma: percentile(histogram, pixels, 0.95),
		lowClipPct: (lowClip / pixels) * 100,
		highClipPct: (highClip / pixels) * 100,
		meanSaturation: (saturationSum / pixels) * 100,
	};
}

/** Warn when a graded render spends too much of its range in the clipping extremes. */
export function assessColorRange(stats: ColorStats): ColorRangeAssessment {
	const severe = stats.lowClipPct >= CLIP_WARN_PCT || stats.highClipPct >= CLIP_WARN_PCT;
	const combined = stats.lowClipPct + stats.highClipPct;
	return {
		status: severe ? 'WARN' : 'PASS',
		severe,
		message: severe
			? `Faixa tonal com clipping severo: ${stats.lowClipPct.toFixed(1)}% em sombras e ${stats.highClipPct.toFixed(1)}% em altas luzes.`
			: `Faixa tonal preservada: ${combined.toFixed(1)}% de pixels nos extremos.`,
	};
}

/** Compare before/after fixtures and flag shadow crush or clipping growth. */
export function compareColorRange(
	before: ColorStats,
	after: ColorStats,
): {
	shadowCrush: boolean;
	highlightCrush: boolean;
	lowClipGrowth: number;
	highClipGrowth: number;
} {
	return {
		shadowCrush: before.p05Luma >= 4 && after.p05Luma <= 2,
		highlightCrush: before.p95Luma <= 251 && after.p95Luma >= 253,
		lowClipGrowth: after.lowClipPct - before.lowClipPct,
		highClipGrowth: after.highClipPct - before.highClipPct,
	};
}
