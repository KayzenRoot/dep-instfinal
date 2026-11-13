import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	buildNarrationMuxCommand,
	buildRenderCommand,
	RenderCompositionError,
	type RenderAssetInput,
} from '#lib/domain/render-composition.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

const execFileAsync = promisify(execFile);

function minimalProcessEnv(tmpDir: string): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH ?? '',
		SystemRoot: process.env.SystemRoot,
		TEMP: tmpDir,
		TMP: tmpDir,
	};
}

export interface RenderedAudio {
	codec: string;
	channels: number;
	sampleRate: number;
	durationMs: number;
	narrationTakeId: string;
	narrationDurationMs: number;
	paddedMs: number;
	trimmedMs: number;
}

export interface RenderOutput {
	path: string;
	durationMs: number;
	width: number;
	height: number;
	codec: string;
	container: string;
	byteSize: number;
	sha256: string;
	audio: RenderedAudio | null;
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
		profile?: string;
		pix_fmt?: string;
		sample_rate?: string;
		channels?: number;
	}>;
}

export interface AudioProbe {
	durationMs: number;
	codec: string;
	sampleRate: number;
	channels: number;
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
	profile: string | null;
	pixFmt: string | null;
	audio: AudioProbe | null;
}> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
		{
			timeout: 30_000,
			maxBuffer: 2 * 1024 * 1024,
			windowsHide: true,
			env: minimalProcessEnv(dirname(path)),
		},
	);
	const parsed = JSON.parse(stdout) as ProbeOutput;
	const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
	const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
	if (!video || !video.codec_name || !video.width || !video.height)
		throw new RenderCompositionError('RENDER_PROBE_FAILED', 'ffprobe não encontrou vídeo.');
	const durationSeconds = Number(parsed.format?.duration ?? video.duration);
	const audioDuration = Number(audio?.duration ?? durationSeconds);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
		throw new RenderCompositionError('RENDER_PROBE_FAILED', 'ffprobe retornou duração inválida.');
	const durationMs = Math.round(durationSeconds * 1000);
	const [numerator, denominator] = (video.avg_frame_rate ?? '0/1').split('/').map(Number);
	return {
		durationMs,
		width: video.width,
		height: video.height,
		codec: video.codec_name,
		container: parsed.format?.format_name ?? 'unknown',
		fps: denominator ? numerator / denominator : 0,
		profile: video.profile ?? null,
		pixFmt: video.pix_fmt ?? null,
		audio:
			audio?.codec_name && Number.isFinite(audioDuration) && audioDuration > 0
				? {
						durationMs: Math.round(audioDuration * 1000),
						codec: audio.codec_name,
						sampleRate: Number(audio.sample_rate ?? 0),
						channels: audio.channels ?? 0,
					}
				: null,
	};
}

