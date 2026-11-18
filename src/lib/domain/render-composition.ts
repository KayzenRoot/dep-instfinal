import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';
import type {
	AudioKind,
	AudioSpatialMode,
	AudioSpatialPreset,
} from '#lib/schemas/audio-library.js';
import { acceptedDirectorEvents } from './edit-director.js';
import { narrationDurationPolicy } from './voice-direction.js';

export class RenderCompositionError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'RenderCompositionError';
	}
}

export interface RenderAssetInput {
	assetId: string;
	path: string;
	durationMs: number;
	width: number;
	height: number;
}

export interface RenderCompositionOptions {
	ffmpegPath?: string;
	fps?: 30;
	width?: number;
	height?: number;
	quality?: 'standard' | 'high';
	threads?: number;
	vhsIntensity?: 0 | 1 | 2 | 3;
	/** ASS filename relative to the working directory chosen by the renderer. */
	captionAssFile?: string;
}

export interface RenderCommand {
	args: string[];
	filterGraph: string;
	expectedDurationMs: number;
	inputPaths: string[];
}

interface NormalizedClip {
	planIndex: number;
	inputIndex: number;
	durationMs: number;
	sourceInMs: number;
	startMs: number;
	endMs: number;
	transition: 'cut' | 'crossfade';
	transitionMs: number;
}

interface Segment {
	clips: NormalizedClip[];
	startMs: number;
	durationMs: number;
}

function normalizedClips(plan: VideoEditPlan, inputs: RenderAssetInput[]): NormalizedClip[] {
	const inputById = new Map(inputs.map((input, index) => [input.assetId, { input, index }]));
	const seen = new Set<string>();
	const videoTrack = plan.tracks.find((track) => track.kind === 'video');
	if (!videoTrack)
		throw new RenderCompositionError(
			'RENDER_VIDEO_TRACK_MISSING',
			'O plano não tem track de vídeo.',
		);
	if (plan.clips.some((clip) => clip.trackId !== videoTrack.id))
		throw new RenderCompositionError(
			'RENDER_TRACK_UNSUPPORTED',
			'O worker WO-006 renderiza apenas a track de vídeo principal.',
		);
	return [...plan.clips]
		.sort((left, right) => left.timelineStartMs - right.timelineStartMs)
		.map((clip, planIndex) => {
			const input = inputById.get(clip.assetId);
			if (!input)
				throw new RenderCompositionError(
					'RENDER_ASSET_MISSING',
					`Clipe ${clip.id} não tem arquivo de entrada.`,
				);
			if (seen.has(clip.assetId))
				throw new RenderCompositionError(
					'RENDER_ASSET_DOUBLE_BOOKED',
					'O mesmo asset foi usado duas vezes.',
				);
			seen.add(clip.assetId);
			const durationMs = clip.sourceOutMs - clip.sourceInMs;
			if (durationMs <= 0 || clip.timelineEndMs - clip.timelineStartMs !== durationMs)
				throw new RenderCompositionError('RENDER_TRIM_INVALID', 'Trim de clipe inválido.');
			if (clip.sourceOutMs > input.input.durationMs)
				throw new RenderCompositionError(
					'RENDER_ASSET_TOO_SHORT',
					'O trim excede a duração do asset.',
				);
			return {
				planIndex,
				inputIndex: input.index,
				durationMs,
				sourceInMs: clip.sourceInMs,
				startMs: clip.timelineStartMs,
				endMs: clip.timelineEndMs,
				transition: clip.transition,
				transitionMs: clip.transitionMs,
			};
		});
}

function segments(clips: NormalizedClip[]): Segment[] {
	const result: Segment[] = [];
	let current: Segment | null = null;
	for (const clip of clips) {
		if (!current || (clip.transition === 'crossfade' && current.clips.length > 0)) {
			current = { clips: [clip], startMs: clip.startMs, durationMs: clip.durationMs };
			result.push(current);
		} else {
			current.clips.push(clip);
			current.durationMs += clip.durationMs;
		}
	}
	return result;
}

