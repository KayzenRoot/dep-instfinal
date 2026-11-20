import { createHash } from 'node:crypto';
import { STYLE_BIBLE_VERSION, type StyleConfig } from '#lib/schemas/style-bible.js';
import { canonicalJson } from './canonical-json.js';

export const STYLE_HASH_VERSION = 1;

export function styleConfigHash(config: StyleConfig): string {
	return createHash('sha256')
		.update(
			canonicalJson({
				hashVersion: STYLE_HASH_VERSION,
				bibleVersion: STYLE_BIBLE_VERSION,
				config,
			}),
		)
		.digest('hex');
}
