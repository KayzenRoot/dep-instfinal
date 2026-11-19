import { PassThrough, Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadCoverRevision } from '#lib/server/cover.js';
import {
	MAX_COVER_RESPONSE_BYTES,
	coverResponseExceedsLimit,
	renderCover,
} from '#lib/server/cover-render.js';
import { loadCoverSource } from '#lib/server/cover-source.js';
import { coverFileBase } from '#lib/domain/cover.js';
import { COVER_FORMATS, coverFormatIdSchema, type CoverFormatId } from '#lib/schemas/cover.js';

const FORMAT_IDS = Object.keys(COVER_FORMATS) as CoverFormatId[];

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const revision = await loadCoverRevision(db, owner, event.params.revisionId);
	if (!revision) error(404, 'Capa não encontrada.');
	const requested = event.url.searchParams.get('format') ?? '9:16';
	const output = event.url.searchParams.get('output') === 'jpeg' ? 'jpeg' : 'png';
	const download = event.url.searchParams.get('download') === '1';
	const preview = event.url.searchParams.get('preview') === '1';
	const scale = preview ? 0.35 : 1;
	const source = await loadCoverSource(db, owner.id, revision.config.frameAssetId);
	if (revision.config.frameAssetId && !source)
		error(
			409,
			'O frame privado vinculado está indisponível. Verifique a biblioteca ou gere uma capa sem frame.',
		);
	const base = `${coverFileBase({ ...revision.config, format: '4:5' }).replace(/-4x5$/, '')}`;

	try {
		if (requested === 'zip') {
			const buffers: Buffer[] = [];
			for (const format of FORMAT_IDS) {
				const rendered = await renderCover(revision.config, source, format, output, scale);
				buffers.push(rendered.buffer);
			}
			if (coverResponseExceedsLimit(buffers))
				error(
					413,
					'O ZIP ultrapassa o limite de resposta. Baixe os formatos individualmente em JPEG.',
				);
			const stream = new PassThrough();
			const archive = new ZipArchive({ zlib: { level: 6 } });
			archive.on('error', (cause: Error) => stream.destroy(cause));
			archive.pipe(stream);
			const extension = output === 'jpeg' ? 'jpg' : 'png';
			for (const [index, format] of FORMAT_IDS.entries()) {
				archive.append(buffers[index]!, {
					name: `${base}-${format.replace(':', 'x')}.${extension}`,
				});
			}
			void archive.finalize();
			return new Response(Readable.toWeb(stream) as ReadableStream, {
				headers: {
					'content-type': 'application/zip',
					'cache-control': 'private, no-store',
					'content-disposition': `attachment; filename="${base}.zip"`,
					'x-content-type-options': 'nosniff',
				},
			});
		}

		const parsed = coverFormatIdSchema.safeParse(requested);
		if (!parsed.success) error(400, 'Formato de capa inválido.');
		const rendered = await renderCover(revision.config, source, parsed.data, output, scale);
		if (rendered.buffer.length > MAX_COVER_RESPONSE_BYTES)
			error(413, 'A capa ultrapassa o limite de resposta. Baixe em JPEG ou use um frame menor.');
		return new Response(rendered.buffer as unknown as BodyInit, {
			headers: {
				'content-type': rendered.mimeType,
				'cache-control': 'private, no-store',
				'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${base}-${parsed.data.replace(':', 'x')}.${rendered.extension}"`,
				'x-content-type-options': 'nosniff',
			},
		});
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		error(502, 'Não foi possível renderizar a capa.');
	}
};