export function buildRenderCommand(
	plan: VideoEditPlan,
	inputs: RenderAssetInput[],
	outputPath: string,
	options: RenderCompositionOptions = {},
): RenderCommand {
	if (!outputPath || /(^|[\\/])\.\.([\\/]|$)/.test(outputPath))
		throw new RenderCompositionError('RENDER_OUTPUT_INVALID', 'Caminho de saída inválido.');
	const fps = options.fps ?? 30;
	const width = options.width ?? 1080;
	const height = options.height ?? 1920;
	const quality = options.quality ?? 'standard';
	if (!((width === 1080 && height === 1920) || (width === 720 && height === 1280)))
		throw new RenderCompositionError(
			'RENDER_OUTPUT_GEOMETRY_UNSUPPORTED',
			'A saída suporta apenas 1080x1920 ou o fallback 720x1280.',
		);
	if (quality !== 'standard' && quality !== 'high')
		throw new RenderCompositionError('RENDER_QUALITY_UNSUPPORTED', 'Qualidade de render inválida.');
	const threads = options.threads ?? 2;
	if (!Number.isInteger(threads) || threads < 1 || threads > 8)
		throw new RenderCompositionError('RENDER_THREADS_INVALID', 'Limite de threads inválido.');
	const vhs = options.vhsIntensity ?? 1;
	const clips = normalizedClips(plan, inputs);
	if (clips.length === 0)
		throw new RenderCompositionError('RENDER_PLAN_EMPTY', 'O plano não tem clipes.');
	if (clips.length > 60)
		throw new RenderCompositionError('RENDER_PLAN_TOO_LARGE', 'O plano excede 60 clipes.');
	for (let index = 0; index < clips.length; index += 1) {
		const clip = clips[index];
		const previous = clips[index - 1];
		if (!clip) continue;
		const expectedStart = previous
			? previous.endMs - (clip.transition === 'crossfade' ? clip.transitionMs : 0)
			: 0;
		if (clip.startMs !== expectedStart)
			throw new RenderCompositionError(
				'RENDER_TIMELINE_GAP',
				'A timeline tem lacuna ou offset não suportado pelo render.',
			);
	}
	const groups = segments(clips);
	const filters: string[] = [];
	for (const clip of clips) {
		const sourceIn = (clip.sourceInMs / 1000).toFixed(3);
		const duration = (clip.durationMs / 1000).toFixed(3);
		filters.push(
			`[${clip.inputIndex}:v]trim=start=${sourceIn}:duration=${duration},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p,settb=1/${fps}[v${clip.planIndex}]`,
		);
	}
	const segmentLabels: string[] = [];
	for (const [segmentIndex, group] of groups.entries()) {
		if (group.clips.length === 1) {
			segmentLabels.push(`v${group.clips[0]?.planIndex}`);
			continue;
		}
		const inputsList = group.clips.map((clip) => `[v${clip.planIndex}]`).join('');
		filters.push(
			`${inputsList}concat=n=${group.clips.length}:v=1:a=0,settb=1/${fps}[s${segmentIndex}]`,
		);
		segmentLabels.push(`s${segmentIndex}`);
	}
	let current = segmentLabels[0];
	if (!current) throw new RenderCompositionError('RENDER_PLAN_EMPTY', 'O plano não tem clipes.');
	for (let index = 1; index < segmentLabels.length; index += 1) {
		const segment = groups[index];
		const next = segmentLabels[index];
		if (!segment || !next)
			throw new RenderCompositionError('RENDER_SEGMENT_INVALID', 'Segmento inválido.');
		const transitionMs = segment.clips[0]?.transitionMs ?? 0;
		if (transitionMs < 1 || transitionMs > 1_000)
			throw new RenderCompositionError('RENDER_TRANSITION_INVALID', 'Crossfade inválido.');
		const offset = (segment.startMs / 1000).toFixed(3);
		const duration = (transitionMs / 1000).toFixed(3);
		const label = `x${index}`;
		filters.push(
			`[${current}][${next}]xfade=transition=fade:duration=${duration}:offset=${offset},settb=1/${fps}[${label}]`,
		);
		current = label;
	}
	if (options.captionAssFile) {
		if (!/^[A-Za-z0-9._-]+$/.test(options.captionAssFile))
			throw new RenderCompositionError(
				'RENDER_CAPTION_PATH_UNSAFE',
				'O nome do arquivo ASS deve ser simples e relativo.',
			);
		filters.push(`[${current}]ass=filename=${options.captionAssFile}[captioned]`);
		current = 'captioned';
	}
	const vhsWindows = acceptedDirectorEvents(plan.director, 'VHS_STATIC');
	if (vhsWindows.length) {
		const enable = vhsWindows
			.map(
				(window) =>
					`between(t,${(window.startMs / 1000).toFixed(3)},${((window.startMs + window.durationMs) / 1000).toFixed(3)})`,
			)
			.join('+');
		filters.push(
			`[${current}]eq=contrast=1.35:brightness=0.03:saturation=0.45:enable='${enable}'[glitch]`,
		);
		current = 'glitch';
	}
	if (vhs > 0) {
		const noise = 4 + vhs * 4;
		filters.push(
			`[${current}]noise=alls=${noise}:allf=t+u:all_seed=1,eq=contrast=${1 + vhs * 0.02}:saturation=${1 - vhs * 0.05},vignette=angle=PI/${5 + vhs}[outv]`,
		);
	} else {
		filters.push(`[${current}]null[outv]`);
	}
	const filterGraph = filters.join(';');
	const args = [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-filter_threads',
		String(threads),
		...clips.flatMap((clip) => ['-i', inputs[clip.inputIndex]?.path ?? '']),
		'-filter_complex',
		filterGraph,
		'-map',
		'[outv]',
		'-an',
		'-c:v',
		'libx264',
		'-profile:v',
		'high',
		'-preset',
		quality === 'high' ? 'slow' : 'veryfast',
		'-crf',
		quality === 'high' ? '18' : '23',
		'-threads',
		String(threads),
		'-pix_fmt',
		'yuv420p',
		'-r',
		String(fps),
		'-movflags',
		'+faststart',
		'-t',
		(Math.max(...clips.map((clip) => clip.endMs)) / 1000).toFixed(3),
		outputPath,
	];
	return {
		args,
		filterGraph,
		expectedDurationMs: Math.max(...clips.map((clip) => clip.endMs)),
		inputPaths: clips.map((clip) => inputs[clip.inputIndex]?.path ?? ''),
	};
}

