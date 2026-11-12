import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AppConfig } from './config.js';
import type { SignedPart, StoredObject, VideoStorage } from './video-storage.js';
import { finalVideoObjectKey, quarantineObjectKey } from './video-storage.js';
import { hasMp4Magic, validateProbe, type VideoProbe } from './video-probe.js';

export const VIDEO_OWNER_QUOTA_BYTES = 10_000_000_000;
export const VIDEO_OWNER_QUOTA_BLOCK_BYTES = 9_500_000_000;
export const VIDEO_EPISODE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const VIDEO_MAX_CLIPS_PER_EPISODE = 15;
const RETENTION_DAYS = 30;

export class VideoAssetError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'VideoAssetError';
	}
}

interface SessionRow {
	id: string;
	owner_id: string;
	episode_id: string;
	scene_id: string;
	asset_id: string;
	idempotency_key: string;
	r2_upload_id: string | null;
	quarantine_key: string;
	part_size_bytes: number;
	total_bytes: number;
	status: string;
	expires_at: string;
	uploaded_parts: Array<{ partNumber: number; etag: string }> | null;
	file_sha256: string | null;
}

interface AssetRow {
	id: string;
	episode_id: string;
	scene_id: string;
	asset_version: number;
	bucket: string;
	object_key: string;
	poster_key: string | null;
	sha256: string | null;
	byte_size: number | null;
	duration_ms: number | null;
	width: number | null;
	height: number | null;
	codec: string | null;
	container: string | null;
	status: string;
	safe_error_code: string | null;
	created_at: string;
	scenes?: { scene_index: number } | null;
}

function sumBytes(rows: Array<{ byte_size?: number | null; total_bytes?: number | null }>): number {
	return rows.reduce((total, row) => total + (row.byte_size ?? row.total_bytes ?? 0), 0);
}

function contentTypeIsVideo(value: string): boolean {
	return value === '' || value.startsWith('video/') || value === 'application/octet-stream';
}

async function signAllParts(
	storage: VideoStorage,
	session: Pick<
		SessionRow,
		'quarantine_key' | 'r2_upload_id' | 'total_bytes' | 'part_size_bytes' | 'uploaded_parts'
	>,
): Promise<SignedPart[]> {
	if (!session.r2_upload_id)
		throw new VideoAssetError(409, 'UPLOAD_NOT_STARTED', 'Upload ainda não iniciado.');
	const confirmed = new Set((session.uploaded_parts ?? []).map((part) => part.partNumber));
	const count = Math.ceil(session.total_bytes / session.part_size_bytes);
	const parts: SignedPart[] = [];
	for (let partNumber = 1; partNumber <= count; partNumber += 1) {
		if (confirmed.has(partNumber)) continue;
		parts.push(
			await storage.signPart({
				key: session.quarantine_key,
				uploadId: session.r2_upload_id,
				partNumber,
			}),
		);
	}
	return parts;
}

function requireSessionWriter(adminDb: SupabaseClient | null | undefined): SupabaseClient {
	if (!adminDb)
		throw new VideoAssetError(
			503,
			'VIDEO_SESSION_WRITE_UNAVAILABLE',
			'O storage de sessão não está configurado no servidor.',
		);
	return adminDb;
}

async function loadSession(
	db: SupabaseClient,
	ownerId: string,
	sessionId: string,
	adminDb?: SupabaseClient | null,
): Promise<SessionRow> {
	const { data, error } = await db
		.from('video_upload_sessions')
		.select(
			'id,owner_id,episode_id,scene_id,asset_id,idempotency_key,r2_upload_id,quarantine_key,part_size_bytes,total_bytes,status,expires_at,uploaded_parts,file_sha256',
		)
		.eq('id', sessionId)
		.eq('owner_id', ownerId)
		.maybeSingle();
	if (error || !data)
		throw new VideoAssetError(404, 'UPLOAD_NOT_FOUND', 'Sessão de upload não encontrada.');
	const session = data as SessionRow;
	if (session.quarantine_key !== quarantineObjectKey(ownerId, session.id))
		throw new VideoAssetError(
			409,
			'UPLOAD_SESSION_INVALID',
			'A sessão de upload tem uma chave inválida.',
		);
	if (new Date(session.expires_at).getTime() < Date.now() && session.status !== 'COMPLETED') {
		await (adminDb ?? db)
			.from('video_upload_sessions')
			.update({ status: 'EXPIRED', safe_error_code: 'UPLOAD_SESSION_EXPIRED' })
			.eq('id', session.id)
			.eq('owner_id', ownerId);
		throw new VideoAssetError(410, 'UPLOAD_EXPIRED', 'A sessão de upload expirou.');
	}
	return session;
}

