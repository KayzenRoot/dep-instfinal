import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AppConfig } from './config.js';
import {
	completeUploadSession,
	getUploadSession,
	getVideoAssetForDownload,
	recordUploadPart,
	VideoAssetError,
} from './video-assets.js';
import { InMemoryVideoStorage } from './video-storage.js';
import type { ProbeResult } from './video-probe.js';

type Row = Record<string, unknown>;
type FakeError = { code?: string; message: string };
type FakeResult = { data: unknown; error: FakeError | null };

class FakeQuery implements PromiseLike<FakeResult> {
	private filters: Array<(row: Row) => boolean> = [];
	private mode: 'select' | 'insert' | 'update' = 'select';
	private inserted: Row | null = null;
	private patch: Row | null = null;
	private orderBy: { column: string; ascending: boolean } | null = null;
	private maxRows: number | null = null;

	constructor(
		private readonly db: FakeDb,
		private readonly table: string,
	) {}

	select(): this {
		return this;
	}

	insert(row: Row): this {
		this.mode = 'insert';
		this.inserted = row;
		return this;
	}

	update(patch: Row): this {
		this.mode = 'update';
		this.patch = patch;
		return this;
	}

	eq(column: string, value: unknown): this {
		this.filters.push((row) => row[column] === value);
		return this;
	}

	neq(column: string, value: unknown): this {
		this.filters.push((row) => row[column] !== value);
		return this;
	}

	in(column: string, values: unknown[]): this {
		this.filters.push((row) => values.includes(row[column]));
		return this;
	}

	gt(column: string, value: unknown): this {
		this.filters.push((row) => String(row[column]) > String(value));
		return this;
	}

	order(column: string, options: { ascending: boolean }): this {
		this.orderBy = { column, ascending: options.ascending };
		return this;
	}

	limit(count: number): this {
		this.maxRows = count;
		return this;
	}

	async maybeSingle(): Promise<FakeResult> {
		const rows = await this.executeRows();
		return { data: rows[0] ?? null, error: null };
	}

	async single(): Promise<FakeResult> {
		const error = this.mode === 'insert' ? this.db.takeInsertError(this.table) : null;
		if (error) return { data: null, error };
		const rows = await this.executeRows();
		return { data: rows[0] ?? null, error: null };
	}

	then<TResult1 = FakeResult, TResult2 = never>(
		onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): Promise<TResult1 | TResult2> {
		return this.execute().then(onfulfilled, onrejected);
	}

	private async executeRows(): Promise<Row[]> {
		if (this.mode === 'insert' && this.inserted) {
			this.db.rows(this.table).push(this.inserted);
			return [this.inserted];
		}
		if (this.mode === 'update' && this.patch) {
			for (const row of this.db.rows(this.table)) {
				if (this.filters.every((filter) => filter(row))) Object.assign(row, this.patch);
			}
			return [];
		}
		let rows = this.db
			.rows(this.table)
			.filter((row) => this.filters.every((filter) => filter(row)));
		if (this.orderBy) {
			const { column, ascending } = this.orderBy;
			rows = [...rows].sort((left, right) => {
				const comparison = String(left[column]).localeCompare(String(right[column]));
				return ascending ? comparison : -comparison;
			});
		}
		return this.maxRows === null ? rows : rows.slice(0, this.maxRows);
	}

	private async execute(): Promise<FakeResult> {
		const error = this.mode === 'update' ? this.db.takeUpdateError(this.table) : null;
		if (error) return { data: null, error };
		await this.executeRows();
		return { data: null, error: null };
	}
}

class FakeDb {
	private readonly insertFailures = new Map<string, FakeError[]>();
	private readonly updateFailures = new Map<string, FakeError[]>();

	constructor(private readonly tables: Record<string, Row[]>) {}

	from(table: string): FakeQuery {
		this.tables[table] ??= [];
		return new FakeQuery(this, table);
	}

	rows(table: string): Row[] {
		return this.tables[table] ?? (this.tables[table] = []);
	}

	failNextInsert(table: string, error: FakeError = { message: 'insert failed' }): void {
		this.insertFailures.set(table, [...(this.insertFailures.get(table) ?? []), error]);
	}

	failNextUpdate(table: string, error: FakeError = { message: 'update failed' }): void {
		this.updateFailures.set(table, [...(this.updateFailures.get(table) ?? []), error]);
	}

	takeInsertError(table: string): FakeError | null {
		return this.insertFailures.get(table)?.shift() ?? null;
	}

	takeUpdateError(table: string): FakeError | null {
		return this.updateFailures.get(table)?.shift() ?? null;
	}

	asClient(): SupabaseClient {
		return this as unknown as SupabaseClient;
	}
}

const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as User;
const episodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sceneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const assetId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const key = `quarantine/${owner.id}/${sessionId}/source`;
const validBytes = Buffer.from([
	0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
]);
const fileHash = createHash('sha256').update(validBytes).digest('hex');

const validProbe: ProbeResult = {
	container: 'mov,mp4,m4a,3gp,3g2,mj2',
	codec: 'h264',
	durationMs: 8000,
	width: 1080,
	height: 1920,
	rotation: 0,
	frameRate: 30,
};

