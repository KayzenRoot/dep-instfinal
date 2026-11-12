import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const cloudinary = vi.hoisted(() => ({
	config: vi.fn(),
	api: { resource: vi.fn() },
	utils: { private_download_url: vi.fn(() => 'https://cloudinary.test/private.png') },
	uploader: { upload_stream: vi.fn() },
}));
const authorized = vi.hoisted(() => ({ ownerDatabase: vi.fn() }));
const appConfig = vi.hoisted(() => ({
	getAppConfig: vi.fn(() => ({
		cloudinaryConfigured: true,
		cloudinaryCloudName: 'test-cloud',
		cloudinaryApiKey: 'test-key',
		cloudinaryApiSecret: 'test-secret',
		maxUploadBytes: 10 * 1024 * 1024,
	})),
}));

vi.mock('cloudinary', () => ({ v2: cloudinary }));
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/config.js', () => appConfig);

import { actions } from './+page.server.js';
import { POST as uploadPost } from '../../api/media/upload/+server.js';

const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let imageBytes: Buffer;
let currentAsset: Record<string, unknown>;
let updates: Array<Record<string, unknown>>;

function setupDatabase() {
	type Query = {
		select: () => Query;
		update: (values: Record<string, unknown>) => Query;
		eq: (field: string, value: unknown) => Query;
		in: (field: string, values: unknown[]) => Query;
		maybeSingle: () => Promise<{ data: Record<string, unknown>; error: null }>;
		then: <TResult>(
			resolve: (value: { error: null }) => TResult | PromiseLike<TResult>,
		) => Promise<TResult>;
	};
	const query = {} as Query;
	query.select = vi.fn(() => query);
	query.update = vi.fn((values: Record<string, unknown>) => {
		updates.push(values);
		return query;
	});
	query.eq = vi.fn(() => query);
	query.in = vi.fn(() => query);
	query.maybeSingle = vi.fn(async () => ({ data: currentAsset, error: null }));
	query.then = (resolve) => Promise.resolve({ error: null }).then(resolve);
	const db = { from: vi.fn(() => query) };
	vi.mocked(authorized.ownerDatabase).mockReturnValue({ db, owner: { id: ownerId } } as never);
}

function makeEvent() {
	const form = new FormData();
	form.set('assetId', assetId);
	return {
		request: new Request('http://localhost/app/library?/reconcileAsset', {
			method: 'POST',
			body: form,
		}),
	} as never;
}

describe('Cloudinary media reconciliation', () => {
	beforeAll(async () => {
		imageBytes = await sharp({
			create: { width: 2, height: 2, channels: 3, background: '#345678' },
		})
			.png()
			.toBuffer();
	});

	beforeEach(() => {
		updates = [];
		currentAsset = {
			id: assetId,
			public_id: 'dif-studio/orphaned-fixture',
			delivery_type: 'authenticated',
			upload_status: 'ORPHANED',
		};
		cloudinary.api.resource.mockResolvedValue({
			asset_id: 'cloudinary-asset-123',
			version: 42,
			format: 'png',
		});
		cloudinary.utils.private_download_url.mockReturnValue('https://cloudinary.test/private.png');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(Uint8Array.from(imageBytes), {
						status: 200,
						headers: { 'content-type': 'image/png' },
					}),
			),
		);
		setupDatabase();
	});

	it('revalidates the private image and finalizes metadata with a SHA-256 hash', async () => {
		const result = await actions.reconcileAsset(makeEvent());
		expect(result).toEqual({ reconciled: true });
		expect(cloudinary.api.resource).toHaveBeenCalledWith('dif-studio/orphaned-fixture', {
			resource_type: 'image',
			type: 'authenticated',
		});
		expect(updates[0]).toMatchObject({
			cloudinary_asset_id: 'cloudinary-asset-123',
			format: 'png',
			byte_size: imageBytes.length,
			width: 2,
			height: 2,
			asset_version: 42,
			upload_status: 'READY',
			safe_error_code: null,
		});
		expect(updates[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it('marks missing Cloudinary assets failed and leaves transient API errors reconcilable', async () => {
		cloudinary.api.resource.mockRejectedValueOnce({ error: { http_code: 404 } });
		const missing = await actions.reconcileAsset(makeEvent());
		expect(missing).toEqual({ reconciled: false });
		expect(updates[0]).toMatchObject({
			upload_status: 'FAILED',
			safe_error_code: 'CLOUDINARY_ASSET_NOT_FOUND',
		});

		updates = [];
		cloudinary.api.resource.mockRejectedValueOnce(new Error('upstream unavailable'));
		const unavailable = await actions.reconcileAsset(makeEvent());
		expect(unavailable).toEqual({ reconciled: false });
		expect(updates[0]).toMatchObject({
			upload_status: 'ORPHANED',
			safe_error_code: 'CLOUDINARY_RECONCILIATION_FAILED',
		});
	});

	it('does not mark a corrupt private image ready', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not an image', { status: 200 })),
		);
		const result = await actions.reconcileAsset(makeEvent());
		expect(result).toMatchObject({ status: 415 });
		expect(updates).toHaveLength(0);
	});

	it('keeps an ambiguous failed upload available for reconciliation', async () => {
		const insertQuery = {
			insert: vi.fn(() => insertQuery),
			select: vi.fn(() => insertQuery),
			single: vi.fn(async () => ({ data: { id: assetId }, error: null })),
		};
		const updateQuery = {
			update: vi.fn((values: Record<string, unknown>) => {
				updates.push(values);
				return updateQuery;
			}),
			eq: vi.fn(() => updateQuery),
			then: (resolve: (value: { error: null }) => unknown) =>
				Promise.resolve({ error: null }).then(resolve),
		};
		let databaseCalls = 0;
		const db = { from: vi.fn(() => (databaseCalls++ === 0 ? insertQuery : updateQuery)) };
		vi.mocked(authorized.ownerDatabase).mockReturnValue({ db, owner: { id: ownerId } } as never);
		cloudinary.uploader.upload_stream.mockImplementation((_options, callback) => ({
			end: () => callback(new Error('synthetic Cloudinary outage'), undefined),
		}));
		const form = new FormData();
		form.set('file', new File([Uint8Array.from(imageBytes)], 'fixture.png', { type: 'image/png' }));
		form.set('assetKind', 'FRAME');
		form.set('rightsConfirmed', 'on');
		const event = {
			request: new Request('http://localhost/api/media/upload', { method: 'POST', body: form }),
		} as never;
		await expect(uploadPost(event)).rejects.toMatchObject({
			status: 303,
			location: '/app/library?upload=failed',
		});
		expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'authenticated', overwrite: false }),
			expect.any(Function),
		);
		expect(updates.at(-1)).toMatchObject({
			upload_status: 'ORPHANED',
			safe_error_code: 'CLOUDINARY_UPLOAD_OUTCOME_UNKNOWN',
		});
	});
});
