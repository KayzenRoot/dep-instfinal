import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import {
	buildRenderCommand,
	RenderCompositionError,
	type RenderAssetInput,
} from '#lib/domain/render-composition.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

const execFileAsync = promisify(execFile);

export interface RenderOutput {
	path: string;
	durationMs: number;
	width: number;
	height: number;
	codec: string;
	container: string;
	byteSize: number;
	sha256: string;
}

interface ProbeOutput {
	format?: { format_name?: string; duration?: string };
	streams?: Array<{
		codec_type?: string;
		codec_name?: string;
		width?: number;
		height?: number;
		duration?: string;
		avg_frame_rate?: string;
	}>;
}

export async function probeMedia(
	path: string,
	ffprobePath = 'ffprobe',
): Promise<{
	durationMs: number;
	width: number;
	height: number;
	codec: string;
	container: string;
	fps: number;
}> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
		{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
	);
	const parsed = JSON.parse(stdout) as ProbeOutput;
	const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
	if (!video || !video.codec_name || !video.width || !video.height)
		throw new RenderCompositionError('RENDER_PROBE_FAILED', 'ffprobe não encontrou vídeo.');
	const durationMs = Math.round(Number(parsed.format?.duration ?? video.duration) * 1000);
	const [numerator, denominator] = (video.avg_frame_rate ?? '0/1').split('/').map(Number);
	return {
		durationMs,
		width: video.width,
		height: video.height,
		codec: video.codec_name,
		container: parsed.format?.format_name ?? 'unknown',
		fps: denominator ? numerator / denominator : 0,
	};
}

export async function renderPlanToFile(input: {
	plan: VideoEditPlan;
	assets: RenderAssetInput[];
	outputPath: string;
	ffmpegPath?: string;
	ffprobePath?: string;
	vhsIntensity?: 0 | 1 | 2 | 3;
	timeoutMs?: number;
}): Promise<RenderOutput> {
	const command = buildRenderCommand(input.plan, input.assets, input.outputPath, {
		ffmpegPath: input.ffmpegPath,
		vhsIntensity: input.vhsIntensity,
	});
	await execFileAsync(input.ffmpegPath ?? 'ffmpeg', ['-nostdin', ...command.args], {
		timeout: input.timeoutMs ?? 600_000,
		maxBuffer: 4 * 1024 * 1024,
		windowsHide: true,
	});
	const probed = await probeMedia(input.outputPath, input.ffprobePath);
	if (probed.codec !== 'h264')
		throw new RenderCompositionError('RENDER_OUTPUT_CODEC', 'O render não produziu H.264.');
	if (probed.width !== 1080 || probed.height !== 1920)
		throw new RenderCompositionError('RENDER_OUTPUT_GEOMETRY', 'O render não está em 1080x1920.');
	if (
		!Number.isFinite(probed.durationMs) ||
		Math.abs(probed.durationMs - input.plan.durationMs) > 1_000
	)
		throw new RenderCompositionError('RENDER_OUTPUT_DURATION', 'Duração do render fora de ±1s.');
	if (probed.fps < 29 || probed.fps > 31)
		throw new RenderCompositionError('RENDER_OUTPUT_FPS', 'FPS do render não é 30.');
	const bytes = await readFile(input.outputPath);
	return {
		path: input.outputPath,
		durationMs: probed.durationMs,
		width: probed.width,
		height: probed.height,
		codec: probed.codec,
		container: probed.container,
		byteSize: (await stat(input.outputPath)).size,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}
