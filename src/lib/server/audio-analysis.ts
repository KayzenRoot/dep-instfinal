import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function mediaProcessEnv(): NodeJS.ProcessEnv {
	return { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot };
}

export interface AudioFileProbe {
	durationMs: number;
	format: string;
	sampleRate: number;
	channels: number;
}

export interface AudioLoudness {
	peakDb: number | null;
	rmsDb: number | null;
	truePeakDb: number | null;
	lufs: number | null;
}

export class AudioAnalysisError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'AudioAnalysisError';
	}
}

export async function probeAudioFile(path: string): Promise<AudioFileProbe> {
	let stdout: string;
	try {
		({ stdout } = await execFileAsync(
			'ffprobe',
			['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
			{ timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: mediaProcessEnv() },
		));
	} catch {
		throw new AudioAnalysisError('AUDIO_INVALID', 'O áudio não pôde ser lido.');
	}
	let parsed: {
		format?: { format_name?: string; duration?: string };
		streams?: Array<{ codec_type?: string; sample_rate?: string; channels?: number }>;
	};
	try {
		parsed = JSON.parse(stdout) as {
			format?: { format_name?: string; duration?: string };
			streams?: Array<{ codec_type?: string; sample_rate?: string; channels?: number }>;
		};
	} catch {
		throw new AudioAnalysisError('AUDIO_INVALID', 'O áudio não pôde ser lido.');
	}
	const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
	const durationSeconds = Number(parsed.format?.duration);
	if (!audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
		throw new AudioAnalysisError('AUDIO_INVALID', 'O áudio não pôde ser lido.');
	return {
		durationMs: Math.round(durationSeconds * 1000),
		format: parsed.format?.format_name ?? 'unknown',
		sampleRate: Number(audio.sample_rate ?? 0),
		channels: audio.channels ?? 0,
	};
}

export async function measureAudioLoudness(path: string): Promise<AudioLoudness> {
	const { stderr } = await execFileAsync(
		'ffmpeg',
		[
			'-hide_banner',
			'-nostdin',
			'-i',
			path,
			'-af',
			'volumedetect,ebur128=peak=true',
			'-f',
			'null',
			'-',
		],
		{ timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: mediaProcessEnv() },
	).catch((cause: { stderr?: string }) => ({ stderr: cause.stderr ?? '' }));
	const output = stderr ?? '';
	const peak = /max_volume:\s*(-?[0-9.]+) dB/.exec(output);
	const rms = /mean_volume:\s*(-?[0-9.]+) dB/.exec(output);
	const truePeaks = [...output.matchAll(/True peak:\s*Peak:\s*(-?[0-9.]+) dBFS/g)];
	const lufsValues = [...output.matchAll(/\bI:\s*(-?[0-9.]+) LUFS/g)];
	const truePeak = truePeaks.at(-1);
	const lufs = lufsValues.at(-1);
	return {
		peakDb: peak ? Number(peak[1]) : null,
		rmsDb: rms ? Number(rms[1]) : null,
		truePeakDb: truePeak ? Number(truePeak[1]) : null,
		lufs: lufs ? Number(lufs[1]) : null,
	};
}
