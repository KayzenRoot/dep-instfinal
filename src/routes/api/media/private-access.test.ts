import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloudinary = vi.hoisted(() => ({
	config: vi.fn(),
	utils: { private_download_url: vi.fn(() => 'https://cloudinary.test/private.png') },
}));
const authorized = vi.hoisted(() => ({ ownerDatabase: vi.fn() }));
const appConfig = vi.hoisted(() => ({
	getAppConfig: vi.fn(() => ({
		cloudinaryConfigured: true,
		cloudinaryCloudName: 'test-cloud',
		cloudinaryApiKey: 'test-key',
		cloudinaryApiSecret: 'test-secret',
	})),
}));

vi.mock('cloudinary', () => ({ v2: cloudinary }));
vi.mock('#lib/server/authorized.js', () => authorized);
vi.mock('#lib/server/config.js', () => appConfig);

import { GET as exportEpisode } from '../export/[episodeId]/+server.js';
import { GET as privateMedia } from './[assetId]/+server.js';

type Result = { data: unknown; error: null };
type Query = {
	select: () => Query;
	eq: (field: string, value: unknown) => Query;
	in: (field: string, values: unknown[]) => Query;
	order: (field: string) => Query;
	maybeSingle: () => Promise<Result>;
	then: (resolve: (result: Result) => unknown) => Promise<unknown>;
};

const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const episodeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const privateAsset = {
	id: assetId,
	public_id: 'dif-studio/private-fixture',
	resource_type: 'image',
	delivery_type: 'authenticated',
	format: 'png',
	upload_status: 'READY',
};

function setupDatabase(results: Record<string, Result>) {
	const filters: Array<{ table: string; field: string; value: unknown }> = [];
	const db = {
		from: vi.fn((table: string) => {
			const result = results[table] ?? { data: [], error: null };
			const query: Query = {
				select: () => query,
				eq: (field, value) => {
					filters.push({ table, field, value });
					return query;
				},
				in: (field, value) => {
					filters.push({ table, field, value });
					return query;
				},
				order: () => query,
				maybeSingle: async () => result,
				then: (resolve) => Promise.resolve(result).then(resolve),
			};
			return query;
		}),
	};
	vi.mocked(authorized.ownerDatabase).mockReturnValue({ db, owner: { id: ownerId } } as never);
	return { filters };
}

function mediaEvent() {
	return {
		params: { assetId },
		request: new Request(`http://localhost/api/media/${assetId}`),
	} as never;
}

function exportEvent() {
	return {
		params: { episodeId },
		request: new Request(`http://localhost/api/export/${episodeId}`),
	} as never;
}

describe('private media authorization and export', () => {
	beforeEach(() => {
		cloudinary.utils.private_download_url.mockReturnValue('https://cloudinary.test/private.png');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })),
		);
	});

	afterEach(() => vi.unstubAllGlobals());

	it('serves only an owner-scoped READY private image without caching it', async () => {
		const { filters } = setupDatabase({ media_assets: { data: privateAsset, error: null } });
		const response = await privateMedia(mediaEvent());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await response.arrayBuffer()).byteLength).toBe(4);
		expect(filters).toContainEqual({ table: 'media_assets', field: 'owner_id', value: ownerId });
		expect(cloudinary.utils.private_download_url).toHaveBeenCalledWith(
			privateAsset.public_id,
			privateAsset.format,
			expect.objectContaining({ resource_type: 'image', type: 'authenticated' }),
		);
	});

	it('does not sign or fetch an asset absent from the authenticated owner query', async () => {
		setupDatabase({ media_assets: { data: null, error: null } });

		await expect(privateMedia(mediaEvent())).rejects.toMatchObject({ status: 404 });
		expect(cloudinary.utils.private_download_url).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('includes an authenticated owner image in the ZIP export', async () => {
		const episode = {
			id: episodeId,
			title: 'Private export fixture',
			episode_number: 1,
			status: 'DRAFT',
			duration_ms: 120000,
			narration_pt_br: '',
			platform_metadata: {},
			is_season_finale: false,
			seasons: { title: 'Season one', series: { title: 'Fixture series', premise: '', tone: '' } },
		};
		const scene = {
			scene_index: 1,
			start_ms: 0,
			end_ms: 8000,
			narration_pt_br: '',
			visual_description: '',
			camera_notes: '',
			lighting_notes: '',
			start_frame_prompt_en: '',
			end_frame_prompt_en: '',
			motion_prompt_en: '',
			audio_notes: '',
			start_frame_asset_id: assetId,
			end_frame_asset_id: null,
		};
		const { filters } = setupDatabase({
			episodes: { data: episode, error: null },
			scenes: { data: [scene], error: null },
			choices: { data: [], error: null },
			media_assets: { data: [privateAsset], error: null },
		});

		const response = await exportEpisode(exportEvent());
		const archive = Buffer.from(await response.arrayBuffer());

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
		expect(archive.toString('latin1')).toContain('media/scene-01-start.png');
		expect(filters).toContainEqual({ table: 'media_assets', field: 'owner_id', value: ownerId });
		expect(cloudinary.utils.private_download_url).toHaveBeenCalledWith(
			privateAsset.public_id,
			privateAsset.format,
			expect.objectContaining({ resource_type: 'image', type: 'authenticated' }),
		);
	});

	it('omits a foreign or missing asset from ZIP export without requesting it from Cloudinary', async () => {
		const episode = {
			id: episodeId,
			title: 'Owner export fixture',
			episode_number: 1,
			status: 'DRAFT',
			duration_ms: 120000,
			narration_pt_br: '',
			platform_metadata: {},
			is_season_finale: false,
			seasons: null,
		};
		const scene = {
			scene_index: 1,
			start_ms: 0,
			end_ms: 8000,
			narration_pt_br: '',
			visual_description: '',
			camera_notes: '',
			lighting_notes: '',
			start_frame_prompt_en: '',
			end_frame_prompt_en: '',
			motion_prompt_en: '',
			audio_notes: '',
			start_frame_asset_id: assetId,
			end_frame_asset_id: null,
		};
		setupDatabase({
			episodes: { data: episode, error: null },
			scenes: { data: [scene], error: null },
			choices: { data: [], error: null },
			media_assets: { data: [], error: null },
		});

		const response = await exportEpisode(exportEvent());
		const archive = Buffer.from(await response.arrayBuffer());

		expect(response.status).toBe(200);
		expect(archive.toString('latin1')).not.toContain('media/scene-01-start.png');
		expect(cloudinary.utils.private_download_url).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
});