export interface NarrationMuxCommand {
	args: string[];
	videoPath: string;
	narrationPath: string;
	outputPath: string;
	videoDurationMs: number;
	narrationDurationMs: number;
	paddedMs: number;
	trimmedMs: number;
}

/**
 * Second, audio-only encode: the approved video stream is copied bit-for-bit
 * and the narration is padded/trimmed to the exact video duration. Overflow
 * beyond the render tolerance is rejected instead of silently losing speech.
 */
export function buildNarrationMuxCommand(input: {
	videoPath: string;
	narrationPath: string;
	outputPath: string;
	videoDurationMs: number;
	narrationDurationMs: number;
	volumeDb?: number;
	toleranceMs?: number;
}): NarrationMuxCommand {
	if (!input.videoPath || !input.narrationPath || !input.outputPath)
		throw new RenderCompositionError('RENDER_MUX_INPUT_INVALID', 'Mux de narração inválido.');
	if (/(^|[\\/])\.\.([\\/]|$)/.test(input.outputPath))
		throw new RenderCompositionError('RENDER_OUTPUT_INVALID', 'Caminho de saída inválido.');
	let policy: ReturnType<typeof narrationDurationPolicy>;
	try {
		policy = narrationDurationPolicy(
			input.narrationDurationMs,
			input.videoDurationMs,
			input.toleranceMs,
		);
	} catch {
		throw new RenderCompositionError(
			'NARRATION_DURATION_INVALID',
			'Duração da narração ou do vídeo inválida.',
		);
	}
	if (policy.underflowMs > 0)
		throw new RenderCompositionError(
			'NARRATION_TOO_SHORT',
			`A narração cobre menos da metade do vídeo (${policy.narrationMs} de ${policy.videoMs} ms).`,
		);
	if (policy.overflowMs > 0)
		throw new RenderCompositionError(
			'NARRATION_OVERFLOW',
			`A narração excede o vídeo em ${policy.overflowMs} ms.`,
		);
	const volume = Math.max(-12, Math.min(6, input.volumeDb ?? 0));
	const duration = (input.videoDurationMs / 1000).toFixed(3);
	const filter = `volume=${volume}dB,apad=whole_dur=${duration},atrim=0:${duration}`;
	return {
		args: [
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-i',
			input.videoPath,
			'-i',
			input.narrationPath,
			'-map',
			'0:v:0',
			'-map',
			'1:a:0',
			'-c:v',
			'copy',
			'-af',
			filter,
			'-c:a',
			'aac',
			'-b:a',
			'192k',
			'-ar',
			'48000',
			'-ac',
			'2',
			'-t',
			duration,
			'-movflags',
			'+faststart',
			input.outputPath,
		],
		videoPath: input.videoPath,
		narrationPath: input.narrationPath,
		outputPath: input.outputPath,
		videoDurationMs: input.videoDurationMs,
		narrationDurationMs: input.narrationDurationMs,
		paddedMs: policy.paddedMs,
		trimmedMs: policy.trimmedMs,
	};
}