function sessionRow(overrides: Row = {}): Row {
	return {
		id: sessionId,
		owner_id: owner.id,
		episode_id: episodeId,
		scene_id: sceneId,
		asset_id: assetId,
		idempotency_key: 'idem-video-test-001',
		r2_upload_id: null,
		quarantine_key: key,
		part_size_bytes: 5 * 1024 * 1024,
		total_bytes: validBytes.length,
		status: 'UPLOADING',
		expires_at: new Date(Date.now() + 60_000).toISOString(),
		uploaded_parts: [],
		file_sha256: fileHash,
		...overrides,
	};
}

function fakeDb(session: Row = sessionRow(), assets: Row[] = []): FakeDb {
	return new FakeDb({
		episodes: [{ id: episodeId, owner_id: owner.id, scene_duration_ms: 8000 }],
		scenes: [{ id: sceneId, owner_id: owner.id, episode_id: episodeId, scene_index: 1 }],
		video_upload_sessions: [session],
		video_assets: assets,
	});
}

async function storageWithUpload() {
	const storage = new InMemoryVideoStorage();
	const multipart = await storage.createMultipart({ key, contentType: 'video/mp4' });
	const etag = storage.putPartForTest(multipart.uploadId, 1, validBytes);
	return { storage, uploadId: multipart.uploadId, etag };
}

const config = {} as AppConfig;

