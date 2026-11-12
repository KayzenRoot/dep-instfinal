import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from './config.js';
import { getAppConfig } from './config.js';

const execFileAsync = promisify(execFile);

export const VIDEO_DURATION_TOLERANCE_MS = 500;
export const VIDEO_RATIO_TOLERANCE = 0.01;
export const VIDEO_MAX_WIDTH = 2160;
export const VIDEO_MAX_HEIGHT = 3840;

export interface ProbeResult {
	container: string;
	codec: string;
	durationMs: number;
	width: number;
	height: number;
	rotation: number;
}

export interface VideoProbe {
	probeFile(path: string): Promise<ProbeResult>;
}

export type ProbeValidation =
	{ ok: true; result: ProbeResult } | { ok: false; code: string; message: string };

export function hasMp4Magic(bytes: Buffer): boolean {
	return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
}

function displayDimensions(result: ProbeResult): { width: number; height: number } {
	const rotated = Math.abs(result.rotation) % 180 === 90;
	return rotated
		? { width: result.height, height: result.width }
		: { width: result.width, height: result.height };
}

export function validateProbe(result: ProbeResult, expectedDurationMs: number): ProbeValidation {
	if (!['mp4', 'mov'].some((container) => result.container.toLowerCase().includes(container))) {
		return {
			ok: false,
			code: 'VIDEO_CONTAINER_UNSUPPORTED',
			message: 'Container precisa ser MP4/MOV.',
		};
	}
	if (result.codec.toLowerCase() !== 'h264') {
		return { ok: false, code: 'VIDEO_CODEC_UNSUPPORTED', message: 'Codec precisa ser H.264.' };
	}
	if (
		!Number.isFinite(result.durationMs) ||
		Math.abs(result.durationMs - expectedDurationMs) > VIDEO_DURATION_TOLERANCE_MS
	) {
		return {
			ok: false,
			code: 'VIDEO_DURATION_MISMATCH',
			message: `Duração fora da tolerância de ${VIDEO_DURATION_TOLERANCE_MS} ms para a cena.`,
		};
	}
	const { width, height } = displayDimensions(result);
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width < 1 ||
		height < 1 ||
		width > VIDEO_MAX_WIDTH ||
		height > VIDEO_MAX_HEIGHT
	) {
		return {
			ok: false,
			code: 'VIDEO_DIMENSIONS_INVALID',
			message: 'Dimensões de vídeo inválidas.',
		};
	}
	const ratio = width / height;
	const target = 9 / 16;
	if (Math.abs(ratio - target) > VIDEO_RATIO_TOLERANCE) {
		return { ok: false, code: 'VIDEO_ASPECT_INVALID', message: 'O clipe precisa estar em 9:16.' };
	}
	return { ok: true, result: { ...result, width, height } };
}

export class FfprobeVideoProbe implements VideoProbe {
	constructor(private readonly command = 'ffprobe') {}

	async probeFile(path: string): Promise<ProbeResult> {
		const { stdout } = await execFileAsync(
			this.command,
			['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
			{ timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
		);
		const parsed = JSON.parse(stdout) as {
			format?: { format_name?: string; duration?: string };
			streams?: Array<{
				codec_type?: string;
				codec_name?: string;
				width?: number;
				height?: number;
				duration?: string;
				tags?: { rotate?: string };
				side_data_list?: Array<{ rotation?: number }>;
			}>;
		};
		const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
		if (!video || !video.codec_name || !video.width || !video.height)
			throw new Error('ffprobe did not return a video stream.');
		const durationSeconds = Number(parsed.format?.duration ?? video.duration);
		const rotationValue =
			video.side_data_list?.find((entry) => typeof entry.rotation === 'number')?.rotation ??
			Number(video.tags?.rotate ?? 0);
		return {
			container: parsed.format?.format_name ?? 'unknown',
			codec: video.codec_name,
			durationMs: Math.round(durationSeconds * 1000),
			width: video.width,
			height: video.height,
			rotation: Number.isFinite(rotationValue) ? rotationValue : 0,
		};
	}
}

export class FixtureVideoProbe implements VideoProbe {
	constructor(
		private readonly result: ProbeResult = {
			container: 'mov,mp4,m4a,3gp,3g2,mj2',
			codec: 'h264',
			durationMs: 8000,
			width: 1080,
			height: 1920,
			rotation: 0,
		},
	) {}

	async probeFile(path: string): Promise<ProbeResult> {
		if (path.includes('invalid')) throw new Error('Synthetic invalid video fixture.');
		return { ...this.result };
	}
}

let cachedProbe: VideoProbe | null | undefined;

export function getVideoProbe(config: AppConfig = getAppConfig()): VideoProbe | null {
	if (cachedProbe !== undefined) return cachedProbe;
	if (config.videoProbeDriver === 'ffprobe') cachedProbe = new FfprobeVideoProbe();
	else if (config.videoProbeDriver === 'fixture') cachedProbe = new FixtureVideoProbe();
	else cachedProbe = null;
	return cachedProbe;
}

export function resetVideoProbeForTest(): void {
	cachedProbe = undefined;
}
