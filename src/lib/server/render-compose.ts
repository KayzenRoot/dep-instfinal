import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildAudioMixCommand,
	buildNarrationMuxCommand,
	buildRenderCommand,
	RenderCompositionError,
	type AudioMixEvent,
	type RenderAssetInput,
} from '#lib/domain/render-composition.js';
import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
import { measureAudioLoudness } from './audio-analysis.js';
import { acceptedDirectorEvents } from '#lib/domain/edit-director.js';

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
	narrationTakeId: string | null;
	narrationDurationMs: number | null;
	paddedMs: number;
	trimmedMs: number;
	eventCount: number;
	duckedCount: number;
	spatialModes: Record<string, number>;
	masterGainDb: number;
	truePeakDb: number | null;
	lufs: number | null;
}

export interface RenderOutput {
	path: string;
	durationMs: number;
	width: number;
	height: number;
	fps: number;
	pixelFormat: string;
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
	format: string;
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
						format: parsed.format?.format_name ?? '',
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
		format: parsed.format?.format_name ?? '',
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
	captionAssPath?: string;
	endCardAssPath?: string;
	timeoutMs?: number;
	narration?: NarrationRenderInput;
	audioEvents?: AudioMixEvent[];
	masterGainDb?: number;
	width?: number;
	height?: number;
	quality?: 'standard' | 'high';
	threads?: number;
}): Promise<RenderOutput> {
	const absoluteOutput = resolve(input.outputPath);
	const expectedWidth = input.width ?? 1080;
	const expectedHeight = input.height ?? 1920;
	const assets = input.assets.map((asset) => ({ ...asset, path: resolve(asset.path) }));
	const audioEvents = (input.audioEvents ?? []).map((event) => ({
		...event,
		path: resolve(event.path),
	}));
	const hasAudio = Boolean(input.narration || audioEvents.length);
	const videoPath = hasAudio ? `${absoluteOutput}.video.mp4` : absoluteOutput;
	let captionDir: string | null = null;
	let captionAssFile: string | undefined;
	let endCardAssFile: string | undefined;
	if (input.captionAssPath || input.endCardAssPath) {
		captionDir = await mkdtemp(join(tmpdir(), 'dif-ass-'));
	}
	if (input.captionAssPath) {
		captionAssFile = 'captions.ass';
		try {
			await copyFile(input.captionAssPath, join(captionDir!, captionAssFile));
		} catch (cause) {
			await rm(captionDir!, { recursive: true, force: true });
			throw cause;
		}
	}
	if (input.endCardAssPath) {
		endCardAssFile = 'endcard.ass';
		try {
			await copyFile(input.endCardAssPath, join(captionDir!, endCardAssFile));
		} catch (cause) {
			await rm(captionDir!, { recursive: true, force: true });
			throw cause;
		}
	}
	try {
		const command = buildRenderCommand(input.plan, assets, videoPath, {
			ffmpegPath: input.ffmpegPath,
			vhsIntensity: input.vhsIntensity,
			captionAssFile,
			endCardAssFile,
			width: expectedWidth,
			height: expectedHeight,
			quality: input.quality,
			threads: input.threads,
		});
		await execFileAsync(input.ffmpegPath ?? 'ffmpeg', ['-nostdin', ...command.args], {
			timeout: input.timeoutMs ?? 600_000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
			cwd: captionDir ?? undefined,
			env: minimalProcessEnv(dirname(absoluteOutput)),
		});
		let mux = null as ReturnType<typeof buildNarrationMuxCommand> | null;
		let mix = null as ReturnType<typeof buildAudioMixCommand> | null;
		if (audioEvents.length) {
			mix = buildAudioMixCommand({
				videoPath,
				outputPath: absoluteOutput,
				videoDurationMs: command.expectedDurationMs,
				narration: input.narration
					? {
							path: resolve(input.narration.path),
							durationMs: input.narration.durationMs,
							volumeDb: input.narration.volumeDb,
						}
					: null,
				events: audioEvents,
				masterGainDb: input.masterGainDb,
				silenceWindows: acceptedDirectorEvents(input.plan.director, 'SILENCE_BEFORE_REVEAL').map(
					(event) => ({ startMs: event.startMs, durationMs: event.durationMs }),
				),
				narrationMuteWindows:
					input.plan.endCard?.narration === 'mute'
						? [
								{
									startMs: input.plan.endCard.startMs,
									durationMs: input.plan.endCard.endMs - input.plan.endCard.startMs,
								},
							]
						: undefined,
			});
		} else if (input.narration) {
			mux = buildNarrationMuxCommand({
				videoPath,
				narrationPath: resolve(input.narration.path),
				outputPath: absoluteOutput,
				videoDurationMs: command.expectedDurationMs,
				narrationDurationMs: input.narration.durationMs,
				volumeDb: (input.narration.volumeDb ?? 0) + (input.masterGainDb ?? 0),
				muteWindows:
					input.plan.endCard?.narration === 'mute'
						? [
								{
									startMs: input.plan.endCard.startMs,
									durationMs: input.plan.endCard.endMs - input.plan.endCard.startMs,
								},
							]
						: undefined,
			});
		}
		const audioCommand = mix ?? mux;
		if (audioCommand) {
			try {
				await execFileAsync(input.ffmpegPath ?? 'ffmpeg', ['-nostdin', ...audioCommand.args], {
					timeout: input.timeoutMs ?? 600_000,
					maxBuffer: 4 * 1024 * 1024,
					windowsHide: true,
					env: minimalProcessEnv(dirname(absoluteOutput)),
				});
			} finally {
				await unlink(videoPath).catch(() => undefined);
			}
		}
		const probed = await probeMedia(absoluteOutput, input.ffprobePath);
		if (probed.codec !== 'h264')
			throw new RenderCompositionError('RENDER_OUTPUT_CODEC', 'O render não produziu H.264.');
		if (!probed.profile || !/^(High|Main|Baseline|Constrained Baseline)/.test(probed.profile))
			throw new RenderCompositionError('RENDER_OUTPUT_PROFILE', 'Perfil H.264 do render inválido.');
		if (probed.pixFmt !== 'yuv420p')
			throw new RenderCompositionError(
				'RENDER_OUTPUT_PIX_FMT',
				'Pixel format do render não é yuv420p.',
			);
		if (probed.width !== expectedWidth || probed.height !== expectedHeight)
			throw new RenderCompositionError(
				'RENDER_OUTPUT_GEOMETRY',
				`O render não está em ${expectedWidth}x${expectedHeight}.`,
			);
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
		if (hasAudio) {
			if (
				!probed.audio ||
				probed.audio.codec !== 'aac' ||
				probed.audio.channels !== 2 ||
				probed.audio.sampleRate !== 48_000
			)
				throw new RenderCompositionError(
					'AUDIO_OUTPUT_CODEC',
					'O render não contém AAC 48 kHz estéreo.',
				);
			if (Math.abs(probed.audio.durationMs - probed.durationMs) > 1_000)
				throw new RenderCompositionError(
					'AUDIO_OUTPUT_DURATION',
					'A duração do áudio não acompanha o vídeo.',
				);
			const loudness = mix ? await measureAudioLoudness(absoluteOutput) : null;
			if (mix) {
				if (
					loudness?.truePeakDb === null ||
					loudness?.truePeakDb === undefined ||
					loudness.truePeakDb > -0.8
				)
					throw new RenderCompositionError(
						'AUDIO_MIX_TRUE_PEAK',
						'O mix excede o true peak seguro.',
					);
				if (loudness.lufs === null || loudness.lufs < -20 || loudness.lufs > -12)
					throw new RenderCompositionError(
						'AUDIO_MIX_LOUDNESS',
						'O mix está fora da faixa de loudness segura.',
					);
			}
			renderedAudio = {
				codec: probed.audio.codec,
				channels: probed.audio.channels,
				sampleRate: probed.audio.sampleRate,
				durationMs: probed.audio.durationMs,
				narrationTakeId: input.narration?.takeId ?? null,
				narrationDurationMs: input.narration?.durationMs ?? null,
				paddedMs: audioCommand?.paddedMs ?? 0,
				trimmedMs: audioCommand?.trimmedMs ?? 0,
				eventCount: mix?.eventCount ?? 0,
				duckedCount: mix?.duckedCount ?? 0,
				spatialModes: mix?.spatialModes ?? {},
				masterGainDb: input.masterGainDb ?? 0,
				truePeakDb: loudness?.truePeakDb ?? null,
				lufs: loudness?.lufs ?? null,
			};
		} else if (probed.audio) {
			throw new RenderCompositionError(
				'RENDER_OUTPUT_UNEXPECTED_AUDIO',
				'O render sem narração não pode conter áudio.',
			);
		}
		const bytes = await readFile(absoluteOutput);
		return {
			path: absoluteOutput,
			durationMs: probed.durationMs,
			width: probed.width,
			height: probed.height,
			fps: probed.fps,
			pixelFormat: probed.pixFmt ?? 'unknown',
			codec: probed.codec,
			container: probed.container,
			byteSize: (await stat(absoluteOutput)).size,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			audio: renderedAudio,
		};
	} finally {
		if (captionDir) await rm(captionDir, { recursive: true, force: true });
	}
}