async function nextAssetVersion(
	db: SupabaseClient,
	ownerId: string,
	episodeId: string,
	sceneId: string,
): Promise<number> {
	const { data, error } = await db
		.from('video_assets')
		.select('asset_version')
		.eq('owner_id', ownerId)
		.eq('episode_id', episodeId)
		.eq('scene_id', sceneId)
		.order('asset_version', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error)
		throw new VideoAssetError(
			503,
			'VIDEO_VERSION_LOOKUP_FAILED',
			'Não foi possível calcular a versão do clipe.',
		);
	return (data?.asset_version ?? 0) + 1;
}

export async function createUploadSession(input: {
	db: SupabaseClient;
	adminDb?: SupabaseClient | null;
	owner: User;
	config: AppConfig;
	storage: VideoStorage;
	episodeId: string;
	sceneId: string;
	fileName: string;
	byteSize: number;
	contentType: string;
	idempotencyKey: string;
	fileSha256: string;
}): Promise<{
	sessionId: string;
	assetId: string;
	bucket: string;
	key: string;
	uploadId: string;
	partSizeBytes: number;
	parts: SignedPart[];
	resumed: boolean;
}> {
	const { db, owner, config, storage } = input;
	const sessionDb = requireSessionWriter(input.adminDb);
	if (
		!Number.isInteger(input.byteSize) ||
		input.byteSize < 1 ||
		input.byteSize > config.maxVideoBytes
	)
		throw new VideoAssetError(413, 'VIDEO_TOO_LARGE', 'O clipe excede o limite configurado.');
	if (!contentTypeIsVideo(input.contentType))
		throw new VideoAssetError(415, 'VIDEO_CONTENT_TYPE_INVALID', 'O tipo do clipe é inválido.');
	if (!/^[0-9a-f]{64}$/.test(input.fileSha256))
		throw new VideoAssetError(400, 'VIDEO_FILE_HASH_INVALID', 'Hash SHA-256 do arquivo inválido.');
	if (!input.fileName || /[\\/]/.test(input.fileName) || input.fileName.includes('..'))
		throw new VideoAssetError(400, 'VIDEO_FILE_NAME_INVALID', 'Nome de arquivo inválido.');

	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select('id,scene_duration_ms')
		.eq('id', input.episodeId)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (episodeError || !episode)
		throw new VideoAssetError(404, 'EPISODE_NOT_FOUND', 'Episódio não encontrado.');
	const { data: scene, error: sceneError } = await db
		.from('scenes')
		.select('id,episode_id')
		.eq('id', input.sceneId)
		.eq('episode_id', input.episodeId)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (sceneError || !scene)
		throw new VideoAssetError(404, 'SCENE_NOT_FOUND', 'Cena não encontrada neste episódio.');

	const { data: existing, error: existingError } = await db
		.from('video_upload_sessions')
		.select(
			'id,owner_id,episode_id,scene_id,asset_id,idempotency_key,r2_upload_id,quarantine_key,part_size_bytes,total_bytes,status,expires_at,uploaded_parts,file_sha256',
		)
		.eq('owner_id', owner.id)
		.eq('idempotency_key', input.idempotencyKey)
		.maybeSingle();
	if (existingError)
		throw new VideoAssetError(
			503,
			'UPLOAD_LOOKUP_FAILED',
			'Não foi possível consultar a idempotência.',
		);
	if (existing) {
		const session = existing as SessionRow;
		if (
			session.status === 'COMPLETED' ||
			session.status === 'ABORTED' ||
			session.status === 'EXPIRED'
		)
			throw new VideoAssetError(
				409,
				'UPLOAD_NOT_RESUMABLE',
				'Esta chave de idempotência já foi encerrada.',
			);
		if (new Date(session.expires_at).getTime() < Date.now()) {
			await sessionDb
				.from('video_upload_sessions')
				.update({ status: 'EXPIRED', safe_error_code: 'UPLOAD_SESSION_EXPIRED' })
				.eq('id', session.id)
				.eq('owner_id', owner.id);
			throw new VideoAssetError(410, 'UPLOAD_EXPIRED', 'A sessão de upload expirou.');
		}
		if (
			session.episode_id !== input.episodeId ||
			session.scene_id !== input.sceneId ||
			session.total_bytes !== input.byteSize ||
			session.file_sha256 !== input.fileSha256
		)
			throw new VideoAssetError(
				409,
				'UPLOAD_IDEMPOTENCY_MISMATCH',
				'A chave de idempotência já foi usada com outro episódio, cena, tamanho ou arquivo.',
			);
		if (session.quarantine_key !== quarantineObjectKey(owner.id, session.id))
			throw new VideoAssetError(
				409,
				'UPLOAD_SESSION_INVALID',
				'A sessão de upload tem uma chave inválida.',
			);
		return {
			sessionId: session.id,
			assetId: session.asset_id,
			bucket: storage.bucket,
			key: session.quarantine_key,
			uploadId: session.r2_upload_id ?? '',
			partSizeBytes: session.part_size_bytes,
			parts: await signAllParts(storage, session),
			resumed: true,
		};
	}

	const { data: assets, error: assetsError } = await db
		.from('video_assets')
		.select('byte_size')
		.eq('owner_id', owner.id)
		.neq('status', 'DELETED');
	if (assetsError)
		throw new VideoAssetError(
			503,
			'VIDEO_QUOTA_LOOKUP_FAILED',
			'Não foi possível verificar a cota.',
		);
	const { data: activeSessions, error: sessionsError } = await db
		.from('video_upload_sessions')
		.select('total_bytes')
		.eq('owner_id', owner.id)
		.in('status', ['CREATED', 'UPLOADING'])
		.gt('expires_at', new Date().toISOString());
	if (sessionsError)
		throw new VideoAssetError(
			503,
			'VIDEO_QUOTA_LOOKUP_FAILED',
			'Não foi possível verificar a cota.',
		);
	const used =
		sumBytes((assets ?? []) as Array<{ byte_size: number | null }>) +
		sumBytes((activeSessions ?? []) as Array<{ total_bytes: number | null }>);
	if (used + input.byteSize > VIDEO_OWNER_QUOTA_BLOCK_BYTES)
		throw new VideoAssetError(
			413,
			'VIDEO_OWNER_QUOTA_EXCEEDED',
			'A cota de vídeo do owner foi atingida.',
		);
	const { data: episodeAssets, error: episodeAssetsError } = await db
		.from('video_assets')
		.select('byte_size')
		.eq('owner_id', owner.id)
		.eq('episode_id', input.episodeId)
		.neq('status', 'DELETED');
	if (episodeAssetsError)
		throw new VideoAssetError(
			503,
			'VIDEO_QUOTA_LOOKUP_FAILED',
			'Não foi possível verificar a cota do episódio.',
		);
	const { data: episodeSessions, error: episodeSessionsError } = await db
		.from('video_upload_sessions')
		.select('total_bytes')
		.eq('owner_id', owner.id)
		.eq('episode_id', input.episodeId)
		.in('status', ['CREATED', 'UPLOADING'])
		.gt('expires_at', new Date().toISOString());
	if (episodeSessionsError)
		throw new VideoAssetError(
			503,
			'VIDEO_QUOTA_LOOKUP_FAILED',
			'Não foi possível verificar a cota do episódio.',
		);
	const episodeUsed =
		sumBytes((episodeAssets ?? []) as Array<{ byte_size: number | null }>) +
		sumBytes((episodeSessions ?? []) as Array<{ total_bytes: number | null }>);
	const episodeClips = (episodeAssets?.length ?? 0) + (episodeSessions?.length ?? 0);
	if (episodeClips >= VIDEO_MAX_CLIPS_PER_EPISODE)
		throw new VideoAssetError(
			409,
			'VIDEO_EPISODE_CLIP_LIMIT',
			'O episódio já tem o máximo de 15 clipes.',
		);
	if (episodeUsed + input.byteSize > VIDEO_EPISODE_QUOTA_BYTES)
		throw new VideoAssetError(
			413,
			'VIDEO_EPISODE_QUOTA_EXCEEDED',
			'A cota de vídeo do episódio foi atingida.',
		);

	const sessionId = randomUUID();
	const assetId = randomUUID();
	const key = quarantineObjectKey(owner.id, sessionId);
	const { error: insertError } = await sessionDb.from('video_upload_sessions').insert({
		id: sessionId,
		owner_id: owner.id,
		episode_id: input.episodeId,
		scene_id: input.sceneId,
		asset_id: assetId,
		idempotency_key: input.idempotencyKey,
		quarantine_key: key,
		file_sha256: input.fileSha256,
		part_size_bytes: config.videoPartBytes,
		total_bytes: input.byteSize,
		status: 'CREATED',
	});
	if (insertError) {
		if (insertError.code === '23505')
			throw new VideoAssetError(
				409,
				'UPLOAD_IDEMPOTENCY_CONFLICT',
				'Chave de idempotência já utilizada.',
			);
		throw new VideoAssetError(
			503,
			'UPLOAD_CREATE_FAILED',
			'Não foi possível criar a sessão de upload.',
		);
	}

	let uploadId: string;
	try {
		const multipart = await storage.createMultipart({ key, contentType: 'video/mp4' });
		uploadId = multipart.uploadId;
	} catch {
		await sessionDb
			.from('video_upload_sessions')
			.update({ status: 'ABORTED', safe_error_code: 'R2_CREATE_FAILED' })
			.eq('id', sessionId)
			.eq('owner_id', owner.id);
		throw new VideoAssetError(
			503,
			'VIDEO_STORAGE_UNAVAILABLE',
			'O storage privado está indisponível.',
		);
	}
	const { error: updateError } = await sessionDb
		.from('video_upload_sessions')
		.update({ r2_upload_id: uploadId, status: 'UPLOADING', safe_error_code: null })
		.eq('id', sessionId)
		.eq('owner_id', owner.id);
	if (updateError) {
		await storage.abortMultipart({ key, uploadId }).catch(() => undefined);
		throw new VideoAssetError(
			503,
			'UPLOAD_CREATE_FAILED',
			'Não foi possível ativar a sessão de upload.',
		);
	}

	return {
		sessionId,
		assetId,
		bucket: storage.bucket,
		key,
		uploadId,
		partSizeBytes: config.videoPartBytes,
		parts: await signAllParts(storage, {
			quarantine_key: key,
			r2_upload_id: uploadId,
			total_bytes: input.byteSize,
			part_size_bytes: config.videoPartBytes,
			uploaded_parts: [],
		}),
		resumed: false,
	};
}