describe('video asset service', () => {
	it('completes a session using already-recorded parts and the expected file hash', async () => {
		const { storage, uploadId, etag } = await storageWithUpload();
		const db = fakeDb(
			sessionRow({ r2_upload_id: uploadId, uploaded_parts: [{ partNumber: 1, etag }] }),
		);
		const result = await completeUploadSession({
			db: db.asClient(),
			adminDb: db.asClient(),
			owner,
			config,
			storage,
			probe: { probeFile: async () => validProbe },
			sessionId,
			parts: [],
		});
		expect(result.validation).toBe('ready');
		expect(result.asset.status).toBe('READY');
		expect(result.asset.sha256).toBe(fileHash);
		expect(db.rows('video_upload_sessions')[0].status).toBe('COMPLETED');
	});

	it('recovers when CompleteMultipartUpload succeeded but its response failed', async () => {
		const { etag } = await storageWithUpload();
		const flaky = new (class extends InMemoryVideoStorage {
			private failed = false;
			override async completeMultipart(input: {
				key: string;
				uploadId: string;
				parts: Array<{ partNumber: number; etag: string }>;
			}) {
				const result = await super.completeMultipart(input);
				if (!this.failed) {
					this.failed = true;
					throw new Error('simulated HEAD failure');
				}
				return result;
			}
		})();
		const multipart = await flaky.createMultipart({ key, contentType: 'video/mp4' });
		flaky.putPartForTest(multipart.uploadId, 1, validBytes);
		const db = fakeDb(
			sessionRow({ r2_upload_id: multipart.uploadId, uploaded_parts: [{ partNumber: 1, etag }] }),
		);
		const result = await completeUploadSession({
			db: db.asClient(),
			adminDb: db.asClient(),
			owner,
			config,
			storage: flaky,
			probe: { probeFile: async () => validProbe },
			sessionId,
			parts: [],
		});
		expect(result.asset.status).toBe('READY');
		expect(result.validation).toBe('ready');
	});

	it('keeps quarantine and retries after an asset insert failure', async () => {
		const { storage, uploadId, etag } = await storageWithUpload();
		const db = fakeDb(
			sessionRow({ r2_upload_id: uploadId, uploaded_parts: [{ partNumber: 1, etag }] }),
		);
		db.failNextInsert('video_assets');
		await expect(
			completeUploadSession({
				db: db.asClient(),
				adminDb: db.asClient(),
				owner,
				config,
				storage,
				probe: { probeFile: async () => validProbe },
				sessionId,
				parts: [],
			}),
		).rejects.toMatchObject({ code: 'VIDEO_ASSET_CREATE_FAILED', status: 503 });
		expect(db.rows('video_upload_sessions')[0].status).toBe('UPLOADING');
		expect(storage.getObjectForTest(key)).toBeDefined();

		const retry = await completeUploadSession({
			db: db.asClient(),
			adminDb: db.asClient(),
			owner,
			config,
			storage,
			probe: { probeFile: async () => validProbe },
			sessionId,
			parts: [],
		});
		expect(retry.asset.status).toBe('READY');
		expect(db.rows('video_upload_sessions')[0].status).toBe('COMPLETED');
		expect(storage.getObjectForTest(key)).toBeUndefined();
	});

	it('recovers a READY asset after a session finalize failure', async () => {
		const { storage, uploadId, etag } = await storageWithUpload();
		const db = fakeDb(
			sessionRow({ r2_upload_id: uploadId, uploaded_parts: [{ partNumber: 1, etag }] }),
		);
		db.failNextUpdate('video_upload_sessions');
		await expect(
			completeUploadSession({
				db: db.asClient(),
				adminDb: db.asClient(),
				owner,
				config,
				storage,
				probe: { probeFile: async () => validProbe },
				sessionId,
				parts: [],
			}),
		).rejects.toMatchObject({ code: 'VIDEO_SESSION_FINALIZE_FAILED', status: 503 });
		expect(db.rows('video_assets')[0].status).toBe('READY');
		expect(storage.getObjectForTest(key)).toBeDefined();

		const retry = await completeUploadSession({
			db: db.asClient(),
			adminDb: db.asClient(),
			owner,
			config,
			storage,
			probe: null,
			sessionId,
			parts: [],
		});
		expect(retry.validation).toBe('ready');
		expect(db.rows('video_upload_sessions')[0].status).toBe('COMPLETED');
		expect(storage.getObjectForTest(key)).toBeUndefined();
	});

	it('fails safe when the server session writer is unavailable', async () => {
		const db = fakeDb();
		await expect(
			completeUploadSession({
				db: db.asClient(),
				adminDb: null,
				owner,
				config,
				storage: new InMemoryVideoStorage(),
				probe: null,
				sessionId,
				parts: [],
			}),
		).rejects.toMatchObject({ code: 'VIDEO_SESSION_WRITE_UNAVAILABLE', status: 503 });
	});

	it('recovers a completed session when the asset already exists', async () => {
		const db = fakeDb(sessionRow(), [
			{
				id: assetId,
				owner_id: owner.id,
				episode_id: episodeId,
				scene_id: sceneId,
				asset_version: 1,
				bucket: 'memory-video-private',
				object_key: `owners/${owner.id}/final.mp4`,
				status: 'READY',
				sha256: fileHash,
			},
		]);
		const result = await completeUploadSession({
			db: db.asClient(),
			adminDb: db.asClient(),
			owner,
			config,
			storage: new InMemoryVideoStorage(),
			probe: null,
			sessionId,
			parts: [],
		});
		expect(result.validation).toBe('ready');
		expect(db.rows('video_upload_sessions')[0].status).toBe('COMPLETED');
	});

	it('aborts a session when the uploaded bytes do not match the browser hash', async () => {
		const { storage, uploadId, etag } = await storageWithUpload();
		const db = fakeDb(
			sessionRow({
				r2_upload_id: uploadId,
				uploaded_parts: [{ partNumber: 1, etag }],
				file_sha256: 'a'.repeat(64),
			}),
		);
		await expect(
			completeUploadSession({
				db: db.asClient(),
				adminDb: db.asClient(),
				owner,
				config,
				storage,
				probe: { probeFile: async () => validProbe },
				sessionId,
				parts: [],
			}),
		).rejects.toMatchObject({ code: 'VIDEO_HASH_MISMATCH', status: 422 });
		expect(db.rows('video_upload_sessions')[0].status).toBe('ABORTED');
	});

	it('rejects a session whose quarantine key was tampered with', async () => {
		const db = fakeDb(
			sessionRow({ quarantine_key: `owners/${owner.id}/episodes/${episodeId}/final.mp4` }),
		);
		await expect(
			getUploadSession({
				db: db.asClient(),
				owner,
				storage: new InMemoryVideoStorage(),
				sessionId,
			}),
		).rejects.toMatchObject({ code: 'UPLOAD_SESSION_INVALID', status: 409 });
	});

	it('records a part and rejects a part outside the expected range', async () => {
		const db = fakeDb();
		await expect(
			recordUploadPart({
				db: db.asClient(),
				adminDb: db.asClient(),
				owner,
				sessionId,
				partNumber: 1,
				etag: '"etag"',
			}),
		).resolves.toEqual([{ partNumber: 1, etag: '"etag"' }]);
		await expect(
			recordUploadPart({
				db: db.asClient(),
				adminDb: db.asClient(),
				owner,
				sessionId,
				partNumber: 2,
				etag: '"etag"',
			}),
		).rejects.toMatchObject({ code: 'UPLOAD_PART_INVALID', status: 400 });
	});

	it('expires a stale session and returns 410', async () => {
		const db = fakeDb(sessionRow({ expires_at: new Date(Date.now() - 1000).toISOString() }));
		await expect(
			getUploadSession({
				db: db.asClient(),
				owner,
				storage: new InMemoryVideoStorage(),
				sessionId,
			}),
		).rejects.toBeInstanceOf(VideoAssetError);
		expect(db.rows('video_upload_sessions')[0].status).toBe('EXPIRED');
	});

	it('does not sign a download for a non-READY asset', async () => {
		const db = fakeDb(sessionRow(), [
			{
				id: assetId,
				owner_id: owner.id,
				status: 'QUARANTINED',
				object_key: key,
				poster_key: null,
			},
		]);
		await expect(
			getVideoAssetForDownload({
				db: db.asClient(),
				owner,
				storage: new InMemoryVideoStorage(),
				assetId,
				poster: false,
			}),
		).rejects.toMatchObject({ code: 'VIDEO_NOT_FOUND', status: 404 });
	});
});
