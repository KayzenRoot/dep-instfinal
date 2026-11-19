import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { identityBundleJson, loadCharacterIdentityDetail } from '#lib/server/character-identity.js';
import { buildIdentityChecklistMarkdown } from '#lib/domain/character-identity.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const format = event.url.searchParams.get('format') ?? 'json';
	if (format !== 'json' && format !== 'md') error(400, 'Formato inválido.');
	const detail = await loadCharacterIdentityDetail(db, owner, event.params.characterId);
	if (!detail?.profile || !detail.version) error(404, 'Perfil de identidade não encontrado.');
	const episodeId = event.url.searchParams.get('episodeId');
	let episodeNumber = 1;
	if (episodeId) {
		const { data: episode } = await db
			.from('episodes')
			.select('episode_number')
			.eq('owner_id', owner.id)
			.eq('id', episodeId)
			.maybeSingle();
		if (episode) episodeNumber = Number(episode.episode_number);
	}
	const record = {
		characterId: detail.characterId,
		name: detail.name,
		version: detail.version,
		profile: detail.profile,
	};
	const base = `identity-${
		detail.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'character'
	}-v${detail.version}`;
	if (format === 'md') {
		const body = buildIdentityChecklistMarkdown(detail.seriesTitle, [record], episodeNumber);
		return new Response(body, {
			headers: {
				'content-type': 'text/markdown; charset=utf-8',
				'cache-control': 'private, no-store',
				'content-disposition': `attachment; filename="${base}.md"`,
				'x-content-type-options': 'nosniff',
			},
		});
	}
	const payload = identityBundleJson(detail.seriesTitle, episodeNumber, [record]);
	return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store',
			'content-disposition': `attachment; filename="${base}.json"`,
			'x-content-type-options': 'nosniff',
		},
	});
};