export async function recordUploadPart(input: {
	db: SupabaseClient;
	adminDb?: SupabaseClient | null;
	owner: User;
	sessionId: string;
	partNumber: number;
	etag: string;
}): Promise<Array<{ partNumber: number; etag: string }>> {
	const session = await loadSession(input.db, input.owner.id, input.sessionId, input.adminDb);
	if (session.status !== 'CREATED' && session.status !== 'UPLOADING')
		throw new VideoAssetError(409, 'UPLOAD_NOT_UPLOADING', 'A sessão não está em upload.');
	const expectedParts = Math.ceil(session.total_bytes / session.part_size_bytes);
	if (
		!Number.isInteger(input.partNumber) ||
		input.partNumber < 1 ||
		input.partNumber > expectedParts ||
		!input.etag ||
		input.etag.length > 200
	)
		throw new VideoAssetError(400, 'UPLOAD_PART_INVALID', 'Parte do upload inválida.');
	const current = Array.isArray(session.uploaded_parts) ? session.uploaded_parts : [];
	const next = [
		...current.filter((part) => part.partNumber !== input.partNumber),
		{ partNumber: input.partNumber, etag: input.etag },
	].sort((left, right) => left.partNumber - right.partNumber);
	const sessionDb = requireSessionWriter(input.adminDb);
	const { error } = await sessionDb
		.from('video_upload_sessions')
		.update({ uploaded_parts: next })
		.eq('id', session.id)
		.eq('owner_id', input.owner.id);
	if (error)
		throw new VideoAssetError(
			503,
			'UPLOAD_PART_SAVE_FAILED',
			'Não foi possível registrar a parte.',
		);
	return next;
}

