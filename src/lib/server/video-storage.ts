import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
	UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from './config.js';
import { getAppConfig } from './config.js';

export interface MultipartSession {
	bucket: string;
	key: string;
	uploadId: string;
}

export interface SignedPart {
	partNumber: number;
	url: string;
}

export interface StoredObject {
	bucket: string;
	key: string;
	size: number;
	etag?: string;
	contentType?: string;
}

export interface CompletePart {
	partNumber: number;
	etag: string;
}

export interface VideoStorage {
	readonly bucket: string;
	createMultipart(input: { key: string; contentType: string }): Promise<MultipartSession>;
	signPart(input: {
		key: string;
		uploadId: string;
		partNumber: number;
		expiresInSeconds?: number;
	}): Promise<SignedPart>;
	completeMultipart(input: {
		key: string;
		uploadId: string;
		parts: CompletePart[];
	}): Promise<StoredObject>;
	abortMultipart(input: { key: string; uploadId: string }): Promise<void>;
	statObject(key: string): Promise<StoredObject>;
	hashObject(key: string): Promise<string>;
	readPrefix(key: string, length: number): Promise<Buffer>;
	downloadToFile(key: string, destination: string): Promise<void>;
	copyToFinal(input: { sourceKey: string; destinationKey: string }): Promise<StoredObject>;
	signDownload(key: string, expiresInSeconds?: number): Promise<string>;
	deleteObject(key: string): Promise<void>;
}

export function quarantineObjectKey(ownerId: string, sessionId: string): string {
	return `quarantine/${ownerId}/${sessionId}/source`;
}

export function finalVideoObjectKey(input: {
	ownerId: string;
	episodeId: string;
	sceneId: string;
	assetId: string;
	version: number;
}): string {
	return `owners/${input.ownerId}/episodes/${input.episodeId}/scenes/${input.sceneId}/v${input.version}/${input.assetId}.mp4`;
}

export function posterObjectKey(input: {
	ownerId: string;
	episodeId: string;
	sceneId: string;
	assetId: string;
	version: number;
}): string {
	return `owners/${input.ownerId}/episodes/${input.episodeId}/scenes/${input.sceneId}/v${input.version}/${input.assetId}.poster.jpg`;
}

function requireR2Config(config: AppConfig): {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
	endpoint: string;
} {
	if (
		!config.r2AccountId ||
		!config.r2AccessKeyId ||
		!config.r2SecretAccessKey ||
		!config.r2Bucket ||
		!config.r2Endpoint
	)
		throw new Error('R2 is not configured.');
	return {
		accountId: config.r2AccountId,
		accessKeyId: config.r2AccessKeyId,
		secretAccessKey: config.r2SecretAccessKey,
		bucket: config.r2Bucket,
		endpoint: config.r2Endpoint,
	};
}

export class R2VideoStorage implements VideoStorage {
	readonly bucket: string;
	private readonly client: S3Client;

	constructor(config: AppConfig) {
		const r2 = requireR2Config(config);
		this.bucket = r2.bucket;
		this.client = new S3Client({
			region: 'auto',
			endpoint: r2.endpoint,
			forcePathStyle: true,
			credentials: {
				accessKeyId: r2.accessKeyId,
				secretAccessKey: r2.secretAccessKey,
			},
		});
	}

	async createMultipart(input: { key: string; contentType: string }): Promise<MultipartSession> {
		const result = await this.client.send(
			new CreateMultipartUploadCommand({
				Bucket: this.bucket,
				Key: input.key,
				ContentType: input.contentType,
				Metadata: { 'dif-studio': 'v2-video' },
			}),
		);
		if (!result.UploadId) throw new Error('R2 did not return an upload id.');
		return { bucket: this.bucket, key: input.key, uploadId: result.UploadId };
	}

