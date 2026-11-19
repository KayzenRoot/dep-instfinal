import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { COVER_TEMPLATES } from './cover.js';
import type { CoverConfig } from '#lib/schemas/cover.js';

export const COVER_HASH_VERSION = 1;
export const COVER_RENDERER_VERSION = 1;

/**
 * Fingerprint of the config plus the template parameters and renderer version.
 * A visual template change must bump the version, which invalidates old hashes.
 */
export function coverConfigHash(config: CoverConfig): string {
	return createHash('sha256')
		.update(
			canonicalJson({
				hashVersion: COVER_HASH_VERSION,
				rendererVersion: COVER_RENDERER_VERSION,
				config,
				template: {
					version: COVER_TEMPLATES[config.templateId].version,
					treatment: COVER_TEMPLATES[config.templateId].treatment,
					background: COVER_TEMPLATES[config.templateId].background,
					overlayTop: COVER_TEMPLATES[config.templateId].overlayTop,
					overlayBottom: COVER_TEMPLATES[config.templateId].overlayBottom,
					titleColor: COVER_TEMPLATES[config.templateId].titleColor,
					subtitleColor: COVER_TEMPLATES[config.templateId].subtitleColor,
					badgeBackground: COVER_TEMPLATES[config.templateId].badgeBackground,
					badgeColor: COVER_TEMPLATES[config.templateId].badgeColor,
					accent: COVER_TEMPLATES[config.templateId].accent,
				},
			}),
		)
		.digest('hex');
}
