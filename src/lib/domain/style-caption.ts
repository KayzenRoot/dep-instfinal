import type { CaptionSafeZone, CaptionStyle, CaptionTrack } from '#lib/schemas/captions.js';
import type { StyleFontFamily, StyleSnapshot } from '#lib/schemas/style-bible.js';

const ASS_FONTS: Record<StyleFontFamily, string> = {
	serif: 'DejaVu Serif',
	sans: 'DejaVu Sans',
	mono: 'DejaVu Sans Mono',
	display: 'DejaVu Sans',
};

export function assFontForStyle(fontFamily: StyleFontFamily | undefined): string | null {
	return fontFamily ? ASS_FONTS[fontFamily] : null;
}

export function applyStyleToCaptionTrack(
	track: CaptionTrack,
	styleBible: StyleSnapshot | null | undefined,
): CaptionTrack {
	if (!styleBible) return track;
	const style: CaptionStyle = styleBible.config.captionTemplate === 'horror' ? 'vhs' : 'clean';
	const safeZone: CaptionSafeZone = styleBible.config.captionSafeZone;
	return { ...track, style, safeZone };
}