export async function getUploadSession(input: {
	db: SupabaseClient;
	adminDb?: SupabaseClient | null;
	owner: User;
	storage: VideoStorage;
	sessionId: string;
}): Promise<{ session: SessionRow; parts: SignedPart[] }> {
	const session = await loadSession(input.db, input.owner.id, input.sessionId, input.adminDb);
	if (session.status === 'COMPLETED')
		throw new VideoAssetError(409, 'UPLOAD_ALREADY_COMPLETED', 'Este upload já foi concluído.');
	if (session.status === 'ABORTED' || session.status === 'EXPIRED')
		throw new VideoAssetError(409, 'UPLOAD_NOT_RESUMABLE', 'Esta sessão não pode ser retomada.');
	return { session, parts: await signAllParts(input.storage, session) };
}

export async function completeUploadSession(input: {
	db: SupabaseClient;
	adminDb?: SupabaseClient | null;
	owner: User;
	config: AppConfig;
	storage: VideoStorage;
	probe: VideoProbe | null;
	sessionId: string;
	parts: Array<{ partNumber: number; etag: string }>;
}): Promise<{
	asset: AssetRow;
	validation: 'ready' | 'pending_worker';
}> {
	const { db, owner, storage } = input;
	const sessionDb = requireSessionWriter(input.adminDb);
	const session = await loadSession(db, owner.id, input.sessionId, sessionDb);
	const quarantineKey = quarantineObjectKey(owner.id, session.id);
	if (session.status === 'COMPLETED') {
		const { data: asset } = await db
			.from('video_assets')
			.select('*')
			.eq('id', session.asset_id)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (asset)
			return {
				asset: asset as AssetRow,
				validation: asset.status === 'READY' ? 'ready' : 'pending_worker',
			};
		throw new VideoAssetError(409, 'UPLOAD_ALREADY_COMPLETED', 'Este upload já foi concluído.');
	}
	// CompleteMultipartUpload can succeed while the following database write fails.
	// Recover the already-created asset and finish the session instead of requiring a
	// second multipart completion, which R2 reports as NoSuchUpload.
	const { data: existingAsset } = await db
		.from('video_assets')
		.select('*')
		.eq('id', session.asset_id)
		.eq('owner_id', owner.id)
		.in('status', ['READY', 'QUARANTINED'])
		.maybeSingle();
	if (existingAsset) {
		const { error: recoverError } = await sessionDb
			.from('video_upload_sessions')
			.update({ status: 'COMPLETED', safe_error_code: null })
			.eq('id', session.id)
			.eq('owner_id', owner.id);
		if (recoverError)
			throw new VideoAssetError(
				503,
				'VIDEO_SESSION_FINALIZE_FAILED',
				'Não foi possível concluir a sessão; tente novamente.',
			);
		return {
			asset: existingAsset as AssetRow,
			validation: existingAsset.status === 'READY' ? 'ready' : 'pending_worker',
		};
	}
	if (session.status !== 'CREATED' && session.status !== 'UPLOADING')
		throw new VideoAssetError(409, 'UPLOAD_NOT_COMPLETABLE', 'Esta sessão não pode ser concluída.');
	if (!session.r2_upload_id)
		throw new VideoAssetError(409, 'UPLOAD_NOT_STARTED', 'Upload ainda não iniciado.');

	const expectedParts = Math.ceil(session.total_bytes / session.part_size_bytes);
	const mergedParts = new Map<number, { partNumber: number; etag: string }>();
	for (const part of Array.isArray(session.uploaded_parts) ? session.uploaded_parts : [])
		mergedParts.set(part.partNumber, part);
	for (const part of input.parts) mergedParts.set(part.partNumber, part);
	const parts = [...mergedParts.values()].sort((a, b) => a.partNumber - b.partNumber);
	if (
		parts.length !== expectedParts ||
		parts.some((part, index) => part.partNumber !== index + 1 || !part.etag)
	)
		throw new VideoAssetError(400, 'UPLOAD_PARTS_INVALID', 'Lista de partes do upload inválida.');

	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select('id,scene_duration_ms')
		.eq('id', session.episode_id)
		.eq('owner_id', owner.id)
		.maybeSingle();
	if (episodeError || !episode)
		throw new VideoAssetError(404, 'EPISODE_NOT_FOUND', 'Episódio não encontrado.');

	let stored: StoredObject;
	try {
		stored = await storage.completeMultipart({
			key: quarantineKey,
			uploadId: session.r2_upload_id,
			parts,
		});
	} catch {
		// A retry after a successful CompleteMultipartUpload (or a transient HEAD
		// failure immediately afterwards) can still recover by inspecting the object.
		try {
			stored = await storage.statObject(quarantineKey);
		} catch {
			throw new VideoAssetError(
				502,
				'VIDEO_STORAGE_COMPLETE_FAILED',
				'O storage não concluiu o upload.',
			);
		}
	}
	if (stored.size !== session.total_bytes) {
		await storage.deleteObject(quarantineKey).catch(() => undefined);
		await sessionDb
			.from('video_upload_sessions')
			.update({ status: 'ABORTED', safe_error_code: 'VIDEO_SIZE_MISMATCH' })
			.eq('id', session.id)
			.eq('owner_id', owner.id);
		throw new VideoAssetError(
			422,
			'VIDEO_SIZE_MISMATCH',
			'O tamanho recebido não confere com o original.',
		);
	}

	let sha256: string;
	let prefix: Buffer;
	try {
		sha256 = await storage.hashObject(quarantineKey);
		prefix = await storage.readPrefix(quarantineKey, 12);
	} catch {
		await storage.deleteObject(quarantineKey).catch(() => undefined);
		await sessionDb
			.from('video_upload_sessions')
			.update({ status: 'ABORTED', safe_error_code: 'VIDEO_HASH_FAILED' })
			.eq('id', session.id)
			.eq('owner_id', owner.id);
		throw new VideoAssetError(
			502,
			'VIDEO_HASH_FAILED',
			'Não foi possível calcular o hash do clipe.',
		);
	}
	if (!hasMp4Magic(prefix)) {
		await storage.deleteObject(quarantineKey).catch(() => undefined);
		await sessionDb
			.from('video_upload_sessions')
			.update({ status: 'ABORTED', safe_error_code: 'VIDEO_CONTAINER_INVALID' })
			.eq('id', session.id)
			.eq('owner_id', owner.id);
		throw new VideoAssetError(415, 'VIDEO_CONTAINER_INVALID', 'O arquivo não é um MP4/MOV válido.');
	}
	if (session.file_sha256 && session.file_sha256 !== sha256) {
		await storage.deleteObject(quarantineKey).catch(() => undefined);
		await sessionDb
			.from('video_upload_sessions')
			.update({ status: 'ABORTED', safe_error_code: 'VIDEO_HASH_MISMATCH' })
			.eq('id', session.id)
			.eq('owner_id', owner.id);
		throw new VideoAssetError(
			422,
			'VIDEO_HASH_MISMATCH',
			'O arquivo recebido não corresponde ao arquivo original da sessão.',
		);
	}

	const version = await nextAssetVersion(db, owner.id, session.episode_id, session.scene_id);
	const finalKey = finalVideoObjectKey({
		ownerId: owner.id,
		episodeId: session.episode_id,
		sceneId: session.scene_id,
		assetId: session.asset_id,
		version,
	});

	let probeResult: Awaited<ReturnType<VideoProbe['probeFile']>> | null = null;
	if (input.probe) {
		const directory = await mkdtemp(join(tmpdir(), 'dif-video-'));
		const localPath = join(directory, 'source.mp4');
		try {
			await storage.downloadToFile(quarantineKey, localPath);
			probeResult = await input.probe.probeFile(localPath);
		} catch {
			await rm(directory, { recursive: true, force: true }).catch(() => undefined);
			await storage.deleteObject(quarantineKey).catch(() => undefined);
			await sessionDb
				.from('video_upload_sessions')
				.update({ status: 'ABORTED', safe_error_code: 'VIDEO_PROBE_FAILED' })
				.eq('id', session.id)
				.eq('owner_id', owner.id);
			throw new VideoAssetError(422, 'VIDEO_PROBE_FAILED', 'O vídeo não pôde ser inspecionado.');
		}
		await rm(directory, { recursive: true, force: true }).catch(() => undefined);
		const validation = validateProbe(probeResult, episode.scene_duration_ms as number);
		if (!validation.ok) {
			await storage.deleteObject(quarantineKey).catch(() => undefined);
			await sessionDb
				.from('video_upload_sessions')
				.update({ status: 'ABORTED', safe_error_code: validation.code })
				.eq('id', session.id)
				.eq('owner_id', owner.id);
			throw new VideoAssetError(422, validation.code, validation.message);
		}
		probeResult = validation.result;
	}

	const ready = Boolean(input.probe && probeResult);
	if (ready && !input.adminDb)
		throw new VideoAssetError(
			503,
			'VIDEO_FINALIZE_UNAVAILABLE',
			'A validação server-side não está configurada; o clipe permanece em quarentena.',
		);
	if (ready) {
		try {
			await storage.copyToFinal({
				sourceKey: quarantineKey,
				destinationKey: finalKey,
			});
		} catch {
			await storage.deleteObject(quarantineKey).catch(() => undefined);
			await sessionDb
				.from('video_upload_sessions')
				.update({ status: 'ABORTED', safe_error_code: 'VIDEO_STORAGE_COPY_FAILED' })
				.eq('id', session.id)
				.eq('owner_id', owner.id);
			throw new VideoAssetError(
				502,
				'VIDEO_STORAGE_COPY_FAILED',
				'Não foi possível publicar o clipe validado.',
			);
		}
		await storage.deleteObject(quarantineKey).catch(() => undefined);
	}

	const assetInsert = {
		id: session.asset_id,
		owner_id: owner.id,
		episode_id: session.episode_id,
		scene_id: session.scene_id,
		asset_version: version,
		storage_provider: 'r2',
		bucket: storage.bucket,
		object_key: ready ? finalKey : quarantineKey,
		poster_key: null,
		sha256,
		byte_size: stored.size,
		duration_ms: ready && probeResult ? probeResult.durationMs : null,
		width: ready && probeResult ? probeResult.width : null,
		height: ready && probeResult ? probeResult.height : null,
		codec: ready && probeResult ? probeResult.codec : null,
		container: ready && probeResult ? probeResult.container : null,
		status: ready ? 'READY' : 'QUARANTINED',
		safe_error_code: null,
		validated_at: ready ? new Date().toISOString() : null,
		retention_until: ready
			? new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
			: null,
	};
	const { data: asset, error: assetError } = await sessionDb
		.from('video_assets')
		.insert(assetInsert)
		.select('*')
		.single();
	if (assetError || !asset) {
		// A retry or concurrent completion may have committed the asset even though
		// this request saw an error. Never delete finalKey here: it may be the row
		// another request just published. Leave an orphan for GC if the lookup
		// itself fails.
		const { data: concurrentAsset, error: lookupError } = await db
			.from('video_assets')
			.select('*')
			.eq('id', session.asset_id)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (!lookupError && concurrentAsset) {
			await sessionDb
				.from('video_upload_sessions')
				.update({ status: 'COMPLETED', safe_error_code: null })
				.eq('id', session.id)
				.eq('owner_id', owner.id);
			return {
				asset: concurrentAsset as AssetRow,
				validation: concurrentAsset.status === 'READY' ? 'ready' : 'pending_worker',
			};
		}
		throw new VideoAssetError(
			503,
			lookupError ? 'VIDEO_ASSET_LOOKUP_FAILED' : 'VIDEO_ASSET_CREATE_FAILED',
			'Não foi possível registrar o clipe; tente novamente.',
		);
	}
	const { error: finalizeError } = await sessionDb
		.from('video_upload_sessions')
		.update({ status: 'COMPLETED', safe_error_code: null })
		.eq('id', session.id)
		.eq('owner_id', owner.id);
	if (finalizeError)
		throw new VideoAssetError(
			503,
			'VIDEO_SESSION_FINALIZE_FAILED',
			'O clipe foi registrado, mas a sessão não foi encerrada; tente novamente.',
		);
	return { asset: asset as AssetRow, validation: ready ? 'ready' : 'pending_worker' };
}

