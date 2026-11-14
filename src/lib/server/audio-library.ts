import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { VideoStorage } from './video-storage.js';
import { measureAudioLoudness, probeAudioFile } from './audio-analysis.js';
import {
	audioAssetMetadataSchema,
	type AudioAsset,
	type AudioKind,
} from '#lib/schemas/audio-library.js';

export class AudioLibraryError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'AudioLibraryError';
	}
}

interface AudioAssetRow {
	id: string;
	kind: AudioKind;
	title: string;
	author: string;
	source: string;
	license_name: string;
	license_url: string | null;
	attribution: string;
	commercial_allowed: boolean;
	social_allowed: boolean;
	license_status: AudioAsset['licenseStatus'];
	tags: string[];
	intensity: number;
	sha256: string;
	byte_size: number;
	duration_ms: number;
	format: string;
	sample_rate: number;
	channels: number;
	peak_db: number | null;
	true_peak_db: number | null;
	lufs: number | null;
	created_at: string;
}

function mapRow(row: AudioAssetRow): AudioAsset {
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		author: row.author,
		source: row.source,
		licenseName: row.license_name,
		licenseUrl: row.license_url,
		attribution: row.attribution,
		commercialAllowed: row.commercial_allowed,
		socialAllowed: row.social_allowed,
		licenseStatus: row.license_status,
		tags: row.tags,
		intensity: row.intensity,
		sha256: row.sha256,
		byteSize: Number(row.byte_size),
		durationMs: row.duration_ms,
		format: row.format,
		sampleRate: row.sample_rate,
		channels: row.channels,
		peakDb: row.peak_db === null ? null : Number(row.peak_db),
		truePeakDb: row.true_peak_db === null ? null : Number(row.true_peak_db),
		lufs: row.lufs === null ? null : Number(row.lufs),
		createdAt: row.created_at,
	};
}

const AUDIO_COLUMNS =
	'id,kind,title,author,source,license_name,license_url,attribution,commercial_allowed,social_allowed,license_status,tags,intensity,sha256,byte_size,duration_ms,format,sample_rate,channels,peak_db,true_peak_db,lufs,created_at';

export { isAudioExportable } from '#lib/domain/audio-events.js';

export async function listAudioAssets(
	db: SupabaseClient,
	owner: User,
	filter: { kind?: AudioKind | null; tag?: string | null } = {},
): Promise<AudioAsset[]> {
	let query = db.from('audio_assets').select(AUDIO_COLUMNS).eq('owner_id', owner.id);
	if (filter.kind) query = query.eq('kind', filter.kind);
	if (filter.tag) query = query.contains('tags', [filter.tag]);
	const { data, error } = await query.order('created_at', { ascending: false });
	if (error)
		throw new AudioLibraryError(
			503,
			'AUDIO_LIBRARY_LOAD_FAILED',
			'Não foi possível carregar a biblioteca de áudio.',
		);
	return (data ?? []).map((row) => mapRow(row as AudioAssetRow));
}

export async function loadAudioAssets(
	db: SupabaseClient,
	ownerId: string,
	ids: string[],
): Promise<AudioAsset[]> {
	if (!ids.length) return [];
	const uniqueIds = [...new Set(ids)];
	const { data, error } = await db
		.from('audio_assets')
		.select(AUDIO_COLUMNS)
		.eq('owner_id', ownerId)
		.in('id', uniqueIds);
	if (error)
		throw new AudioLibraryError(
			503,
			'AUDIO_LIBRARY_LOAD_FAILED',
			'Não foi possível carregar os áudios.',
		);
	return (data ?? []).map((row) => mapRow(row as AudioAssetRow));
}

