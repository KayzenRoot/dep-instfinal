import { PassThrough, Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadCoverRevision } from '#lib/server/cover.js';
import { renderCover } from '#lib/server/cover-render.js';
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
	const source = await loadCoverSource(db, owner.id, revision.config.frameAssetId);
	const base = coverFileBase(revision.config);

	if (requested === 'zip') {
		const stream = new PassThrough();
		const archive = new ZipArchive({ zlib: { level: 6 } });
		archive.on('error', (cause: Error) => stream.destroy(cause));
		archive.pipe(stream);
		for (const format of FORMAT_IDS) {
			const rendered = await renderCover(revision.config, source, format, output);
			archive.append(rendered.buffer, {
				name: `${base}-${format.replace(':', 'x')}.${rendered.extension}`,
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
	const rendered = await renderCover(revision.config, source, parsed.data, output);
	return new Response(rendered.buffer as unknown as BodyInit, {
		headers: {
			'content-type': rendered.mimeType,
			'cache-control': 'private, no-store',
			'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${base}-${parsed.data.replace(':', 'x')}.${rendered.extension}"`,
			'x-content-type-options': 'nosniff',
		},
	});
};