export async function listUploadSessions(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
}): Promise<SessionRow[]> {
	const { data, error } = await input.db
		.from('video_upload_sessions')
		.select('*')
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.in('status', ['CREATED', 'UPLOADING'])
		.gt('expires_at', new Date().toISOString())
		.order('created_at', { ascending: false });
	if (error)
		throw new VideoAssetError(503, 'UPLOAD_LIST_FAILED', 'Não foi possível listar uploads.');
	return (data ?? []) as SessionRow[];
}

export async function listVideoAssets(input: {
	db: SupabaseClient;
	owner: User;
	episodeId: string;
}): Promise<AssetRow[]> {
	const { data, error } = await input.db
		.from('video_assets')
		.select(
			'id,episode_id,scene_id,asset_version,bucket,object_key,poster_key,sha256,byte_size,duration_ms,width,height,codec,container,status,safe_error_code,created_at',
		)
		.eq('owner_id', input.owner.id)
		.eq('episode_id', input.episodeId)
		.neq('status', 'DELETED')
		.order('created_at', { ascending: true });
	if (error)
		throw new VideoAssetError(503, 'VIDEO_LIST_FAILED', 'Não foi possível listar os clipes.');
	const rows = (data ?? []) as AssetRow[];
	const sceneIds = [...new Set(rows.map((row) => row.scene_id))];
	const sceneIndexes = new Map<string, number>();
	if (sceneIds.length > 0) {
		const { data: scenes, error: scenesError } = await input.db
			.from('scenes')
			.select('id,scene_index')
			.eq('owner_id', input.owner.id)
			.in('id', sceneIds);
		if (scenesError)
			throw new VideoAssetError(503, 'VIDEO_LIST_FAILED', 'Não foi possível carregar as cenas.');
		for (const scene of (scenes ?? []) as Array<{ id: string; scene_index: number }>)
			sceneIndexes.set(scene.id, scene.scene_index);
	}
	return rows
		.map((row) => ({ ...row, scenes: { scene_index: sceneIndexes.get(row.scene_id) ?? 0 } }))
		.sort(
			(left, right) =>
				(left.scenes?.scene_index ?? 0) - (right.scenes?.scene_index ?? 0) ||
				left.asset_version - right.asset_version,
		);
}

export async function getVideoAssetForDownload(input: {
	db: SupabaseClient;
	owner: User;
	storage: VideoStorage;
	assetId: string;
	poster: boolean;
}): Promise<{ url: string; contentType: string }> {
	const { data, error } = await input.db
		.from('video_assets')
		.select('id,object_key,poster_key,status')
		.eq('id', input.assetId)
		.eq('owner_id', input.owner.id)
		.maybeSingle();
	if (error || !data || data.status !== 'READY')
		throw new VideoAssetError(404, 'VIDEO_NOT_FOUND', 'Clipe não encontrado.');
	const key = input.poster ? data.poster_key : data.object_key;
	if (!key) throw new VideoAssetError(404, 'VIDEO_NOT_FOUND', 'Clipe não encontrado.');
	return {
		url: await input.storage.signDownload(key, 60),
		contentType: input.poster ? 'image/jpeg' : 'video/mp4',
	};
}