export interface AudioMixEvent {
	id: string;
	path: string;
	kind: AudioKind;
	startMs: number;
	durationMs: number;
	sourceInMs: number;
	gainDb: number;
	directorGainDb?: number;
	fadeInMs: number;
	fadeOutMs: number;
	pan: number;
	distance: number;
	loop: boolean;
	ducking: boolean;
	spatialPreset: AudioSpatialPreset;
	spatialMode: AudioSpatialMode;
	intensity: number;
}

export interface AudioMixCommand {
	args: string[];
	videoPath: string;
	outputPath: string;
	videoDurationMs: number;
	narrationDurationMs: number | null;
	paddedMs: number;
	trimmedMs: number;
	eventCount: number;
	duckedCount: number;
	spatialModes: Record<string, number>;
}

function panGains(pan: number): { left: number; right: number } {
	const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
	return { left: Math.cos(angle), right: Math.sin(angle) };
}

function spatialFilters(event: AudioMixEvent): string {
	const filters: string[] = [];
	if (event.spatialPreset === 'corridor')
		filters.push('highpass=f=180', 'lowpass=f=6000', 'aecho=0.8:0.6:18|28:0.22|0.16');
	else if (event.spatialPreset === 'radio')
		filters.push('highpass=f=450', 'lowpass=f=3000', 'aecho=0.7:0.4:12|20:0.16|0.1');
	else if (event.spatialPreset === 'steps-behind')
		filters.push('lowpass=f=3500', 'aecho=0.8:0.5:32|48:0.18|0.12');
	else if (event.spatialPreset === 'whisper-side')
		filters.push('highpass=f=700', 'lowpass=f=5000', 'aecho=0.7:0.4:10|18:0.12|0.08');
	if (event.spatialMode === 'binaural_simulated') {
		const delay = Math.max(3, Math.round(3 + event.distance * 12));
		filters.push(`adelay=0|${delay}`);
	}
	return filters.length ? `${filters.join(',')},` : '';
}

/**
 * Builds the full audio mix: voice first, music/ambience ducked against it,
 * SFX limited, stereo simulated pan/reverb and a final loudness/true-peak guard.
 * The video stream is copied bit-for-bit.
 */