export async function probeAudioMedia(path: string, ffprobePath = 'ffprobe'): Promise<AudioProbe> {
	const { stdout } = await execFileAsync(
		ffprobePath,
		['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
		{
			timeout: 30_000,
			maxBuffer: 2 * 1024 * 1024,
			windowsHide: true,
			env: minimalProcessEnv(dirname(path)),
		},
	);
	const parsed = JSON.parse(stdout) as ProbeOutput;
	const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
	const durationSeconds = Number(parsed.format?.duration ?? audio?.duration);
	if (!audio?.codec_name || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
		throw new RenderCompositionError('NARRATION_PROBE_FAILED', 'ffprobe não encontrou áudio.');
	return {
		durationMs: Math.round(durationSeconds * 1000),
		codec: audio.codec_name,
		sampleRate: Number(audio.sample_rate ?? 0),
		channels: audio.channels ?? 0,
	};
}

export interface NarrationRenderInput {
	path: string;
	durationMs: number;
	takeId: string;
	volumeDb?: number;
}

export async function renderPlanToFile(input: {
	plan: VideoEditPlan;
	assets: RenderAssetInput[];
	outputPath: string;
	ffmpegPath?: string;
	ffprobePath?: string;
	vhsIntensity?: 0 | 1 | 2 | 3;
	timeoutMs?: number;
	narration?: NarrationRenderInput;
}): Promise<RenderOutput> {
	const videoPath = input.narration ? `${input.outputPath}.video.mp4` : input.outputPath;
	const command = buildRenderCommand(input.plan, input.assets, videoPath, {
		ffmpegPath: input.ffmpegPath,
		vhsIntensity: input.vhsIntensity,
	});
	await execFileAsync(input.ffmpegPath ?? 'ffmpeg', ['-nostdin', ...command.args], {
		timeout: input.timeoutMs ?? 600_000,
		maxBuffer: 4 * 1024 * 1024,
		windowsHide: true,
		env: minimalProcessEnv(dirname(input.outputPath)),
	});
	let mux = null as ReturnType<typeof buildNarrationMuxCommand> | null;
	if (input.narration) {
		try {
			mux = buildNarrationMuxCommand({
				videoPath,
				narrationPath: input.narration.path,
				outputPath: input.outputPath,
				videoDurationMs: command.expectedDurationMs,
				narrationDurationMs: input.narration.durationMs,
				volumeDb: input.narration.volumeDb,
			});
			await execFileAsync(input.ffmpegPath ?? 'ffmpeg', ['-nostdin', ...mux.args], {
				timeout: input.timeoutMs ?? 600_000,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
				env: minimalProcessEnv(dirname(input.outputPath)),
			});
		} finally {
			await unlink(videoPath).catch(() => undefined);
		}
	}
	const probed = await probeMedia(input.outputPath, input.ffprobePath);
	if (probed.codec !== 'h264')
		throw new RenderCompositionError('RENDER_OUTPUT_CODEC', 'O render não produziu H.264.');
	if (!probed.profile || !/^(High|Main|Baseline|Constrained Baseline)/.test(probed.profile))
		throw new RenderCompositionError('RENDER_OUTPUT_PROFILE', 'Perfil H.264 do render inválido.');
	if (probed.pixFmt !== 'yuv420p')
		throw new RenderCompositionError(
			'RENDER_OUTPUT_PIX_FMT',
			'Pixel format do render não é yuv420p.',
		);
	if (probed.width !== 1080 || probed.height !== 1920)
		throw new RenderCompositionError('RENDER_OUTPUT_GEOMETRY', 'O render não está em 1080x1920.');
	if (
		!Number.isFinite(probed.durationMs) ||
		Math.abs(probed.durationMs - command.expectedDurationMs) > 1_000
	)
		throw new RenderCompositionError(
			'RENDER_OUTPUT_DURATION',
			`Duração do render fora de ±1s (${probed.durationMs} vs ${command.expectedDurationMs}).`,
		);
	if (probed.fps < 29 || probed.fps > 31)
		throw new RenderCompositionError('RENDER_OUTPUT_FPS', 'FPS do render não é 30.');
	let renderedAudio: RenderedAudio | null = null;
	if (mux && input.narration) {
		if (
			!probed.audio ||
			probed.audio.codec !== 'aac' ||
			probed.audio.channels !== 2 ||
			probed.audio.sampleRate !== 48_000
		)
			throw new RenderCompositionError(
				'NARRATION_OUTPUT_CODEC',
				'O render não contém AAC 48 kHz estéreo.',
			);
		if (Math.abs(probed.audio.durationMs - probed.durationMs) > 1_000)
			throw new RenderCompositionError(
				'NARRATION_OUTPUT_DURATION',
				'A duração do áudio não acompanha o vídeo.',
			);
		renderedAudio = {
			codec: probed.audio.codec,
			channels: probed.audio.channels,
			sampleRate: probed.audio.sampleRate,
			durationMs: probed.audio.durationMs,
			narrationTakeId: input.narration.takeId,
			narrationDurationMs: input.narration.durationMs,
			paddedMs: mux.paddedMs,
			trimmedMs: mux.trimmedMs,
		};
	} else if (probed.audio) {
		throw new RenderCompositionError(
			'RENDER_OUTPUT_UNEXPECTED_AUDIO',
			'O render sem narração não pode conter áudio.',
		);
	}
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
		audio: renderedAudio,
	};
}
