import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from './config.js';
import {
	InMemoryVideoStorage,
	R2VideoStorage,
	finalVideoObjectKey,
	quarantineObjectKey,
} from './video-storage.js';

describe('in-memory video storage contract', () => {
	it('completes multipart parts, hashes, copies and signs the final object', async () => {
		const storage = new InMemoryVideoStorage();
		const key = 'quarantine/owner/session/source';
		const session = await storage.createMultipart({ key, contentType: 'video/mp4' });
		const first = Buffer.from('part-one-');
		const second = Buffer.from('part-two');
		storage.putPartForTest(session.uploadId, 1, first);
		storage.putPartForTest(session.uploadId, 2, second);
		const stored = await storage.completeMultipart({
			key,
			uploadId: session.uploadId,
			parts: [
				{ partNumber: 1, etag: 'one' },
				{ partNumber: 2, etag: 'two' },
			],
		});
		expect(stored.size).toBe(first.length + second.length);
		expect(await storage.hashObject(key)).toBe(
			createHash('sha256')
				.update(Buffer.concat([first, second]))
				.digest('hex'),
		);
		expect((await storage.readPrefix(key, 4)).toString()).toBe('part');
		const final = await storage.copyToFinal({
			sourceKey: key,
			destinationKey: 'owners/owner/final.mp4',
		});
		expect(final.size).toBe(stored.size);
		expect(await storage.signDownload('owners/owner/final.mp4')).toContain(
			'/api/video/dev-object/',
		);
		await storage.deleteObject('owners/owner/final.mp4');
		await expect(storage.statObject('owners/owner/final.mp4')).rejects.toThrow('Object not found.');
	});

	it('rejects a missing part instead of producing a partial object', async () => {
		const storage = new InMemoryVideoStorage();
		const session = await storage.createMultipart({
			key: 'quarantine/owner/session/source',
			contentType: 'video/mp4',
		});
		storage.putPartForTest(session.uploadId, 1, Buffer.from('only-one'));
		await expect(
			storage.completeMultipart({
				key: 'quarantine/owner/session/source',
				uploadId: session.uploadId,
				parts: [
					{ partNumber: 1, etag: 'one' },
					{ partNumber: 2, etag: 'two' },
				],
			}),
		).rejects.toThrow('Missing upload part 2.');
	});

	it('builds opaque path-safe keys for quarantine and final objects', () => {
		expect(quarantineObjectKey('owner', 'session')).toBe('quarantine/owner/session/source');
		expect(
			finalVideoObjectKey({
				ownerId: 'owner',
				episodeId: 'episode',
				sceneId: 'scene',
				assetId: 'asset',
				version: 2,
			}),
		).toBe('owners/owner/episodes/episode/scenes/scene/v2/asset.mp4');
	});

	it('presigns R2 multipart parts without exposing credentials in the URL', async () => {
		const config = {
			r2AccountId: 'account',
			r2AccessKeyId: 'test-access-key',
			r2SecretAccessKey: 'test-secret-key',
			r2Bucket: 'dif-studio-video-private',
			r2Endpoint: 'https://account.r2.cloudflarestorage.com',
			r2Configured: true,
		} as unknown as AppConfig;
		const storage = new R2VideoStorage(config);
		const part = await storage.signPart({
			key: 'quarantine/owner/session/source',
			uploadId: 'upload-id',
			partNumber: 1,
		});
		expect(part.partNumber).toBe(1);
		expect(part.url).toContain('dif-studio-video-private');
		expect(part.url).toContain('X-Amz-Signature');
		expect(part.url).not.toContain('test-secret-key');
	});
});
