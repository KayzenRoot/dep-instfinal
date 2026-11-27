export const GLYPH_NAMES = [
	'archive',
	'book',
	'film',
	'frames',
	'library',
	'branch',
	'export',
	'settings',
	'menu',
	'close',
] as const;

export type GlyphName = (typeof GLYPH_NAMES)[number];
