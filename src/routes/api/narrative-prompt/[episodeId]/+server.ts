import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renderNarrativePrompt } from '#lib/domain/narrative-context.js';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadNarrativeContext } from '#lib/server/narrative-context.js';

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const branchValue = event.url.searchParams.get('branch') ?? 'canonical';
	if (!['canonical', '1', '2'].includes(branchValue)) error(400, 'Ramo narrativo inválido.');
	const wpmValue = Number(event.url.searchParams.get('wpm') ?? 145);
	if (!Number.isInteger(wpmValue) || wpmValue < 80 || wpmValue > 220)
		error(400, 'Informe uma velocidade entre 80 e 220 palavras por minuto.');
	let context;
	try {
		context = await loadNarrativeContext(
			db,
			owner.id,
			event.params.episodeId,
			branchValue === '1' || branchValue === '2' ? branchValue : undefined,
		);
	} catch {
		error(404, 'Episódio ou contexto não encontrado para este proprietário.');
	}
	if ((branchValue === '1' || branchValue === '2') && !context.hypotheticalBranch)
		error(409, 'O episódio anterior ainda não contém duas opções de continuação.');
	return new Response(renderNarrativePrompt(context, wpmValue), {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'content-disposition': `attachment; filename="dif-episode-${event.params.episodeId}-narrative-prompt-${branchValue}.md"`,
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff',
		},
	});
};
