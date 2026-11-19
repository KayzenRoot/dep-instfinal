import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { summarizeRgbFrames, type ColorStats } from '#lib/domain/color-quality.js';

const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 114;
const MAX_BUFFER = 8 * 1024 * 1024;
const defaultFfmpegBinary =
	process.env.FFMPEG_PATH ??
	(process.platform === 'win32'
		? join(process.env.LOCALAPPDATA ?? 'C:\\Windows', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
		: '/usr/bin/ffmpeg');

export interface MeasureColorOptions {
	ffmpegPath?: string;
	timeoutMs?: number;
	fps?: number;
	frames?: number;
}

function decodeFrames(
	ffmpegPath: string,
	inputPath: string,
	fps: number,
	frames: number,
	timeoutMs: number,
): Promise<Buffer> {
	const args = [
		'-hide_banner',
		'-nostdin',
		'-loglevel',
		'error',
		'-i',
		inputPath,
		'-an',
		'-vf',
		`fps=${fps},scale=${DEFAULT_WIDTH}:${DEFAULT_HEIGHT}:flags=area,format=rgb24`,
		'-frames:v',
		String(frames),
		'-f',
		'rawvideo',
		'-',
	];
	return new Promise((resolve, reject) => {
		execFile(
			ffmpegPath,
			args,
			{ encoding: 'buffer', maxBuffer: MAX_BUFFER, timeout: timeoutMs, windowsHide: true },
			(error, stdout) => {
				const output = stdout as unknown as Buffer;
				if (error) reject(error);
				else if (!Buffer.isBuffer(output) || output.length === 0)
					reject(new Error('O FFmpeg não retornou frames para análise.'));
				else resolve(output);
			},
		);
	});
}

export async function measureColorStats(
	inputPath: string,
	options: MeasureColorOptions = {},
): Promise<ColorStats> {
	const buffer = await decodeFrames(
		options.ffmpegPath ?? defaultFfmpegBinary,
		inputPath,
		options.fps ?? 0.2,
		options.frames ?? 12,
		options.timeoutMs ?? 120_000,
	);
	return summarizeRgbFrames(buffer, DEFAULT_WIDTH, DEFAULT_HEIGHT);
}
