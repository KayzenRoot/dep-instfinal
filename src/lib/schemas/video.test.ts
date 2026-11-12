import { describe, expect, it } from 'vitest';
import { videoUploadCompleteSchema, videoUploadInitSchema } from './video.js';

const validInit = {
	episodeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
	sceneId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
	fileName: 'flow-scene-01.mp4',
	byteSize: 12_345_678,
	contentType: 'video/mp4',
	idempotencyKey: 'upload:scene-01:001',
};

describe('video upload schemas', () => {
	it('accepts a valid upload init', () => {
		expect(videoUploadInitSchema.safeParse(validInit).success).toBe(true);
	});

	it('rejects path traversal in a display file name', () => {
		expect(
			videoUploadInitSchema.safeParse({ ...validInit, fileName: '../scene.mp4' }).success,
		).toBe(false);
		expect(
			videoUploadInitSchema.safeParse({ ...validInit, fileName: 'folder/scene.mp4' }).success,
		).toBe(false);
	});

	it('rejects an invalid idempotency key', () => {
		expect(
			videoUploadInitSchema.safeParse({ ...validInit, idempotencyKey: 'bad key with spaces' })
				.success,
		).toBe(false);
	});

	it('rejects an oversized clip', () => {
		expect(videoUploadInitSchema.safeParse({ ...validInit, byteSize: 209_715_201 }).success).toBe(
			false,
		);
	});

	it('requires ordered part numbers and non-empty ETags', () => {
		expect(
			videoUploadCompleteSchema.safeParse({ parts: [{ partNumber: 1, etag: 'etag-1' }] }).success,
		).toBe(true);
		expect(
			videoUploadCompleteSchema.safeParse({ parts: [{ partNumber: 1, etag: '' }] }).success,
		).toBe(false);
	});
});
