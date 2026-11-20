import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { COVER_TEMPLATES } from './cover.js';
import type { CoverConfig } from '#lib/schemas/cover.js';

export const COVER_HASH_VERSION = 1;
export const COVER_RENDERER_VERSION = 1;

/**
 * Fingerprint of the config plus the template parameters and renderer version.
 * A visual or algorithm change must add a new versioned hasher so stored
 * revisions remain readable with the version recorded in `hash_version`.
 */
export function coverConfigHashV1(config: CoverConfig): string {
	return createHash('sha256')
		.update(
			canonicalJson({
				hashVersion: 1,
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

const COVER_HASHERS: Record<number, (config: CoverConfig) => string> = {
	1: coverConfigHashV1,
};

export function coverConfigHash(config: CoverConfig, hashVersion = COVER_HASH_VERSION): string {
	const hasher = COVER_HASHERS[hashVersion];
	if (!hasher) throw new Error(`unsupported cover hash version: ${hashVersion}`);
	return hasher(config);
}
