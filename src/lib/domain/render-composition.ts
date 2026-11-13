import type { VideoEditPlan } from '#lib/schemas/video-edit-plan.js';

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
	width?: 1080;
	height?: 1920;
	vhsIntensity?: 0 | 1 | 2 | 3;
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
	const vhs = options.vhsIntensity ?? 1;
	const clips = normalizedClips(plan, inputs);
	if (clips.length === 0)
		throw new RenderCompositionError('RENDER_PLAN_EMPTY', 'O plano não tem clipes.');
	if (clips.length > 60)
		throw new RenderCompositionError('RENDER_PLAN_TOO_LARGE', 'O plano excede 60 clipes.');
	const groups = segments(clips);
	const filters: string[] = [];
	for (const clip of clips) {
		const source = plan.clips[clip.planIndex];
		const sourceIn = ((source?.sourceInMs ?? 0) / 1000).toFixed(3);
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
		'veryfast',
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