	async signPart(input: {
		key: string;
		uploadId: string;
		partNumber: number;
		expiresInSeconds?: number;
	}): Promise<SignedPart> {
		const url = await getSignedUrl(
			this.client,
			new UploadPartCommand({
				Bucket: this.bucket,
				Key: input.key,
				UploadId: input.uploadId,
				PartNumber: input.partNumber,
			}),
			{ expiresIn: input.expiresInSeconds ?? 900 },
		);
		return { partNumber: input.partNumber, url };
	}

	async completeMultipart(input: {
		key: string;
		uploadId: string;
		parts: CompletePart[];
	}): Promise<StoredObject> {
		const parts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
		await this.client.send(
			new CompleteMultipartUploadCommand({
				Bucket: this.bucket,
				Key: input.key,
				UploadId: input.uploadId,
				MultipartUpload: {
					Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
				},
			}),
		);
		return this.statObject(input.key);
	}

	async abortMultipart(input: { key: string; uploadId: string }): Promise<void> {
		await this.client.send(
			new AbortMultipartUploadCommand({
				Bucket: this.bucket,
				Key: input.key,
				UploadId: input.uploadId,
			}),
		);
	}

	async statObject(key: string): Promise<StoredObject> {
		const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
		return {
			bucket: this.bucket,
			key,
			size: result.ContentLength ?? 0,
			etag: result.ETag,
			contentType: result.ContentType,
		};
	}

	async hashObject(key: string): Promise<string> {
		const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
		if (!result.Body) throw new Error('R2 object has no body.');
		const hash = createHash('sha256');
		await pipeline(result.Body as Readable, hash);
		return hash.digest('hex');
	}

	async readPrefix(key: string, length: number): Promise<Buffer> {
		const result = await this.client.send(
			new GetObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Range: `bytes=0-${Math.max(0, length - 1)}`,
			}),
		);
		if (!result.Body) throw new Error('R2 object has no body.');
		const chunks: Buffer[] = [];
		for await (const chunk of result.Body as Readable) chunks.push(Buffer.from(chunk));
		return Buffer.concat(chunks).subarray(0, length);
	}

	async downloadToFile(key: string, destination: string): Promise<void> {
		const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
		if (!result.Body) throw new Error('R2 object has no body.');
		await pipeline(result.Body as Readable, createWriteStream(destination));
	}

	async copyToFinal(input: { sourceKey: string; destinationKey: string }): Promise<StoredObject> {
		await this.client.send(
			new CopyObjectCommand({
				Bucket: this.bucket,
				Key: input.destinationKey,
				CopySource: `${this.bucket}/${input.sourceKey}`,
				MetadataDirective: 'COPY',
			}),
		);
		return this.statObject(input.destinationKey);
	}

	async signDownload(key: string, expiresInSeconds = 60): Promise<string> {
		return getSignedUrl(
			this.client,
			new GetObjectCommand({
				Bucket: this.bucket,
				Key: key,
				ResponseCacheControl: 'private, no-store',
				ResponseContentDisposition: 'inline',
			}),
			{ expiresIn: expiresInSeconds },
		);
	}

	async deleteObject(key: string): Promise<void> {
		await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
	}
}

interface MemoryMultipart {
	key: string;
	contentType: string;
	parts: Map<number, Buffer>;
}

export class InMemoryVideoStorage implements VideoStorage {
	readonly bucket = 'memory-video-private';
	readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
	readonly uploads = new Map<string, MemoryMultipart>();

	async createMultipart(input: { key: string; contentType: string }): Promise<MultipartSession> {
		const uploadId = randomUUID();
		this.uploads.set(uploadId, {
			key: input.key,
			contentType: input.contentType,
			parts: new Map(),
		});
		return { bucket: this.bucket, key: input.key, uploadId };
	}

