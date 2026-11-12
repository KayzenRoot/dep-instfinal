import { describe, expect, it } from 'vitest';
import { hasMp4Magic, validateProbe, type ProbeResult } from './video-probe.js';

const valid: ProbeResult = {
	container: 'mov,mp4,m4a,3gp,3g2,mj2',
	codec: 'h264',
	durationMs: 8000,
	width: 1080,
	height: 1920,
	rotation: 0,
};

describe('video probe validation', () => {
	it('accepts an 8 s 1080x1920 H.264 MP4', () => {
		expect(validateProbe(valid, 8000)).toEqual({ ok: true, result: valid });
	});

	it('accepts a rotated 1920x1080 source as 9:16', () => {
		const result = validateProbe({ ...valid, width: 1920, height: 1080, rotation: 90 }, 8000);
		expect(result.ok).toBe(true);
		if (result.ok) expect([result.result.width, result.result.height]).toEqual([1080, 1920]);
	});

	it('rejects duration outside the 500 ms tolerance', () => {
		expect(validateProbe({ ...valid, durationMs: 8600 }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_DURATION_MISMATCH',
		});
	});

	it('rejects non-9:16 video', () => {
		expect(validateProbe({ ...valid, width: 1920, height: 1080 }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_ASPECT_INVALID',
		});
	});

	it('rejects non-H.264 codecs', () => {
		expect(validateProbe({ ...valid, codec: 'hevc' }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_CODEC_UNSUPPORTED',
		});
	});

	it('rejects containers that are not MP4/MOV', () => {
		expect(validateProbe({ ...valid, container: 'matroska,webm' }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_CONTAINER_UNSUPPORTED',
		});
	});

	it('detects MP4 magic bytes only at the expected offset', () => {
		expect(hasMp4Magic(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))).toBe(true);
		expect(hasMp4Magic(Buffer.from('not an mp4'))).toBe(false);
	});
});
