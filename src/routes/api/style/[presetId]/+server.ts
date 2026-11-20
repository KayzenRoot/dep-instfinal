import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { exportStylePreset, StyleServiceError } from '#lib/server/style-bible.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	try {
		const payload = await exportStylePreset(db, owner, event.params.presetId);
		const download = event.url.searchParams.get('download') === '1';
		const filename = `dif-style-${
			payload.name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '') || 'preset'
		}-v${payload.revision}.json`;
		return new Response(JSON.stringify(payload, null, 2), {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'private, no-store',
				'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
				'x-content-type-options': 'nosniff',
			},
		});
	} catch (cause) {
		if (cause instanceof StyleServiceError) {
			error(cause.status === 404 ? 404 : cause.status === 403 ? 403 : 503, cause.message);
		}
		throw cause;
	}
};