	async signPart(input: {
		key: string;
		uploadId: string;
		partNumber: number;
	}): Promise<SignedPart> {
		if (!this.uploads.has(input.uploadId)) throw new Error('Upload session not found.');
		return {
			partNumber: input.partNumber,
			url: `/api/video/dev-upload/${encodeURIComponent(input.uploadId)}/${input.partNumber}`,
		};
	}

	async completeMultipart(input: {
		key: string;
		uploadId: string;
		parts: CompletePart[];
	}): Promise<StoredObject> {
		const upload = this.uploads.get(input.uploadId);
		if (!upload || upload.key !== input.key) throw new Error('Upload session not found.');
		const ordered = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
		const bytes = Buffer.concat(
			ordered.map((part) => {
				const value = upload.parts.get(part.partNumber);
				if (!value) throw new Error(`Missing upload part ${part.partNumber}.`);
				return value;
			}),
		);
		this.objects.set(input.key, { bytes, contentType: upload.contentType });
		this.uploads.delete(input.uploadId);
		return this.statObject(input.key);
	}

	async abortMultipart(input: { uploadId: string }): Promise<void> {
		this.uploads.delete(input.uploadId);
	}

	async statObject(key: string): Promise<StoredObject> {
		const object = this.objects.get(key);
		if (!object) throw new Error('Object not found.');
		return {
			bucket: this.bucket,
			key,
			size: object.bytes.length,
			etag: `"${createHash('sha256').update(object.bytes).digest('hex')}"`,
			contentType: object.contentType,
		};
	}

	async hashObject(key: string): Promise<string> {
		const object = this.objects.get(key);
		if (!object) throw new Error('Object not found.');
		return createHash('sha256').update(object.bytes).digest('hex');
	}

	async readPrefix(key: string, length: number): Promise<Buffer> {
		const object = this.objects.get(key);
		if (!object) throw new Error('Object not found.');
		return object.bytes.subarray(0, length);
	}

	async downloadToFile(key: string, destination: string): Promise<void> {
		const object = this.objects.get(key);
		if (!object) throw new Error('Object not found.');
		const { writeFile } = await import('node:fs/promises');
		await writeFile(destination, object.bytes);
	}

	async copyToFinal(input: { sourceKey: string; destinationKey: string }): Promise<StoredObject> {
		const source = this.objects.get(input.sourceKey);
		if (!source) throw new Error('Object not found.');
		this.objects.set(input.destinationKey, { ...source });
		return this.statObject(input.destinationKey);
	}

	async signDownload(key: string, expiresInSeconds = 60): Promise<string> {
		if (!this.objects.has(key)) throw new Error('Object not found.');
		return `/api/video/dev-object/${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
	}

	async deleteObject(key: string): Promise<void> {
		this.objects.delete(key);
	}

	putPartForTest(uploadId: string, partNumber: number, bytes: Buffer): string {
		const upload = this.uploads.get(uploadId);
		if (!upload) throw new Error('Upload session not found.');
		if (bytes.length === 0) throw new Error('Empty upload part.');
		upload.parts.set(partNumber, bytes);
		return `"${createHash('sha256').update(bytes).digest('hex')}"`;
	}

	getObjectForTest(key: string): Buffer | undefined {
		return this.objects.get(key)?.bytes;
	}

	resetForTest(): void {
		this.objects.clear();
		this.uploads.clear();
	}
}

let memoryStorage: InMemoryVideoStorage | undefined;
let r2Storage: R2VideoStorage | undefined;

export function getVideoStorage(config: AppConfig = getAppConfig()): VideoStorage | null {
	if (config.videoStorageDriver === 'memory') {
		if (!import.meta.env.DEV) return null;
		memoryStorage ??= new InMemoryVideoStorage();
		return memoryStorage;
	}
	if (!config.r2Configured) return null;
	r2Storage ??= new R2VideoStorage(config);
	return r2Storage;
}

export function resetVideoStorageForTest(): void {
	memoryStorage?.resetForTest();
	memoryStorage = undefined;
	r2Storage = undefined;
}