export function buildAudioMixCommand(input: {
	videoPath: string;
	outputPath: string;
	videoDurationMs: number;
	narration?: { path: string; durationMs: number; volumeDb?: number } | null;
	events: AudioMixEvent[];
	masterGainDb?: number;
	silenceWindows?: Array<{ startMs: number; durationMs: number }>;
}): AudioMixCommand {
	if (!input.videoPath || !input.outputPath)
		throw new RenderCompositionError('RENDER_MIX_INPUT_INVALID', 'Mix de áudio inválido.');
	if (/(^|[\\/])\.\.([\\/]|$)/.test(input.outputPath))
		throw new RenderCompositionError('RENDER_OUTPUT_INVALID', 'Caminho de saída inválido.');
	if (input.events.length > 64)
		throw new RenderCompositionError('RENDER_MIX_TOO_LARGE', 'O mix excede 64 eventos.');
	if (!input.events.length)
		throw new RenderCompositionError('RENDER_MIX_EMPTY', 'O mix não tem eventos de áudio.');
	const duration = (input.videoDurationMs / 1000).toFixed(3);
	let narrationPolicy: ReturnType<typeof narrationDurationPolicy> | null = null;
	if (input.narration) {
		try {
			narrationPolicy = narrationDurationPolicy(input.narration.durationMs, input.videoDurationMs);
		} catch {
			throw new RenderCompositionError(
				'NARRATION_DURATION_INVALID',
				'Duração da narração ou do vídeo inválida.',
			);
		}
		if (narrationPolicy.underflowMs > 0)
			throw new RenderCompositionError(
				'NARRATION_TOO_SHORT',
				`A narração cobre menos da metade do vídeo (${narrationPolicy.narrationMs} de ${narrationPolicy.videoMs} ms).`,
			);
		if (narrationPolicy.overflowMs > 0)
			throw new RenderCompositionError(
				'NARRATION_OVERFLOW',
				`A narração excede o vídeo em ${narrationPolicy.overflowMs} ms.`,
			);
	}
	const filters: string[] = [];
	const inputs: string[] = [];
	let inputIndex = 1;
	let narrationLabel: string | null = null;
	if (input.narration) {
		const volume = Math.max(-12, Math.min(6, input.narration.volumeDb ?? 0));
		filters.push(
			`[${inputIndex}:a]volume=${volume}dB,apad=whole_dur=${duration},atrim=0:${duration},aformat=sample_rates=48000:channel_layouts=stereo[narrbase]`,
		);
		narrationLabel = 'narrbase';
		inputs.push(input.narration.path);
		inputIndex += 1;
	}
	const duckedBus: string[] = [];
	const unduckedBus: string[] = [];
	const sfxBus: string[] = [];
	for (const event of input.events) {
		const index = inputIndex;
		inputs.push(event.path);
		inputIndex += 1;
		const fadeOutStart = Math.max(0, event.durationMs - event.fadeOutMs) / 1000;
		const eventFilters = [
			`atrim=start=${(event.sourceInMs / 1000).toFixed(3)}:duration=${(event.durationMs / 1000).toFixed(3)}`,
			'asetpts=PTS-STARTPTS',
			`volume=${Math.max(-60, Math.min(12, event.gainDb + (event.directorGainDb ?? 0))).toFixed(2)}dB`,
			'aformat=sample_rates=48000:channel_layouts=stereo',
		];
		if (event.fadeInMs > 0)
			eventFilters.push(`afade=t=in:st=0:d=${(event.fadeInMs / 1000).toFixed(3)}`);
		if (event.fadeOutMs > 0)
			eventFilters.push(
				`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${(event.fadeOutMs / 1000).toFixed(3)}`,
			);
		const gains = panGains(event.pan);
		const spatial = spatialFilters(event).replace(/,$/, '');
		if (spatial) eventFilters.push(spatial);
		eventFilters.push(
			`pan=stereo|c0=${gains.left.toFixed(4)}*c0|c1=${gains.right.toFixed(4)}*c1`,
			`adelay=${event.startMs}|${event.startMs}`,
			`apad=whole_dur=${duration}`,
			`atrim=0:${duration}`,
		);
		const label = `a${index}`;
		filters.push(`[${index}:a]${eventFilters.join(',')}[${label}]`);
		if (event.kind === 'SFX') sfxBus.push(label);
		else if (event.ducking && input.narration) duckedBus.push(label);
		else unduckedBus.push(label);
	}
	const mixBus = (labels: string[], label: string) => {
		if (labels.length === 1) {
			filters.push(`[${labels[0]}]anull[${label}]`);
		} else {
			filters.push(
				`${labels.map((entry) => `[${entry}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0[${label}]`,
			);
		}
	};
	const silenceEnable = input.silenceWindows?.length
		? input.silenceWindows
				.map(
					(window) =>
						`between(t,${(window.startMs / 1000).toFixed(3)},${((window.startMs + window.durationMs) / 1000).toFixed(3)})`,
				)
				.join('+')
		: null;
	let duckedLabel: string | null = null;
	let unduckedLabel: string | null = null;
	if (duckedBus.length) {
		mixBus(duckedBus, 'duckedbus');
		filters.push(`[${narrationLabel ?? 'narrbase'}]asplit=2[narr][duck]`);
		narrationLabel = 'narr';
		filters.push(
			`[duckedbus][duck]sidechaincompress=threshold=0.005:ratio=8:attack=20:release=350:makeup=1[ducked]`,
		);
		if (silenceEnable) {
			filters.push(`[ducked]volume=0:enable='${silenceEnable}'[duckedmute]`);
			duckedLabel = 'duckedmute';
		} else duckedLabel = 'ducked';
	}
	if (unduckedBus.length) {
		mixBus(unduckedBus, 'unduckedbus');
		if (silenceEnable) {
			filters.push(`[unduckedbus]volume=0:enable='${silenceEnable}'[unduckedmute]`);
			unduckedLabel = 'unduckedmute';
		} else unduckedLabel = 'unduckedbus';
	}
	if (sfxBus.length) mixBus(sfxBus, 'sfxbus');
	const finalInputs = [
		...(narrationLabel ? [narrationLabel] : []),
		...(duckedLabel ? [duckedLabel] : []),
		...(unduckedLabel ? [unduckedLabel] : []),
		...(sfxBus.length ? ['sfxbus'] : []),
	];
	if (!finalInputs.length)
		throw new RenderCompositionError('RENDER_MIX_EMPTY', 'O mix não tem áudio.');
	const master = Math.max(-12, Math.min(6, input.masterGainDb ?? 0));
	const finalFilter = [
		finalInputs.length === 1
			? `[${finalInputs[0]}]anull`
			: `${finalInputs.map((label) => `[${label}]`).join('')}amix=inputs=${finalInputs.length}:normalize=0:duration=longest:dropout_transition=0`,
		`volume=${master}dB`,
		'loudnorm=I=-16:TP=-1.5:LRA=11',
		'alimiter=limit=0.891',
		`atrim=0:${duration}`,
	].join(',');
	filters.push(`${finalFilter}[outa]`);
	const args = [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		input.videoPath,
		...(input.narration ? ['-i', input.narration.path] : []),
		...input.events.flatMap((event) => [
			...(event.loop ? ['-stream_loop', '-1'] : []),
			'-i',
			event.path,
		]),
		'-filter_complex',
		filters.join(';'),
		'-map',
		'0:v:0',
		'-map',
		'[outa]',
		'-c:v',
		'copy',
		'-c:a',
		'aac',
		'-b:a',
		'192k',
		'-ar',
		'48000',
		'-ac',
		'2',
		'-t',
		duration,
		'-movflags',
		'+faststart',
		input.outputPath,
	];
	const spatialModes: Record<string, number> = {};
	for (const event of input.events)
		spatialModes[event.spatialMode] = (spatialModes[event.spatialMode] ?? 0) + 1;
	const paddedMs = narrationPolicy?.paddedMs ?? 0;
	const trimmedMs = narrationPolicy?.trimmedMs ?? 0;
	return {
		args,
		videoPath: input.videoPath,
		outputPath: input.outputPath,
		videoDurationMs: input.videoDurationMs,
		narrationDurationMs: input.narration?.durationMs ?? null,
		paddedMs,
		trimmedMs,
		eventCount: input.events.length,
		duckedCount: input.narration ? duckedBus.length : 0,
		spatialModes,
	};
}
