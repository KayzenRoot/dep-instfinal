import { PassThrough, Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { loadChoiceEndCard, loadChoiceEndCardContext } from '#lib/server/choice-end-card.js';
import { buildEndCardAss, buildEndCardSfxWav } from '#lib/domain/choice-end-card.js';
import { choiceSetHash } from '#lib/domain/choice-end-card-hash.js';
import { PLATFORM_PREVIEW_PROFILES } from '#lib/domain/platform-preview.js';

const PROFILES = ['tiktok', 'reels', 'clean'] as const;
type ProfileId = (typeof PROFILES)[number];

function fileBase(templateId: string, layout: string): string {
	return `final-ab-${templateId}-${layout}`;
}

function fileResponse(
	body: BodyInit,
	contentType: string,
	filename: string,
	download: boolean,
): Response {
	return new Response(body, {
		headers: {
			'content-type': contentType,
			'cache-control': 'private, no-store',
			'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
			'x-content-type-options': 'nosniff',
		},
	});
}

export const GET: RequestHandler = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const revision = await loadChoiceEndCard(db, owner, event.params.revisionId);
	if (!revision) error(404, 'Final A/B não encontrado.');
	const context = await loadChoiceEndCardContext(db, owner, revision.episodeId);
	if (!context) error(404, 'Episódio do final A/B não encontrado.');
	if (
		context.choiceRevisionNumber !== revision.choiceRevisionNumber ||
		context.choices.length !== 2 ||
		choiceSetHash(context.choices) !== choiceSetHash(revision.choices)
	)
		error(
			409,
			'O roteiro ou as escolhas mudaram. Revise e aprove um novo final A/B antes de exportar.',
		);
	const requestedProfile = event.url.searchParams.get('profile') ?? 'tiktok';
	const profile = (PROFILES as readonly string[]).includes(requestedProfile)
		? (requestedProfile as ProfileId)
		: 'tiktok';
	const format = event.url.searchParams.get('format') ?? 'ass';
	const download = event.url.searchParams.get('download') === '1';
	const base = fileBase(revision.config.templateId, revision.config.layout);
	const safeArea = PLATFORM_PREVIEW_PROFILES[profile].safeArea;
	let ass: string;
	try {
		ass = buildEndCardAss(
			{
				...revision.config,
				cardId: revision.id,
				cardRevision: revision.revision,
				choiceRevisionNumber: revision.choiceRevisionNumber,
				startMs: 0,
				endMs: revision.config.durationMs,
				choices: revision.choices,
			},
			safeArea,
		);
	} catch {
		error(409, 'O texto do final A/B não cabe na área segura deste perfil.');
	}
	const payload = {
		schemaVersion: 1,
		revisionId: revision.id,
		revision: revision.revision,
		status: revision.status,
		episodeId: revision.episodeId,
		choiceRevisionNumber: revision.choiceRevisionNumber,
		config: revision.config,
		choices: revision.choices,
		profile,
		safeArea,
	};
	const wav = buildEndCardSfxWav(
		revision.config.sfx,
		revision.config.durationMs,
		revision.config.sfxVolumeDb,
	);

	if (format === 'json')
		return fileResponse(
			JSON.stringify(payload, null, 2),
			'application/json; charset=utf-8',
			`${base}.json`,
			download,
		);
	if (format === 'wav') {
		if (!wav) error(404, 'Este final A/B está configurado sem SFX.');
		return fileResponse(wav as unknown as BodyInit, 'audio/wav', `${base}.wav`, download);
	}
	if (format === 'zip') {
		const stream = new PassThrough();
		const archive = new ZipArchive({ zlib: { level: 6 } });
		archive.on('error', (cause: Error) => stream.destroy(cause));
		archive.pipe(stream);
		archive.append(ass, { name: `${base}.ass` });
		archive.append(JSON.stringify(payload, null, 2), { name: `${base}.json` });
		if (wav) archive.append(wav, { name: `${base}.wav` });
		void archive.finalize();
		return fileResponse(
			Readable.toWeb(stream) as ReadableStream,
			'application/zip',
			`${base}.zip`,
			true,
		);
	}
	if (format !== 'ass') error(400, 'Formato de final A/B inválido.');
	return fileResponse(ass, 'text/plain; charset=utf-8', `${base}.ass`, download);
};
