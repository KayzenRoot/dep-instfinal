/**
 * Vercel Functions have a 4.5 MB response cap. Keep ample overhead for
 * captions, scene prompts, the manifest and zip entry headers.
 * JPEG/PNG/WebP bytes rarely compress in a ZIP, so compare RAW frame bytes.
 */
export const MAX_EMBEDDED_ZIP_MEDIA_BYTES = 3_000_000;

/** The same frame can appear in multiple scene positions, so count each attachment. */
export function exceedsZipMediaBudget(sizes: readonly number[], limit = MAX_EMBEDDED_ZIP_MEDIA_BYTES): boolean {
	let total = 0;
	for (const size of sizes) {
		if (!Number.isSafeInteger(size) || size <= 0) return true;
		total += size;
		if (total > limit) return true;
	}
	return false;
}
