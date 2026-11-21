/** Pure schema-probe classification shared by the release smoke and its tests. */
/** @param {number} status @param {any} body */
export function classifyKeyPreflight(status, body) {
	if (
		status === 401 &&
		(!body?.code ||
			String(body?.message ?? '')
				.toLowerCase()
				.includes('api key'))
	)
		return 'invalid';
	if (status === 200) return 'valid';
	if ([401, 403].includes(status) && body?.code) return 'valid';
	return 'unknown';
}

/** @param {number} status @param {any} body */
export function classifyTableProbe(status, body) {
	if (status === 200) return 'present';
	if (status === 404 && body?.code === 'PGRST205') return 'missing';
	if ([401, 403].includes(status) && body?.code && body.code !== 'PGRST205') return 'present';
	return 'unknown';
}
