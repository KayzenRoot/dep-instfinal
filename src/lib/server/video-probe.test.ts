import { describe, expect, it } from 'vitest';
import {
	hasMp4Magic,
	mediaProcessEnv,
	parseFfprobeOutput,
	validateProbe,
	type ProbeResult,
} from './video-probe.js';

const valid: ProbeResult = {
	container: 'mov,mp4,m4a,3gp,3g2,mj2',
	codec: 'h264',
	durationMs: 8000,
	width: 1080,
	height: 1920,
	rotation: 0,
	frameRate: 30,
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

	it('rejects an invalid frame rate', () => {
		expect(validateProbe({ ...valid, frameRate: 0 }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_FRAME_RATE_INVALID',
		});
	});

	it('rejects a variable frame rate stream', () => {
		expect(validateProbe({ ...valid, variableFrameRate: true }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_FRAME_RATE_VARIABLE',
		});
	});

	it('rejects an implausible frame count for the duration', () => {
		expect(validateProbe({ ...valid, frameCount: 1 }, 8000)).toMatchObject({
			ok: false,
			code: 'VIDEO_FRAME_RATE_INVALID',
		});
	});

	it('accepts a plausible frame count for the duration', () => {
		expect(validateProbe({ ...valid, frameCount: 240 }, 8000).ok).toBe(true);
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

describe('ffprobe JSON parsing', () => {
	const output = (stream: Record<string, unknown>, format: Record<string, unknown> = {}) =>
		JSON.stringify({
			format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '8.000000', ...format },
			streams: [
				{
					codec_type: 'video',
					codec_name: 'h264',
					width: 1080,
					height: 1920,
					avg_frame_rate: '30/1',
					r_frame_rate: '30/1',
					nb_frames: '240',
					...stream,
				},
			],
		});

	it('parses a constant-frame-rate stream', () => {
		expect(parseFfprobeOutput(output({}))).toMatchObject({
			codec: 'h264',
			durationMs: 8000,
			frameRate: 30,
			frameCount: 240,
			variableFrameRate: false,
		});
	});

	it('flags average/nominal frame-rate divergence as VFR', () => {
		expect(
			parseFfprobeOutput(output({ avg_frame_rate: '30000/1001', r_frame_rate: '60/1' })),
		).toMatchObject({ variableFrameRate: true });
	});

	it('falls back to the nominal rate when average is absent', () => {
		expect(parseFfprobeOutput(output({ avg_frame_rate: '0/0' }))).toMatchObject({
			frameRate: 30,
			variableFrameRate: false,
		});
	});

	it('rejects output without a video stream', () => {
		expect(() => parseFfprobeOutput(JSON.stringify({ format: {}, streams: [] }))).toThrow(
			'ffprobe did not return a video stream.',
		);
	});
});

describe('ffprobe child environment', () => {
	it('does not pass service or storage secrets to ffprobe', () => {
		const env = mediaProcessEnv();
		expect(Object.keys(env).sort()).toEqual(['PATH', 'SystemRoot']);
		expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
		expect(env.R2_SECRET_ACCESS_KEY).toBeUndefined();
	});
});
