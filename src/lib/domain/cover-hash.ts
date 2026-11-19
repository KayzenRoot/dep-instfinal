import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import type { CoverConfig } from '#lib/schemas/cover.js';

export function coverConfigHash(config: CoverConfig): string {
	return createHash('sha256').update(canonicalJson(config)).digest('hex');
}
