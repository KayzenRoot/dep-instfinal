import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { COVER_TEMPLATES } from './cover.js';
import type { CoverConfig } from '#lib/schemas/cover.js';

export const COVER_RENDERER_VERSION = 1;

/**
 * Fingerprint of the config plus the template parameters and renderer version.
 * A visual template change must bump the version, which invalidates old hashes.
 */
export function coverConfigHash(config: CoverConfig): string {
	return createHash('sha256')
		.update(
			canonicalJson({
				rendererVersion: COVER_RENDERER_VERSION,
				config,
				template: COVER_TEMPLATES[config.templateId],
			}),
		)
		.digest('hex');
}