export async function storeAudioAsset(input: {
	adminDb: SupabaseClient | null;
	owner: User;
	storage: VideoStorage;
	bytes: Buffer;
	fileName: string;
	metadata: unknown;
}): Promise<AudioAsset> {
	if (!input.adminDb)
		throw new AudioLibraryError(
			503,
			'AUDIO_WRITER_UNAVAILABLE',
			'O writer de áudio não está configurado.',
		);
	const parsedMetadata = audioAssetMetadataSchema.safeParse(input.metadata);
	if (!parsedMetadata.success)
		throw new AudioLibraryError(400, 'AUDIO_METADATA_INVALID', 'Metadados de licença inválidos.');
	if (input.bytes.length < 100 || input.bytes.length > 25 * 1024 * 1024)
		throw new AudioLibraryError(413, 'AUDIO_TOO_LARGE', 'O áudio excede o limite de 25 MB.');
	if (!/\.(wav|mp3|m4a|ogg)$/i.test(input.fileName))
		throw new AudioLibraryError(415, 'AUDIO_FORMAT_INVALID', 'Envie WAV, MP3, M4A ou OGG.');
	const extension = input.fileName.split('.').at(-1)?.toLowerCase() ?? 'wav';
	const directory = await mkdtemp(join(tmpdir(), 'dif-audio-library-'));
	const localPath = join(directory, input.fileName.replace(/[^A-Za-z0-9._-]/g, '_'));
	try {
		await writeFile(localPath, input.bytes);
		let probe;
		try {
			probe = await probeAudioFile(localPath);
		} catch {
			throw new AudioLibraryError(422, 'AUDIO_INVALID', 'O áudio não pôde ser lido.');
		}
		if (probe.durationMs < 100 || probe.durationMs > 600_000)
			throw new AudioLibraryError(422, 'AUDIO_DURATION_INVALID', 'Duração do áudio inválida.');
		if (probe.channels < 1 || probe.channels > 2 || probe.sampleRate < 8_000)
			throw new AudioLibraryError(422, 'AUDIO_FORMAT_INVALID', 'Formato de áudio inválido.');
		const expectedFormats =
			extension === 'mp3'
				? ['mp3']
				: extension === 'm4a'
					? ['mp4', 'm4a', 'mov']
					: extension === 'ogg'
						? ['ogg']
						: ['wav'];
		if (!expectedFormats.some((format) => probe.format.toLowerCase().includes(format)))
			throw new AudioLibraryError(
				415,
				'AUDIO_FORMAT_MISMATCH',
				'A extensão não corresponde ao formato real do áudio.',
			);
		const loudness = await measureAudioLoudness(localPath);
		if (loudness.peakDb === null && loudness.truePeakDb === null)
			throw new AudioLibraryError(
				422,
				'AUDIO_LOUDNESS_FAILED',
				'Não foi possível medir o nível do áudio.',
			);
		if (
			(loudness.truePeakDb !== null && loudness.truePeakDb > -0.5) ||
			(loudness.peakDb !== null && loudness.peakDb > -0.5)
		)
			throw new AudioLibraryError(422, 'AUDIO_CLIPPING', 'O áudio está com clipping.');
		if (loudness.peakDb !== null && loudness.peakDb < -60)
			throw new AudioLibraryError(422, 'AUDIO_SILENT', 'O áudio não tem sinal audível.');

		const sha256 = createHash('sha256').update(input.bytes).digest('hex');
		const { data: duplicate, error: duplicateError } = await input.adminDb
			.from('audio_assets')
			.select('id')
			.eq('owner_id', input.owner.id)
			.eq('sha256', sha256)
			.maybeSingle();
		if (duplicateError)
			throw new AudioLibraryError(
				503,
				'AUDIO_DUPLICATE_CHECK_FAILED',
				'Não foi possível verificar duplicatas.',
			);
		if (duplicate)
			throw new AudioLibraryError(409, 'AUDIO_DUPLICATE', 'Este áudio já existe na biblioteca.');

		const assetId = crypto.randomUUID();
		const contentType =
			extension === 'mp3'
				? 'audio/mpeg'
				: extension === 'm4a'
					? 'audio/mp4'
					: extension === 'ogg'
						? 'audio/ogg'
						: 'audio/wav';
		const key = `audio/${input.owner.id}/${assetId}.${extension}`;
		const stored = await input.storage.putObject({
			key,
			body: input.bytes,
			contentType,
		});
		const { data, error } = await input.adminDb
			.from('audio_assets')
			.insert({
				id: assetId,
				owner_id: input.owner.id,
				kind: parsedMetadata.data.kind,
				title: parsedMetadata.data.title,
				author: parsedMetadata.data.author,
				source: parsedMetadata.data.source,
				license_name: parsedMetadata.data.licenseName,
				license_url: parsedMetadata.data.licenseUrl,
				attribution: parsedMetadata.data.attribution,
				commercial_allowed: parsedMetadata.data.commercialAllowed,
				social_allowed: parsedMetadata.data.socialAllowed,
				license_status: parsedMetadata.data.licenseStatus,
				tags: parsedMetadata.data.tags,
				intensity: parsedMetadata.data.intensity,
				bucket: stored.bucket,
				object_key: stored.key,
				sha256,
				byte_size: stored.size,
				duration_ms: probe.durationMs,
				format: probe.format,
				sample_rate: probe.sampleRate,
				channels: probe.channels,
				peak_db: loudness.peakDb,
				true_peak_db: loudness.truePeakDb,
				lufs: loudness.lufs,
			})
			.select(AUDIO_COLUMNS)
			.single();
		if (error || !data) {
			await input.storage.deleteObject(key).catch(() => undefined);
			throw new AudioLibraryError(503, 'AUDIO_SAVE_FAILED', 'Não foi possível registrar o áudio.');
		}
		return mapRow(data as AudioAssetRow);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function getAudioAssetDownload(input: {
	db: SupabaseClient;
	owner: User;
	storage: VideoStorage;
	assetId: string;
}): Promise<{ url: string; asset: AudioAsset }> {
	if (!/^[0-9a-f-]{36}$/i.test(input.assetId))
		throw new AudioLibraryError(404, 'AUDIO_NOT_FOUND', 'Áudio não encontrado.');
	const { data, error } = await input.db
		.from('audio_assets')
		.select(`${AUDIO_COLUMNS},object_key`)
		.eq('owner_id', input.owner.id)
		.eq('id', input.assetId)
		.maybeSingle();
	if (error)
		throw new AudioLibraryError(503, 'AUDIO_LOAD_FAILED', 'Não foi possível carregar o áudio.');
	if (!data) throw new AudioLibraryError(404, 'AUDIO_NOT_FOUND', 'Áudio não encontrado.');
	const asset = mapRow(data as AudioAssetRow);
	const url = await input.storage.signDownload(
		String((data as { object_key: string }).object_key),
		60,
	);
	return { url, asset };
}
